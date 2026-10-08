import type {
  AiLogSourceRef,
  AiProviderRecord,
  AiSettingsRecord,
  Store,
} from "../stores/store.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { decryptSecret } from "../lib/secrets.js";
import { retrieveTopChunks, type RetrievedChunk } from "./retrieve.js";
import { defaultAiChatCaller, type AiChatCaller } from "./provider.js";
import { enqueueAndDistribute, pickDefaultQueue } from "../queues/assign.js";

export interface AiDeps {
  chatCaller?: AiChatCaller;
  secretsKey: string;
}

export interface AiInput {
  workspaceId: string;
  conversationId: string;
  channel: string;
  text: string | null;
}

interface AiCtx {
  store: Store;
  hub: RealtimeHub | null;
  deps: AiDeps;
  input: AiInput;
  settings: AiSettingsRecord;
  provider: AiProviderRecord | null;
  sourceTitle: Map<string, string>;
}

interface FallbackLog {
  question: string;
  prompt: string | null;
  sources: AiLogSourceRef[];
  latencyMs?: number;
}

async function sendSay(ctx: AiCtx, text: string, kind: "texto" | "sistema" = "texto"): Promise<void> {
  const message = await ctx.store.addMessage({
    workspaceId: ctx.input.workspaceId,
    conversationId: ctx.input.conversationId,
    direction: "saida",
    authorId: null,
    kind,
    text,
  });
  ctx.hub?.publish(ctx.input.workspaceId, { kind: "mensagem.criada", data: message });
}

async function ensureHumanTicket(ctx: AiCtx): Promise<void> {
  const { store, hub, input } = ctx;
  const openTicket = await store.findOpenTicketByConversation(input.workspaceId, input.conversationId);
  if (openTicket) return;
  const queues = await store.listQueues(input.workspaceId);
  const queue = pickDefaultQueue(queues, input.channel);
  if (!queue) return;
  await enqueueAndDistribute(store, hub, {
    workspaceId: input.workspaceId,
    queueId: queue.id,
    conversationId: input.conversationId,
    channel: input.channel,
  });
}

async function fallbackToHuman(ctx: AiCtx, reason: string, log: FallbackLog): Promise<void> {
  await sendSay(ctx, ctx.settings.fallbackMessage);
  await ensureHumanTicket(ctx);
  await sendSay(
    ctx,
    `[IA] Sem resposta automática (${reason}). Contexto: pergunta "${log.question.slice(0, 300)}". Conversa ${ctx.input.conversationId} encaminhada para atendimento humano.`,
    "sistema",
  );
  await ctx.store.addAiLog({
    workspaceId: ctx.input.workspaceId,
    conversationId: ctx.input.conversationId,
    providerKind: ctx.provider?.kind ?? null,
    model: ctx.provider?.model ?? null,
    question: log.question,
    answer: null,
    sources: log.sources,
    prompt: log.prompt,
    latencyMs: log.latencyMs ?? null,
    outcome: "fallback",
    fallbackReason: reason,
  });
}

function buildPrompt(question: string, top: RetrievedChunk[], sourceTitle: Map<string, string>): { userPrompt: string; sourceRefs: AiLogSourceRef[] } {
  const contextBlocks = top
    .map(({ chunk }) => `Fonte "${sourceTitle.get(chunk.sourceId) ?? chunk.sourceId}":\n${chunk.content}`)
    .join("\n\n");
  const userPrompt = `Contexto:\n${contextBlocks}\n\nPergunta do contato: ${question}\n\nResponda usando apenas o contexto e cite a fonte.`;
  const sourceRefs = [...new Set(top.map(({ chunk }) => chunk.sourceId))].map((id) => ({
    sourceId: id,
    title: sourceTitle.get(id) ?? id,
  }));
  return { userPrompt, sourceRefs };
}

function estimateCost(
  provider: AiProviderRecord,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (
    provider.priceInputPerMtok === null || provider.priceInputPerMtok === undefined ||
    provider.priceOutputPerMtok === null || provider.priceOutputPerMtok === undefined ||
    inputTokens === null || outputTokens === null
  ) {
    return null;
  }
  return (
    (inputTokens / 1_000_000) * provider.priceInputPerMtok +
    (outputTokens / 1_000_000) * provider.priceOutputPerMtok
  );
}

async function answerWithRag(ctx: AiCtx & { provider: AiProviderRecord }, question: string, apiKey: string | null): Promise<boolean> {
  const { store, deps, input, settings, provider } = ctx;
  const chunks = await store.listKnowledgeChunks(input.workspaceId);
  const top = retrieveTopChunks(question, chunks, settings.maxChunks);
  if (top.length === 0) {
    await fallbackToHuman(ctx, "sem_fonte_na_base_de_conhecimento", {
      question, prompt: null, sources: [],
    });
    return false;
  }
  const { userPrompt, sourceRefs } = buildPrompt(question, top, ctx.sourceTitle);
  const startedAt = Date.now();
  const caller = deps.chatCaller ?? defaultAiChatCaller;
  try {
    const result = await caller({
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey,
      systemPrompt: settings.systemPrompt,
      userPrompt,
    });
    const titles = sourceRefs.map((s) => s.title).join(", ");
    await sendSay(ctx, `${result.answer}\n\nFonte: ${titles}`);
    await store.addAiLog({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      providerKind: provider.kind,
      model: provider.model,
      question,
      answer: result.answer,
      sources: sourceRefs,
      prompt: userPrompt,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: estimateCost(provider, result.inputTokens, result.outputTokens),
      latencyMs: Date.now() - startedAt,
      outcome: "respondido",
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro_desconhecido";
    await fallbackToHuman(ctx, `erro_na_ia: ${message.slice(0, 200)}`, {
      question, prompt: userPrompt, sources: sourceRefs, latencyMs: Date.now() - startedAt,
    });
    return false;
  }
}

async function resolveApiKey(ctx: AiCtx & { provider: AiProviderRecord }, secretsKey: string): Promise<string | null> {
  if (!ctx.provider.apiKeyEnc) return null;
  return decryptSecret(ctx.provider.apiKeyEnc, secretsKey);
}

/**
 * Orquestrador híbrido F4: responde com RAG + provider do workspace,
 * senão transfere a humano com contexto. Retorna true se a IA respondeu.
 */
export async function runAiOnIncoming(
  store: Store,
  hub: RealtimeHub | null,
  deps: AiDeps,
  input: AiInput,
): Promise<boolean> {
  const question = (input.text ?? "").trim();
  if (!question) return false;

  const settings = await store.getAiSettings(input.workspaceId);
  if (!settings || !settings.enabled) return false;

  const provider = await store.getAiProvider(input.workspaceId);
  const sources = await store.listKnowledgeSources(input.workspaceId);
  const ctx: AiCtx = {
    store, hub, deps, input, settings, provider,
    sourceTitle: new Map(sources.map((s) => [s.id, s.title])),
  };
  if (!provider) {
    await fallbackToHuman(ctx, "provedor_de_ia_nao_configurado", { question, prompt: null, sources: [] });
    return false;
  }
  try {
    const apiKey = await resolveApiKey({ ...ctx, provider }, deps.secretsKey);
    return await answerWithRag({ ...ctx, provider }, question, apiKey);
  } catch {
    await fallbackToHuman(ctx, "chave_de_ia_ilegivel", { question, prompt: null, sources: [] });
    return false;
  }
}

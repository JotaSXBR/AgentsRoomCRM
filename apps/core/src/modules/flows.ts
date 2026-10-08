import type { FlowRecord, FlowStepRecord, Store } from "../stores/store.js";
import { enqueueAndDistribute } from "../queues/assign.js";
import type { RealtimeHub } from "../realtime/hub.js";

export interface FlowRunDeps {
  store: Store;
  /** Opcional: o bot roda com hub nulo em contextos sem realtime. */
  hub: RealtimeHub | null;
}

/** Publica no hub quando ele existe (execuções sem realtime são válidas). */
function publish(
  deps: FlowRunDeps,
  workspaceId: string,
  event: { kind: "mensagem.criada" | "fluxo.executado"; data: unknown },
): void {
  deps.hub?.publish(workspaceId, event);
}

export interface FlowRunResult {
  flowId: string;
  flowName: string;
  steps: number;
  matched: string | null;
}

/** Um fluxo casa quando algum termo aparece no texto (substring, sem caixa). */
export function matchFlow(flow: FlowRecord, text: string | null | undefined): string | null {
  if (!flow.active || !text) return null;
  const haystack = text.toLowerCase();
  const term = flow.terms.find((t) => haystack.includes(t.toLowerCase()));
  return term ?? null;
}

function textOf(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function runResponder(
  deps: FlowRunDeps,
  workspaceId: string,
  conversationId: string,
  step: FlowStepRecord,
): Promise<void> {
  const text = textOf(step.payload, "text", "reply");
  if (!text) return;
  const message = await deps.store.addMessage({
    workspaceId,
    conversationId,
    direction: "saida",
    authorId: null,
    kind: "texto",
    text,
  });
  publish(deps, workspaceId, { kind: "mensagem.criada", data: message });
}

async function runEnfileirar(
  deps: FlowRunDeps,
  workspaceId: string,
  conversationId: string,
  channel: string,
  step: FlowStepRecord,
): Promise<void> {
  const queueId = textOf(step.payload, "queueId");
  if (!queueId) return;
  const existing = await deps.store.findOpenTicketByConversation(workspaceId, conversationId);
  if (existing) return;
  await enqueueAndDistribute(deps.store, deps.hub, {
    workspaceId,
    queueId,
    conversationId,
    channel,
  });
}

async function runEncerrar(
  deps: FlowRunDeps,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await deps.store.setConversationStatus(workspaceId, conversationId, "resolvido");
  await deps.store.resolveOpenTicketForConversation(workspaceId, conversationId);
}

async function runMenu(
  deps: FlowRunDeps,
  workspaceId: string,
  conversationId: string,
  step: FlowStepRecord,
): Promise<void> {
  const options = Array.isArray(step.payload.options) ? step.payload.options : [];
  const lines = options.map((option, index) => {
    const item = option as { label?: unknown };
    return `${index + 1}. ${typeof item.label === "string" ? item.label : "opção"}`;
  });
  const header = textOf(step.payload, "text", "reply") ?? "Escolha uma opção:";
  if (lines.length === 0) return runResponder(deps, workspaceId, conversationId, step);
  const message = await deps.store.addMessage({
    workspaceId,
    conversationId,
    direction: "saida",
    authorId: null,
    kind: "texto",
    text: `${header}\n${lines.join("\n")}`,
  });
  publish(deps, workspaceId, { kind: "mensagem.criada", data: message });
}

async function runStep(
  deps: FlowRunDeps,
  workspaceId: string,
  conversationId: string,
  channel: string,
  step: FlowStepRecord,
): Promise<void> {
  switch (step.action) {
    case "responder":
      return runResponder(deps, workspaceId, conversationId, step);
    case "menu":
      return runMenu(deps, workspaceId, conversationId, step);
    case "enfileirar":
      return runEnfileirar(deps, workspaceId, conversationId, channel, step);
    case "encerrar":
      return runEncerrar(deps, workspaceId, conversationId);
  }
}

/**
 * Executa o primeiro fluxo ativo cujos termos casam com a mensagem de entrada.
 * Fluxos são a camada de orquestração da F5 (o que um agente de IA monta pelo
 * MCP): o bot por regras (F3) continua tendo prioridade, então um fluxo nunca
 * rouba a resposta de uma regra mais específica.
 */
export async function runFlowsOnIncoming(
  deps: FlowRunDeps,
  input: { workspaceId: string; conversationId: string; channel: string; text?: string | null },
): Promise<FlowRunResult | null> {
  const flows = await deps.store.listFlows(input.workspaceId);
  const candidates = flows
    .map((flow) => ({ flow, matched: matchFlow(flow, input.text) }))
    .filter((entry): entry is { flow: FlowRecord; matched: string } => entry.matched !== null);
  if (candidates.length === 0) return null;
  // Ordem de criação: o fluxo mais antigo tem a precedência, previsível para
  // quem configurou.
  const chosen = candidates[0];
  for (const step of chosen.flow.steps) {
    await runStep(deps, input.workspaceId, input.conversationId, input.channel, step);
  }
  publish(deps, input.workspaceId, {
    kind: "fluxo.executado",
    data: { flowId: chosen.flow.id, conversationId: input.conversationId },
  });
  return {
    flowId: chosen.flow.id,
    flowName: chosen.flow.name,
    steps: chosen.flow.steps.length,
    matched: chosen.matched,
  };
}
import type { Store } from "../stores/store.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { BotMenuOption, BotRuleRecord, QueueRecord } from "../stores/store.js";
import { isWithinBusinessHours } from "./businessHours.js";
import { enqueueAndDistribute, pickDefaultQueue } from "../queues/assign.js";
import { runAiOnIncoming, type AiDeps } from "../ai/orchestrate.js";
import { runFlowsOnIncoming } from "../modules/flows.js";

export interface BotInput {
  workspaceId: string;
  conversationId: string;
  channel: string;
  text: string | null;
}

interface BotCtx {
  store: Store;
  hub: RealtimeHub | null;
  input: BotInput;
}

interface RuleCtx extends BotCtx {
  rule: BotRuleRecord;
  queues: QueueRecord[];
}

interface ActiveRulesCtx extends BotCtx {
  rules: BotRuleRecord[];
  queues: QueueRecord[];
}

function matchesTerms(terms: string[], text: string): boolean {
  const hay = text.toLowerCase();
  return terms.some((t) => t.trim() !== "" && hay.includes(t.toLowerCase().trim()));
}

function matchMenuOption(options: BotMenuOption[], text: string): BotMenuOption | null {
  const normalized = text.trim().toLowerCase();
  return (
    options.find(
      (o) =>
        o.key.toLowerCase() === normalized ||
        o.label.toLowerCase() === normalized,
    ) ?? null
  );
}

async function sendBotMessage(
  store: Store,
  hub: RealtimeHub | null,
  input: BotInput,
  text: string,
): Promise<void> {
  const message = await store.addMessage({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: "saida",
    authorId: null,
    kind: "texto",
    text,
  });
  hub?.publish(input.workspaceId, { kind: "mensagem.criada", data: message });
}

async function enqueueWith(
  store: Store,
  hub: RealtimeHub | null,
  input: BotInput,
  queue: QueueRecord,
): Promise<void> {
  await enqueueAndDistribute(store, hub, {
    workspaceId: input.workspaceId,
    queueId: queue.id,
    conversationId: input.conversationId,
    channel: input.channel,
  });
}

async function tryEnqueueToRuleQueue(ctx: RuleCtx): Promise<void> {
  const { store, hub, input, rule, queues } = ctx;
  const queue = rule.queueId
    ? (queues.find((q) => q.id === rule.queueId) ?? null)
    : pickDefaultQueue(queues, input.channel);
  if (!queue) return;
  const existing = await store.findOpenTicketByConversation(input.workspaceId, input.conversationId);
  if (existing) return;
  await enqueueWith(store, hub, input, queue);
}

// Fora do horário: ausência + entrada na fila (uma vez por ticket aberto).
async function handleOutsideHours(
  store: Store,
  hub: RealtimeHub | null,
  input: BotInput,
  absenceMessage: string,
): Promise<void> {
  const openTicket = await store.findOpenTicketByConversation(input.workspaceId, input.conversationId);
  if (openTicket) return;
  await sendBotMessage(store, hub, input, absenceMessage);
  const queues = await store.listQueues(input.workspaceId);
  const queue = pickDefaultQueue(queues, input.channel);
  if (queue) await enqueueWith(store, hub, input, queue);
  await store.setBotSession({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    state: { lastAbsenceAt: new Date().toISOString() },
  });
}

// Máquina de menu pendente: próximo texto do contato escolhe a opção.
function resolveMenuOption(rule: BotRuleRecord, text: string | null): BotMenuOption | null {
  return matchMenuOption(rule.options ?? [], text ?? "");
}

async function enqueueMenuOptionQueue(ctx: RuleCtx, option: BotMenuOption): Promise<void> {
  const { store, hub, input, queues } = ctx;
  if (!option.queueId) return;
  const queue = queues.find((q) => q.id === option.queueId);
  if (!queue) return;
  const existing = await store.findOpenTicketByConversation(input.workspaceId, input.conversationId);
  if (existing) return;
  await enqueueWith(store, hub, input, queue);
}

async function handlePendingMenu(ctx: RuleCtx): Promise<boolean> {
  const { store, hub, input, rule } = ctx;
  const option = resolveMenuOption(rule, input.text);
  if (!option) {
    await sendBotMessage(store, hub, input, rule.reply ?? "Opção inválida. Responda com uma das opções.");
    return true;
  }
  await store.setBotSession({ workspaceId: input.workspaceId, conversationId: input.conversationId, state: {} });
  await sendBotMessage(store, hub, input, option.reply);
  await enqueueMenuOptionQueue(ctx, option);
  return true;
}

function normalizeIncomingText(text: string | null): string {
  return (text ?? "").trim();
}

function findMatchingRule(rules: BotRuleRecord[], text: string): BotRuleRecord | null {
  for (const rule of rules) {
    if (rule.active && matchesTerms(rule.terms ?? [], text)) return rule;
  }
  return null;
}

async function handleKeywordRule(ctx: RuleCtx): Promise<void> {
  const { store, hub, input, rule, queues } = ctx;
  if (rule.reply) await sendBotMessage(store, hub, input, rule.reply);
  if (rule.queueId) await tryEnqueueToRuleQueue({ store, hub, input, rule, queues });
}

async function handleTriageRule(ctx: RuleCtx): Promise<void> {
  const { store, hub, input, rule, queues } = ctx;
  if (rule.reply) await sendBotMessage(store, hub, input, rule.reply);
  const existing = await store.findOpenTicketByConversation(input.workspaceId, input.conversationId);
  if (existing) return;
  await tryEnqueueToRuleQueue({ store, hub, input, rule, queues });
}

async function handleMenuRule(ctx: RuleCtx): Promise<void> {
  const { store, hub, input, rule } = ctx;
  await sendBotMessage(store, hub, input, rule.reply ?? "Escolha uma opção:");
  await store.setBotSession({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    state: { menuRuleId: rule.id },
  });
}

async function runActiveRules(ctx: ActiveRulesCtx): Promise<boolean> {
  const rule = findMatchingRule(ctx.rules, normalizeIncomingText(ctx.input.text));
  if (!rule) return false;
  const ruleCtx: RuleCtx = { store: ctx.store, hub: ctx.hub, input: ctx.input, rule, queues: ctx.queues };
  if (rule.kind === "palavra_chave") {
    await handleKeywordRule(ruleCtx);
    return true;
  }
  if (rule.kind === "triagem") {
    await handleTriageRule(ruleCtx);
    return true;
  }
  if (rule.kind === "menu") {
    await handleMenuRule(ruleCtx);
    return true;
  }
  return false;
}

/**
 * Cérebro do bot (F3). Chamado depois de cada intake não duplicado.
 * - Atendente já atribuído → bot fica quieto.
 * - Fora do horário → mensagem de ausência + ticket na fila padrão.
 * - Menu pendente na sessão → próximo texto escolhe a opção.
 * - Senão → primeira regra ativa (por prioridade) cujo termo aparece na mensagem.
 */
export async function runBotOnIncoming(
  store: Store,
  hub: RealtimeHub | null,
  input: BotInput,
  ai?: AiDeps,
): Promise<void> {
  const conversation = await store.findConversationById(input.workspaceId, input.conversationId);
  if (!conversation || conversation.assigneeId) return;

  const settings = await store.getWorkspaceSettings(input.workspaceId);
  if (settings && !isWithinBusinessHours(settings.businessHours, settings.timezone)) {
    await handleOutsideHours(store, hub, input, settings.absenceMessage);
    return;
  }

  const session = await store.getBotSession(input.workspaceId, input.conversationId);
  const rules = await store.listBotRules(input.workspaceId);
  if (session?.state?.menuRuleId) {
    const menuRule = rules.find((r) => r.id === session.state.menuRuleId && r.active && r.kind === "menu");
    const queues = await store.listQueues(input.workspaceId);
    if (menuRule && (await handlePendingMenu({ store, hub, input, rule: menuRule, queues }))) return;
    await store.setBotSession({ workspaceId: input.workspaceId, conversationId: input.conversationId, state: {} });
  }

  const queues = await store.listQueues(input.workspaceId);
  const handled = await runActiveRules({ store, hub, input, rules, queues });
  if (!handled) {
    // F5: fluxos (montados por um agente externo via MCP) têm a vez antes da
    // IA — são configuração determinística, a IA é o último recurso.
    const flowRun = await runFlowsOnIncoming({ store, hub }, {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channel: input.channel,
      text: input.text,
    });
    if (flowRun) return;
  }
  // F4: sem regra casada, IA híbrida (RAG + BYOK/Ollama) com fallback humano.
  if (!handled && ai) {
    await runAiOnIncoming(store, hub, ai, {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channel: input.channel,
      text: input.text,
    });
  }
}

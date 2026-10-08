import { randomUUID } from "node:crypto";
import type {
  BotMenuOption,
  BotRuleKind,
  BotRuleRecord,
  BotSessionRecord,
  BotSessionState,
  BusinessHours,
  WorkspaceSettingsRecord,
} from "../types/bot.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type BotState = Pick<
  MemoryState,
  "workspaceSettings" | "botRules" | "botSessions"
>;

export async function getWorkspaceSettings(
  state: BotState,
  workspaceId: string,
): Promise<WorkspaceSettingsRecord | null> {
  return state.workspaceSettings.get(workspaceId) ?? null;
}

export async function upsertWorkspaceSettings(
  state: BotState,
  input: {
    workspaceId: string;
    timezone?: string;
    absenceMessage?: string;
    businessHours?: BusinessHours;
  },
): Promise<WorkspaceSettingsRecord> {
  const current = state.workspaceSettings.get(input.workspaceId);
  const record: WorkspaceSettingsRecord = {
    workspaceId: input.workspaceId,
    timezone: input.timezone ?? current?.timezone ?? "America/Sao_Paulo",
    absenceMessage:
      input.absenceMessage ??
      current?.absenceMessage ??
      "Olá! Estamos fora do horário de atendimento no momento. Deixe sua mensagem que retornaremos em breve.",
    businessHours: input.businessHours ?? current?.businessHours ?? {},
    updatedAt: now(),
  };
  state.workspaceSettings.set(input.workspaceId, record);
  return record;
}

export async function createBotRule(
  state: BotState,
  input: {
    workspaceId: string;
    name: string;
    kind: BotRuleKind;
    priority?: number;
    active?: boolean;
    terms?: string[];
    reply?: string | null;
    options?: BotMenuOption[];
    queueId?: string | null;
  },
): Promise<BotRuleRecord> {
  const rule: BotRuleRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    kind: input.kind,
    priority: input.priority ?? 100,
    active: input.active ?? true,
    terms: input.terms ?? [],
    reply: input.reply ?? null,
    options: input.options ?? [],
    queueId: input.queueId ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.botRules.set(rule.id, rule);
  return rule;
}

export async function listBotRules(
  state: BotState,
  workspaceId: string,
): Promise<BotRuleRecord[]> {
  return [...state.botRules.values()]
    .filter((r) => r.workspaceId === workspaceId)
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

export async function updateBotRule(
  state: BotState,
  workspaceId: string,
  id: string,
  patch: Partial<{
    name: string;
    priority: number;
    active: boolean;
    terms: string[];
    reply: string | null;
    options: BotMenuOption[];
    queueId: string | null;
  }>,
): Promise<BotRuleRecord | null> {
  const rule = state.botRules.get(id);
  if (!rule || rule.workspaceId !== workspaceId) return null;
  const updated: BotRuleRecord = { ...rule, ...patch, updatedAt: now() };
  state.botRules.set(id, updated);
  return updated;
}

export async function deleteBotRule(
  state: BotState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const rule = state.botRules.get(id);
  if (!rule || rule.workspaceId !== workspaceId) return false;
  return state.botRules.delete(id);
}

export async function getBotSession(
  state: BotState,
  workspaceId: string,
  conversationId: string,
): Promise<BotSessionRecord | null> {
  const s = state.botSessions.get(conversationId);
  return s && s.workspaceId === workspaceId ? s : null;
}

export async function setBotSession(
  state: BotState,
  input: {
    workspaceId: string;
    conversationId: string;
    state: BotSessionState;
  },
): Promise<BotSessionRecord> {
  const record: BotSessionRecord = { ...input, updatedAt: now() };
  state.botSessions.set(input.conversationId, record);
  return record;
}

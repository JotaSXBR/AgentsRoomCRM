import { randomUUID } from "node:crypto";
import type {
  AiKnowledgeChunkRecord,
  AiKnowledgeSourceRecord,
  AiKnowledgeStatus,
  AiLogRecord,
  AiOutcome,
  AiLogSourceRef,
  AiProviderKind,
  AiProviderRecord,
  AiSettingsRecord,
} from "../types/ai.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type AiState = Pick<
  MemoryState,
  "aiSettings" | "aiProviders" | "aiSources" | "aiChunks" | "aiLogs"
>;

export function createAiMaps(): AiState {
  return {
    aiSettings: new Map(),
    aiProviders: new Map(),
    aiSources: new Map(),
    aiChunks: new Map(),
    aiLogs: new Map(),
  };
}

export const AI_DEFAULT_SYSTEM_PROMPT =
  "Você é um assistente de atendimento. Responda apenas com base no contexto fornecido e cite as fontes.";
export const AI_DEFAULT_FALLBACK = "Vou transferir você para um atendente humano.";

export async function getAiSettings(
  state: AiState,
  workspaceId: string,
): Promise<AiSettingsRecord | null> {
  return state.aiSettings.get(workspaceId) ?? null;
}

const AI_SETTING_DEFAULTS = {
  enabled: false,
  systemPrompt: AI_DEFAULT_SYSTEM_PROMPT,
  fallbackMessage: AI_DEFAULT_FALLBACK,
  maxChunks: 3,
};

function withoutUndefined<T extends object>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function mergeSettings(
  current: AiSettingsRecord | undefined,
  input: { enabled?: boolean; systemPrompt?: string; fallbackMessage?: string; maxChunks?: number },
): Omit<AiSettingsRecord, "workspaceId" | "updatedAt"> {
  const { workspaceId: _workspaceId, updatedAt: _updatedAt, ...currentRest } = withoutUndefined(current);
  return { ...AI_SETTING_DEFAULTS, ...currentRest, ...withoutUndefined(input) };
}
export async function upsertAiSettings(
  state: AiState,
  input: {
    workspaceId: string;
    enabled?: boolean;
    systemPrompt?: string;
    fallbackMessage?: string;
    maxChunks?: number;
  },
): Promise<AiSettingsRecord> {
  const record: AiSettingsRecord = {
    workspaceId: input.workspaceId,
    ...mergeSettings(state.aiSettings.get(input.workspaceId), input),
    updatedAt: now(),
  };
  state.aiSettings.set(input.workspaceId, record);
  return record;
}

export async function getAiProvider(
  state: AiState,
  workspaceId: string,
): Promise<AiProviderRecord | null> {
  return state.aiProviders.get(workspaceId) ?? null;
}

export async function upsertAiProvider(
  state: AiState,
  input: {
    workspaceId: string;
    kind: AiProviderKind;
    baseUrl: string;
    model: string;
    apiKeyEnc?: string | null;
    priceInputPerMtok?: number | null;
    priceOutputPerMtok?: number | null;
  },
): Promise<AiProviderRecord> {
  const current = state.aiProviders.get(input.workspaceId);
  const record: AiProviderRecord = {
    workspaceId: input.workspaceId,
    kind: input.kind,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKeyEnc: input.apiKeyEnc === undefined ? (current?.apiKeyEnc ?? null) : input.apiKeyEnc,
    priceInputPerMtok:
      input.priceInputPerMtok === undefined
        ? (current?.priceInputPerMtok ?? null)
        : input.priceInputPerMtok,
    priceOutputPerMtok:
      input.priceOutputPerMtok === undefined
        ? (current?.priceOutputPerMtok ?? null)
        : input.priceOutputPerMtok,
    updatedAt: now(),
  };
  state.aiProviders.set(input.workspaceId, record);
  return record;
}

export async function deleteAiProvider(
  state: AiState,
  workspaceId: string,
): Promise<boolean> {
  return state.aiProviders.delete(workspaceId);
}

export async function createKnowledgeSource(
  state: AiState,
  input: {
    workspaceId: string;
    kind: AiKnowledgeSourceRecord["kind"];
    title: string;
    content?: string | null;
    url?: string | null;
    status?: AiKnowledgeStatus;
    error?: string | null;
  },
): Promise<AiKnowledgeSourceRecord> {
  const record: AiKnowledgeSourceRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    kind: input.kind,
    title: input.title,
    content: input.content ?? null,
    url: input.url ?? null,
    status: input.status ?? "pronto",
    error: input.error ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.aiSources.set(record.id, record);
  return record;
}

export async function listKnowledgeSources(
  state: AiState,
  workspaceId: string,
): Promise<AiKnowledgeSourceRecord[]> {
  return [...state.aiSources.values()]
    .filter((s) => s.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findKnowledgeSource(
  state: AiState,
  workspaceId: string,
  id: string,
): Promise<AiKnowledgeSourceRecord | null> {
  const s = state.aiSources.get(id);
  return s && s.workspaceId === workspaceId ? s : null;
}

export async function updateKnowledgeSource(
  state: AiState,
  workspaceId: string,
  id: string,
  patch: Partial<{
    title: string;
    content: string | null;
    url: string | null;
    status: AiKnowledgeStatus;
    error: string | null;
  }>,
): Promise<AiKnowledgeSourceRecord | null> {
  const current = state.aiSources.get(id);
  if (!current || current.workspaceId !== workspaceId) return null;
  const record: AiKnowledgeSourceRecord = { ...current, ...patch, updatedAt: now() };
  state.aiSources.set(id, record);
  return record;
}

export async function deleteKnowledgeSource(
  state: AiState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const source = state.aiSources.get(id);
  if (!source || source.workspaceId !== workspaceId) return false;
  state.aiSources.delete(id);
  for (const [chunkId, chunk] of state.aiChunks) {
    if (chunk.sourceId === id) state.aiChunks.delete(chunkId);
  }
  return true;
}

export async function replaceKnowledgeChunks(
  state: AiState,
  workspaceId: string,
  sourceId: string,
  chunks: string[],
): Promise<AiKnowledgeChunkRecord[]> {
  for (const [chunkId, chunk] of state.aiChunks) {
    if (chunk.sourceId === sourceId && chunk.workspaceId === workspaceId) {
      state.aiChunks.delete(chunkId);
    }
  }
  const created: AiKnowledgeChunkRecord[] = chunks.map((content, index) => ({
    id: randomUUID(),
    workspaceId,
    sourceId,
    position: index,
    content,
    createdAt: now(),
  }));
  for (const chunk of created) state.aiChunks.set(chunk.id, chunk);
  return created;
}

export async function listKnowledgeChunks(
  state: AiState,
  workspaceId: string,
): Promise<AiKnowledgeChunkRecord[]> {
  return [...state.aiChunks.values()]
    .filter((c) => c.workspaceId === workspaceId)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.position - b.position);
}

export async function addAiLog(
  state: AiState,
  input: {
    workspaceId: string;
    conversationId?: string | null;
    providerKind?: string | null;
    model?: string | null;
    question: string;
    answer?: string | null;
    sources?: AiLogSourceRef[];
    prompt?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
    latencyMs?: number | null;
    outcome: AiOutcome;
    fallbackReason?: string | null;
  },
): Promise<AiLogRecord> {
  const record: AiLogRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    conversationId: input.conversationId ?? null,
    providerKind: input.providerKind ?? null,
    model: input.model ?? null,
    question: input.question,
    answer: input.answer ?? null,
    sources: input.sources ?? [],
    prompt: input.prompt ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    costUsd: input.costUsd ?? null,
    latencyMs: input.latencyMs ?? null,
    outcome: input.outcome,
    fallbackReason: input.fallbackReason ?? null,
    createdAt: now(),
  };
  state.aiLogs.set(record.id, record);
  return record;
}

export async function listAiLogs(
  state: AiState,
  workspaceId: string,
  limit = 100,
): Promise<AiLogRecord[]> {
  return [...state.aiLogs.values()]
    .filter((l) => l.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

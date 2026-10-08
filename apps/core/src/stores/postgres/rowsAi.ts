import type { AiKnowledgeChunkRecord, AiKnowledgeSourceRecord, AiLogRecord, AiLogSourceRef, AiProviderRecord, AiSettingsRecord } from "../store.js";

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function rowToAiSettings(row: Record<string, unknown>): AiSettingsRecord {
  return {
    workspaceId: String(row.workspace_id),
    enabled: Boolean(row.enabled),
    systemPrompt: String(row.system_prompt),
    fallbackMessage: String(row.fallback_message),
    maxChunks: Number(row.max_chunks),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToAiProvider(row: Record<string, unknown>): AiProviderRecord {
  return {
    workspaceId: String(row.workspace_id),
    kind: row.kind as AiProviderRecord["kind"],
    baseUrl: String(row.base_url),
    model: String(row.model),
    apiKeyEnc: (row.api_key_enc as string) ?? null,
    priceInputPerMtok: numOrNull(row.price_input_per_mtok),
    priceOutputPerMtok: numOrNull(row.price_output_per_mtok),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToAiSource(row: Record<string, unknown>): AiKnowledgeSourceRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: row.kind as AiKnowledgeSourceRecord["kind"],
    title: String(row.title),
    content: (row.content as string) ?? null,
    url: (row.url as string) ?? null,
    status: row.status as AiKnowledgeSourceRecord["status"],
    error: (row.error as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToAiChunk(row: Record<string, unknown>): AiKnowledgeChunkRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sourceId: String(row.source_id),
    position: Number(row.position),
    content: String(row.content),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToAiLog(row: Record<string, unknown>): AiLogRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: (row.conversation_id as string) ?? null,
    providerKind: (row.provider_kind as string) ?? null,
    model: (row.model as string) ?? null,
    question: String(row.question),
    answer: (row.answer as string) ?? null,
    sources: (row.sources as AiLogSourceRef[]) ?? [],
    prompt: (row.prompt as string) ?? null,
    inputTokens: numOrNull(row.input_tokens),
    outputTokens: numOrNull(row.output_tokens),
    costUsd: numOrNull(row.cost_usd),
    latencyMs: numOrNull(row.latency_ms),
    outcome: row.outcome as AiLogRecord["outcome"],
    fallbackReason: (row.fallback_reason as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

// ---- F4: IA híbrida (BYOK + Ollama + RAG + fallback humano) ----

export type AiProviderKind = "openai_compatible" | "ollama";
export type AiKnowledgeKind = "faq" | "documento" | "url";
export type AiKnowledgeStatus = "pronto" | "erro" | "vazio";
export type AiOutcome = "respondido" | "fallback" | "erro";

export interface AiSettingsRecord {
  workspaceId: string;
  enabled: boolean;
  systemPrompt: string;
  fallbackMessage: string;
  maxChunks: number;
  updatedAt: string;
}

export interface AiProviderRecord {
  workspaceId: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  /** Chave BYOK cifrada — nunca exposta pela API. */
  apiKeyEnc: string | null;
  priceInputPerMtok: number | null;
  priceOutputPerMtok: number | null;
  updatedAt: string;
}

export interface AiKnowledgeSourceRecord {
  id: string;
  workspaceId: string;
  kind: AiKnowledgeKind;
  title: string;
  content: string | null;
  url: string | null;
  status: AiKnowledgeStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiKnowledgeChunkRecord {
  id: string;
  workspaceId: string;
  sourceId: string;
  position: number;
  content: string;
  createdAt: string;
}

export interface AiLogSourceRef {
  sourceId: string;
  title: string;
}

export interface AiLogRecord {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  providerKind: string | null;
  model: string | null;
  question: string;
  answer: string | null;
  sources: AiLogSourceRef[];
  prompt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  outcome: AiOutcome;
  fallbackReason: string | null;
  createdAt: string;
}

export interface AiStore {
  getAiSettings(workspaceId: string): Promise<AiSettingsRecord | null>;
  upsertAiSettings(input: {
    workspaceId: string;
    enabled?: boolean;
    systemPrompt?: string;
    fallbackMessage?: string;
    maxChunks?: number;
  }): Promise<AiSettingsRecord>;
  getAiProvider(workspaceId: string): Promise<AiProviderRecord | null>;
  upsertAiProvider(input: {
    workspaceId: string;
    kind: AiProviderKind;
    baseUrl: string;
    model: string;
    apiKeyEnc?: string | null;
    priceInputPerMtok?: number | null;
    priceOutputPerMtok?: number | null;
  }): Promise<AiProviderRecord>;
  deleteAiProvider(workspaceId: string): Promise<boolean>;
  createKnowledgeSource(input: {
    workspaceId: string;
    kind: AiKnowledgeKind;
    title: string;
    content?: string | null;
    url?: string | null;
    status?: AiKnowledgeStatus;
    error?: string | null;
  }): Promise<AiKnowledgeSourceRecord>;
  listKnowledgeSources(workspaceId: string): Promise<AiKnowledgeSourceRecord[]>;
  findKnowledgeSource(
    workspaceId: string,
    id: string,
  ): Promise<AiKnowledgeSourceRecord | null>;
  updateKnowledgeSource(
    workspaceId: string,
    id: string,
    patch: Partial<{
      title: string;
      content: string | null;
      url: string | null;
      status: AiKnowledgeStatus;
      error: string | null;
    }>,
  ): Promise<AiKnowledgeSourceRecord | null>;
  deleteKnowledgeSource(workspaceId: string, id: string): Promise<boolean>;
  replaceKnowledgeChunks(
    workspaceId: string,
    sourceId: string,
    chunks: string[],
  ): Promise<AiKnowledgeChunkRecord[]>;
  listKnowledgeChunks(workspaceId: string): Promise<AiKnowledgeChunkRecord[]>;
  addAiLog(input: {
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
  }): Promise<AiLogRecord>;
  listAiLogs(workspaceId: string, limit?: number): Promise<AiLogRecord[]>;
}

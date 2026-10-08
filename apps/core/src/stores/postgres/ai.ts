import type {
  AiKnowledgeChunkRecord,
  AiKnowledgeSourceRecord,
  AiLogRecord,
  AiLogSourceRef,
  AiOutcome,
  AiProviderKind,
  AiProviderRecord,
  AiSettingsRecord,
} from "../store.js";
import {
  rowToAiChunk,
  rowToAiLog,
  rowToAiProvider,
  rowToAiSettings,
  rowToAiSource,
} from "./rowsAi.js";
import type { PostgresDeps } from "./rows.js";

export async function getAiSettings(deps: PostgresDeps, workspaceId: string): Promise<AiSettingsRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query("SELECT * FROM ai_settings WHERE workspace_id = $1", [workspaceId]);
    return rows[0] ? rowToAiSettings(rows[0]) : null;
  });
}

export async function upsertAiSettings(deps: PostgresDeps, input: {
  workspaceId: string;
  enabled?: boolean;
  systemPrompt?: string;
  fallbackMessage?: string;
  maxChunks?: number;
}): Promise<AiSettingsRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ai_settings (workspace_id, enabled, system_prompt, fallback_message, max_chunks)
       VALUES ($1, COALESCE($2, FALSE), COALESCE($3, 'Você é um assistente de atendimento. Responda apenas com base no contexto fornecido e cite as fontes.'), COALESCE($4, 'Vou transferir você para um atendente humano.'), COALESCE($5, 3))
       ON CONFLICT (workspace_id) DO UPDATE SET
         enabled = COALESCE($2, ai_settings.enabled),
         system_prompt = COALESCE($3, ai_settings.system_prompt),
         fallback_message = COALESCE($4, ai_settings.fallback_message),
         max_chunks = COALESCE($5, ai_settings.max_chunks),
         updated_at = NOW()
       RETURNING *`,
      [input.workspaceId, input.enabled ?? null, input.systemPrompt ?? null, input.fallbackMessage ?? null, input.maxChunks ?? null],
    );
    return rowToAiSettings(rows[0]);
  });
}

export async function getAiProvider(deps: PostgresDeps, workspaceId: string): Promise<AiProviderRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query("SELECT * FROM ai_providers WHERE workspace_id = $1", [workspaceId]);
    return rows[0] ? rowToAiProvider(rows[0]) : null;
  });
}

export async function upsertAiProvider(deps: PostgresDeps, input: {
  workspaceId: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKeyEnc?: string | null;
  priceInputPerMtok?: number | null;
  priceOutputPerMtok?: number | null;
}): Promise<AiProviderRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ai_providers (workspace_id, kind, base_url, model, api_key_enc, price_input_per_mtok, price_output_per_mtok)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id) DO UPDATE SET
         kind = $2, base_url = $3, model = $4,
         api_key_enc = COALESCE($5, ai_providers.api_key_enc),
         price_input_per_mtok = COALESCE($6, ai_providers.price_input_per_mtok),
         price_output_per_mtok = COALESCE($7, ai_providers.price_output_per_mtok),
         updated_at = NOW()
       RETURNING *`,
      [input.workspaceId, input.kind, input.baseUrl, input.model, input.apiKeyEnc === undefined ? null : input.apiKeyEnc, input.priceInputPerMtok === undefined ? null : input.priceInputPerMtok, input.priceOutputPerMtok === undefined ? null : input.priceOutputPerMtok],
    );
    return rowToAiProvider(rows[0]);
  });
}

export async function deleteAiProvider(deps: PostgresDeps, workspaceId: string): Promise<boolean> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM ai_providers WHERE workspace_id = $1", [workspaceId]);
    return (rowCount ?? 0) > 0;
  });
}

export async function createKnowledgeSource(deps: PostgresDeps, input: {
  workspaceId: string;
  kind: AiKnowledgeSourceRecord["kind"];
  title: string;
  content?: string | null;
  url?: string | null;
  status?: AiKnowledgeSourceRecord["status"];
  error?: string | null;
}): Promise<AiKnowledgeSourceRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ai_knowledge_sources (workspace_id, kind, title, content, url, status, error)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'pronto'), $7) RETURNING *`,
      [input.workspaceId, input.kind, input.title, input.content ?? null, input.url ?? null, input.status ?? null, input.error ?? null],
    );
    return rowToAiSource(rows[0]);
  });
}

export async function listKnowledgeSources(deps: PostgresDeps, workspaceId: string): Promise<AiKnowledgeSourceRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query("SELECT * FROM ai_knowledge_sources WHERE workspace_id = $1 ORDER BY created_at", [workspaceId]);
    return rows.map(rowToAiSource);
  });
}

export async function findKnowledgeSource(deps: PostgresDeps, workspaceId: string, id: string): Promise<AiKnowledgeSourceRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query("SELECT * FROM ai_knowledge_sources WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
    return rows[0] ? rowToAiSource(rows[0]) : null;
  });
}

export async function updateKnowledgeSource(deps: PostgresDeps, workspaceId: string, id: string, patch: Partial<{
  title: string;
  content: string | null;
  url: string | null;
  status: AiKnowledgeSourceRecord["status"];
  error: string | null;
}>): Promise<AiKnowledgeSourceRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      `UPDATE ai_knowledge_sources SET
         title = COALESCE($3, title),
         content = CASE WHEN $4::boolean THEN $5 ELSE content END,
         url = CASE WHEN $6::boolean THEN $7 ELSE url END,
         status = COALESCE($8, status),
         error = CASE WHEN $9::boolean THEN $10 ELSE error END,
         updated_at = NOW()
       WHERE workspace_id = $1 AND id = $2 RETURNING *`,
      [workspaceId, id, patch.title ?? null, patch.content !== undefined, patch.content ?? null, patch.url !== undefined, patch.url ?? null, patch.status ?? null, patch.error !== undefined, patch.error ?? null],
    );
    return rows[0] ? rowToAiSource(rows[0]) : null;
  });
}

export async function deleteKnowledgeSource(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM ai_knowledge_sources WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
    return (rowCount ?? 0) > 0;
  });
}

export async function replaceKnowledgeChunks(deps: PostgresDeps, workspaceId: string, sourceId: string, chunks: string[]): Promise<AiKnowledgeChunkRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    await client.query("DELETE FROM ai_knowledge_chunks WHERE workspace_id = $1 AND source_id = $2", [workspaceId, sourceId]);
    const created: AiKnowledgeChunkRecord[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const { rows } = await client.query(
        `INSERT INTO ai_knowledge_chunks (workspace_id, source_id, position, content)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [workspaceId, sourceId, i, chunks[i]],
      );
      created.push(rowToAiChunk(rows[0]));
    }
    return created;
  });
}

export async function listKnowledgeChunks(deps: PostgresDeps, workspaceId: string): Promise<AiKnowledgeChunkRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query("SELECT * FROM ai_knowledge_chunks WHERE workspace_id = $1 ORDER BY source_id, position", [workspaceId]);
    return rows.map(rowToAiChunk);
  });
}

export async function addAiLog(deps: PostgresDeps, input: {
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
}): Promise<AiLogRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ai_logs (workspace_id, conversation_id, provider_kind, model, question, answer, sources, prompt, input_tokens, output_tokens, cost_usd, latency_ms, outcome, fallback_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [input.workspaceId, input.conversationId ?? null, input.providerKind ?? null, input.model ?? null, input.question, input.answer ?? null, JSON.stringify(input.sources ?? []), input.prompt ?? null, input.inputTokens ?? null, input.outputTokens ?? null, input.costUsd ?? null, input.latencyMs ?? null, input.outcome, input.fallbackReason ?? null],
    );
    return rowToAiLog(rows[0]);
  });
}

export async function listAiLogs(deps: PostgresDeps, workspaceId: string, limit = 100): Promise<AiLogRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query("SELECT * FROM ai_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2", [workspaceId, limit]);
    return rows.map(rowToAiLog);
  });
}

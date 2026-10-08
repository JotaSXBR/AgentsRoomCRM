-- F4 — IA híbrida: BYOK OpenAI-compatível + Ollama, RAG por workspace, logs.
-- Mesmas regras da F0–F3: RLS FORÇADO em todas as tabelas, contexto por
-- transação (`SET LOCAL app.current_workspace_id`), escrita só no workspace.

-- ---------------------------------------------------------------- tabelas ---
CREATE TABLE IF NOT EXISTS ai_settings (
  workspace_id     UUID NOT NULL PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  system_prompt    TEXT NOT NULL DEFAULT 'Você é um assistente de atendimento. Responda apenas com base no contexto fornecido e cite as fontes.',
  fallback_message TEXT NOT NULL DEFAULT 'Vou transferir você para um atendente humano.',
  max_chunks       INTEGER NOT NULL DEFAULT 3,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_providers (
  workspace_id         UUID NOT NULL PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL
    CONSTRAINT ai_providers_kind_check CHECK (kind IN ('openai_compatible', 'ollama')),
  base_url             TEXT NOT NULL,
  model                TEXT NOT NULL,
  -- Chave BYOK cifrada (AES-256-GCM) — a API nunca devolve este campo.
  api_key_enc          TEXT,
  price_input_per_mtok  NUMERIC,
  price_output_per_mtok NUMERIC,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL
    CONSTRAINT ai_knowledge_sources_kind_check CHECK (kind IN ('faq', 'documento', 'url')),
  title        TEXT NOT NULL,
  content      TEXT,
  url          TEXT,
  status       TEXT NOT NULL DEFAULT 'pronto'
    CONSTRAINT ai_knowledge_sources_status_check CHECK (status IN ('pronto', 'erro', 'vazio')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_workspace_idx
  ON ai_knowledge_sources (workspace_id, kind);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES ai_knowledge_sources (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_workspace_idx
  ON ai_knowledge_chunks (workspace_id, source_id);

CREATE TABLE IF NOT EXISTS ai_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
  provider_kind   TEXT,
  model           TEXT,
  question        TEXT NOT NULL,
  answer          TEXT,
  sources         JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt          TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_usd        NUMERIC,
  latency_ms      INTEGER,
  outcome         TEXT NOT NULL
    CONSTRAINT ai_logs_outcome_check CHECK (outcome IN ('respondido', 'fallback', 'erro')),
  fallback_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_logs_workspace_idx
  ON ai_logs (workspace_id, created_at);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE ai_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_settings            FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_providers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_providers           FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_sources   FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_chunks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_chunks    FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_logs                FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_settings_tenant ON ai_settings;
CREATE POLICY ai_settings_tenant ON ai_settings FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS ai_providers_tenant ON ai_providers;
CREATE POLICY ai_providers_tenant ON ai_providers FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS ai_knowledge_sources_tenant ON ai_knowledge_sources;
CREATE POLICY ai_knowledge_sources_tenant ON ai_knowledge_sources FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS ai_knowledge_chunks_tenant ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_tenant ON ai_knowledge_chunks FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS ai_logs_tenant ON ai_logs;
CREATE POLICY ai_logs_tenant ON ai_logs FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ai_settings, ai_providers, ai_knowledge_sources, ai_knowledge_chunks, ai_logs
  TO app_user;

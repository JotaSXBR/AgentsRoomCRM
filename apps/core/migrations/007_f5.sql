-- F5 — API pública por workspace, webhooks de saída, MCP, fluxos, CSAT e LGPD.
-- Mesmas regras da F0–F4: RLS FORÇADO em todas as tabelas, contexto por
-- transação (`SET LOCAL app.current_workspace_id`), escrita só no workspace.

-- ------------------------------------------------- chaves de API pública ---
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- Prefixo exibível (`ark_live_a1b2c3`) + hash do segredo completo (nunca o segredo).
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       JSONB NOT NULL DEFAULT '["mcp"]'::jsonb,
  created_by   UUID,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_keys_workspace_idx ON api_keys (workspace_id);

-- ------------------------------------------------ webhooks de saída (F5) ---
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  -- Segredo de assinatura HMAC: guardado para assinar, devolvido só na criação.
  secret       TEXT NOT NULL,
  events       JSONB NOT NULL DEFAULT '["*"]'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_workspace_idx
  ON webhook_endpoints (workspace_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  endpoint_id  UUID NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pendente'
    CONSTRAINT webhook_deliveries_status_check
    CHECK (status IN ('pendente', 'entregue', 'falhou')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_code   INTEGER,
  last_error      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries (workspace_id, status, next_attempt_at);

-- ------------------------------------------------------ CSAT (F5) ---
CREATE TABLE IF NOT EXISTS conversation_ratings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  score        SMALLINT NOT NULL
    CONSTRAINT conversation_ratings_score_check CHECK (score BETWEEN 1 AND 5),
  comment      TEXT,
  -- "atendente" (registro interno) | "cliente" (link público).
  source       TEXT NOT NULL DEFAULT 'atendente'
    CONSTRAINT conversation_ratings_source_check
    CHECK (source IN ('atendente', 'cliente')),
  rated_by     UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_ratings_unique
  ON conversation_ratings (workspace_id, conversation_id);
CREATE INDEX IF NOT EXISTS conversation_ratings_workspace_idx
  ON conversation_ratings (workspace_id, created_at);

-- --------------------------------------------------------- LGPD (F5) ---
CREATE TABLE IF NOT EXISTS contact_consents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  -- Finalidade do consentimento (LGPD art. 8º): dados/marketing/ia.
  kind         TEXT NOT NULL
    CONSTRAINT contact_consents_kind_check CHECK (kind IN ('dados', 'marketing', 'ia')),
  granted      BOOLEAN NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual',
  note         TEXT,
  granted_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_consents_unique
  ON contact_consents (workspace_id, contact_id, kind);
CREATE INDEX IF NOT EXISTS contact_consents_workspace_idx
  ON contact_consents (workspace_id);

-- Trilha de auditoria das solicitações do titular (acesso, exclusão).
CREATE TABLE IF NOT EXISTS lgpd_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- NULL = operação de workspace inteiro.
  contact_id   UUID,
  scope        TEXT NOT NULL
    CONSTRAINT lgpd_requests_scope_check CHECK (scope IN ('contato', 'workspace')),
  action       TEXT NOT NULL
    CONSTRAINT lgpd_requests_action_check CHECK (action IN ('acesso', 'exclusao')),
  status       TEXT NOT NULL DEFAULT 'concluido'
    CONSTRAINT lgpd_requests_status_check CHECK (status IN ('concluido', 'parcial')),
  summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lgpd_requests_workspace_idx
  ON lgpd_requests (workspace_id, created_at);

-- ------------------------------------------------ fluxos (módulos, F5) ---
-- Fluxo = gatilho por termos + passos ordenados executados no intake.
CREATE TABLE IF NOT EXISTS flows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  terms        JSONB NOT NULL DEFAULT '[]'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS flows_workspace_idx ON flows (workspace_id);

CREATE TABLE IF NOT EXISTS flow_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  flow_id      UUID NOT NULL REFERENCES flows (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  -- responder | menu | enfileirar | encerrar
  action       TEXT NOT NULL
    CONSTRAINT flow_steps_action_check
    CHECK (action IN ('responder', 'menu', 'enfileirar', 'encerrar')),
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS flow_steps_flow_idx
  ON flow_steps (workspace_id, flow_id, position);

-- ----------------------------------------------- módulos por workspace ---
CREATE TABLE IF NOT EXISTS workspace_modules (
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  module_key   TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, module_key)
);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE api_keys              ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys              FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints     ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints     FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries    FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_ratings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_ratings  FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_consents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents      FORCE ROW LEVEL SECURITY;
ALTER TABLE lgpd_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgpd_requests         FORCE ROW LEVEL SECURITY;
ALTER TABLE flows                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows                 FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_steps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_steps            FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_modules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_modules     FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_tenant ON api_keys;
CREATE POLICY api_keys_tenant ON api_keys FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS webhook_endpoints_tenant ON webhook_endpoints;
CREATE POLICY webhook_endpoints_tenant ON webhook_endpoints FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS webhook_deliveries_tenant ON webhook_deliveries;
CREATE POLICY webhook_deliveries_tenant ON webhook_deliveries FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS conversation_ratings_tenant ON conversation_ratings;
CREATE POLICY conversation_ratings_tenant ON conversation_ratings FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS contact_consents_tenant ON contact_consents;
CREATE POLICY contact_consents_tenant ON contact_consents FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS lgpd_requests_tenant ON lgpd_requests;
CREATE POLICY lgpd_requests_tenant ON lgpd_requests FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS flows_tenant ON flows;
CREATE POLICY flows_tenant ON flows FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS flow_steps_tenant ON flow_steps;
CREATE POLICY flow_steps_tenant ON flow_steps FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS workspace_modules_tenant ON workspace_modules;
CREATE POLICY workspace_modules_tenant ON workspace_modules FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON api_keys, webhook_endpoints, webhook_deliveries, conversation_ratings,
     contact_consents, lgpd_requests, flows, flow_steps, workspace_modules
  TO app_user;
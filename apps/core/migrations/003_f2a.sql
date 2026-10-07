-- F2a — widget do site, sessões WhatsApp (WAHA GOWS) e intake idempotente.
-- Mesmas regras da F0/F1: RLS FORÇADO em todas as tabelas, contexto por
-- transação (`SET LOCAL app.current_workspace_id`), escrita só no workspace.

-- Token de embutir widget: segredo fica só com o cliente; persiste o hash.
CREATE TABLE IF NOT EXISTS widget_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT widget_tokens_token_hash_key UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS widget_tokens_workspace_idx
  ON widget_tokens (workspace_id);

-- Sessões WhatsApp: 1+ por workspace; name é o identificador no WAHA.
CREATE TABLE IF NOT EXISTS waha_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  engine       TEXT NOT NULL DEFAULT 'GOWS',
  status       TEXT NOT NULL DEFAULT 'criada',
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT waha_sessions_name_key UNIQUE (name)
);
CREATE INDEX IF NOT EXISTS waha_sessions_workspace_idx
  ON waha_sessions (workspace_id);

-- Idempotência do intake: (workspace_id, source, external_id) único.
-- A segunda entrega do mesmo id externo é descartada como duplicata.
CREATE TABLE IF NOT EXISTS intake_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
  message_id      UUID REFERENCES messages (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT intake_events_dedup_key UNIQUE (workspace_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS intake_events_workspace_idx
  ON intake_events (workspace_id, created_at);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE widget_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE waha_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE waha_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE intake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_events FORCE ROW LEVEL SECURITY;

-- Lookups globais por segredo/capability (token hash, nome da sessão no
-- webhook) seguem o precedente de `invites`: SELECT aberto; o SEGREDO nunca
-- é persistido, só o hash/índice dele. Toda escrita continua tenant.
DROP POLICY IF EXISTS widget_tokens_select ON widget_tokens;
CREATE POLICY widget_tokens_select ON widget_tokens FOR SELECT TO app_user
  USING (true);
DROP POLICY IF EXISTS widget_tokens_insert ON widget_tokens;
CREATE POLICY widget_tokens_insert ON widget_tokens FOR INSERT TO app_user
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS widget_tokens_update ON widget_tokens;
CREATE POLICY widget_tokens_update ON widget_tokens FOR UPDATE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS widget_tokens_delete ON widget_tokens;
CREATE POLICY widget_tokens_delete ON widget_tokens FOR DELETE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS waha_sessions_select ON waha_sessions;
CREATE POLICY waha_sessions_select ON waha_sessions FOR SELECT TO app_user
  USING (true);
DROP POLICY IF EXISTS waha_sessions_insert ON waha_sessions;
CREATE POLICY waha_sessions_insert ON waha_sessions FOR INSERT TO app_user
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS waha_sessions_update ON waha_sessions;
CREATE POLICY waha_sessions_update ON waha_sessions FOR UPDATE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS waha_sessions_delete ON waha_sessions;
CREATE POLICY waha_sessions_delete ON waha_sessions FOR DELETE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS intake_events_tenant ON intake_events;
CREATE POLICY intake_events_tenant ON intake_events FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON widget_tokens, waha_sessions, intake_events
  TO app_user;

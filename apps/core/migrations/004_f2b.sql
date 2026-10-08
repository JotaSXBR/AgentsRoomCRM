-- F2b — Meta oficial (Página/IG) + e-mail por workspace + fila de saída.
-- Mesmas regras da F0/F1/F2a: RLS FORÇADO em todas as tabelas, contexto por
-- transação (`SET LOCAL app.current_workspace_id`), escrita só no workspace.
--
-- Segredos (page access token, senhas SMTP/IMAP) ficam cifrados (AES-256-GCM)
-- em `*_enc`; a API nunca devolve essas colunas (respostas redigidas).
-- O webhook da Meta resolve workspace via `meta_page_index` (só ids, sem
-- segredo), seguindo o precedente de `waha_sessions`: SELECT aberto no índice,
-- escrita sempre tenant.

-- Conexão Meta por workspace: 1 Página (+ IG vinculado) por workspace.
CREATE TABLE IF NOT EXISTS meta_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id           TEXT NOT NULL,
  page_name         TEXT,
  ig_user_id        TEXT,
  access_token_enc  TEXT NOT NULL,
  token_expires_at  TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'conectada',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_connections_workspace_key UNIQUE (workspace_id),
  CONSTRAINT meta_connections_page_key UNIQUE (page_id)
);
CREATE INDEX IF NOT EXISTS meta_connections_workspace_idx
  ON meta_connections (workspace_id);

-- Índice público Página → workspace (só ids, sem segredo): o webhook da Meta
-- chega sem autenticação de workspace e precisa descobrir o dono pela page_id.
CREATE TABLE IF NOT EXISTS meta_page_index (
  page_id      TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS meta_page_index_workspace_idx
  ON meta_page_index (workspace_id);

-- Mailbox por workspace: envio SMTP + recebimento IMAP (polling/IDLE).
CREATE TABLE IF NOT EXISTS mailboxes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  from_email    TEXT NOT NULL,
  from_name     TEXT,
  smtp_host     TEXT NOT NULL,
  smtp_port     INT NOT NULL DEFAULT 587,
  smtp_user     TEXT NOT NULL,
  smtp_pass_enc TEXT NOT NULL,
  imap_host     TEXT NOT NULL,
  imap_port     INT NOT NULL DEFAULT 993,
  imap_user     TEXT NOT NULL,
  imap_pass_enc TEXT NOT NULL,
  last_uid      TEXT,
  status        TEXT NOT NULL DEFAULT 'ativa',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mailboxes_workspace_idx
  ON mailboxes (workspace_id);

-- Fila de saída com backoff: toda resposta do atendente para Meta/e-mail
-- passa por aqui (envio assíncrono, retry exponencial, sem cruzar workspaces).
CREATE TABLE IF NOT EXISTS outbound_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  conversation_id     UUID REFERENCES conversations (id) ON DELETE SET NULL,
  message_id          UUID REFERENCES messages (id) ON DELETE SET NULL,
  mailbox_id          UUID REFERENCES mailboxes (id) ON DELETE SET NULL,
  to_value            TEXT NOT NULL,
  subject             TEXT,
  text                TEXT,
  status              TEXT NOT NULL DEFAULT 'pendente',
  attempts            INT NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error          TEXT,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS outbound_queue_workspace_idx
  ON outbound_queue (workspace_id);
CREATE INDEX IF NOT EXISTS outbound_queue_due_idx
  ON outbound_queue (workspace_id, status, next_attempt_at);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE meta_page_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_page_index FORCE ROW LEVEL SECURITY;
ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailboxes FORCE ROW LEVEL SECURITY;
ALTER TABLE outbound_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_queue FORCE ROW LEVEL SECURITY;

-- Conexão Meta: tenant estrita (o token cifrado nunca sai do workspace).
DROP POLICY IF EXISTS meta_connections_tenant ON meta_connections;
CREATE POLICY meta_connections_tenant ON meta_connections FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

-- Índice Página → workspace: SELECT aberto (só ids, precede waha_sessions);
-- escrita sempre tenant.
DROP POLICY IF EXISTS meta_page_index_select ON meta_page_index;
CREATE POLICY meta_page_index_select ON meta_page_index FOR SELECT TO app_user
  USING (true);
DROP POLICY IF EXISTS meta_page_index_insert ON meta_page_index;
CREATE POLICY meta_page_index_insert ON meta_page_index FOR INSERT TO app_user
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS meta_page_index_update ON meta_page_index;
CREATE POLICY meta_page_index_update ON meta_page_index FOR UPDATE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS meta_page_index_delete ON meta_page_index;
CREATE POLICY meta_page_index_delete ON meta_page_index FOR DELETE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS mailboxes_tenant ON mailboxes;
CREATE POLICY mailboxes_tenant ON mailboxes FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS outbound_queue_tenant ON outbound_queue;
CREATE POLICY outbound_queue_tenant ON outbound_queue FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON meta_connections, meta_page_index, mailboxes, outbound_queue
  TO app_user;

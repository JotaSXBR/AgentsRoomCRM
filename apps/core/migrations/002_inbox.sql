-- F1 — inbox unificado, contatos multicanal, tags, notas, timeline, realtime.
-- Mesmas regras da F0: RLS FORÇADO em todas as tabelas, contexto por transação
-- (`SET LOCAL app.current_workspace_id`), escrita só dentro do workspace.

-- Contato absorvido por merge aponta para o sobrevivente.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES contacts (id);
CREATE INDEX IF NOT EXISTS contacts_merged_into_id_idx
  ON contacts (merged_into_id);

-- ---------------------------------------------------------------- tabelas ---
CREATE TABLE IF NOT EXISTS contact_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  value        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_channels_workspace_idx
  ON contact_channels (workspace_id, contact_id);

CREATE TABLE IF NOT EXISTS tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tags_workspace_name_key UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts (id),
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'aberto'
    CONSTRAINT conversations_status_check
    CHECK (status IN ('aberto', 'pendente', 'resolvido')),
  assignee_id  UUID REFERENCES users (id),
  subject      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_workspace_idx
  ON conversations (workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS conversation_tags (
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  tag_id          UUID NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_tags_pkey
    PRIMARY KEY (workspace_id, conversation_id, tag_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  direction       TEXT NOT NULL
    CONSTRAINT messages_direction_check
    CHECK (direction IN ('entrada', 'saida')),
  author_id       UUID REFERENCES users (id),
  kind            TEXT NOT NULL DEFAULT 'texto'
    CONSTRAINT messages_kind_check
    CHECK (kind IN ('texto', 'midia', 'sistema')),
  text            TEXT,
  media_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_workspace_idx
  ON messages (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES users (id),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notes_conversation_idx
  ON notes (conversation_id, created_at);

-- Linha do tempo do contato (merge, sistema, interações).
CREATE TABLE IF NOT EXISTS contact_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  actor_id        UUID REFERENCES users (id),
  description     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_events_contact_idx
  ON contact_events (contact_id, created_at);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE contact_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags             FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations    FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         FORCE ROW LEVEL SECURITY;
ALTER TABLE notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes            FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_events   FORCE ROW LEVEL SECURITY;

-- Isolamento total: só passa quem tem o contexto do workspace.
DROP POLICY IF EXISTS contact_channels_tenant ON contact_channels;
CREATE POLICY contact_channels_tenant ON contact_channels FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS tags_tenant ON tags;
CREATE POLICY tags_tenant ON tags FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS conversations_tenant ON conversations;
CREATE POLICY conversations_tenant ON conversations FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS conversation_tags_tenant ON conversation_tags;
CREATE POLICY conversation_tags_tenant ON conversation_tags FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS messages_tenant ON messages;
CREATE POLICY messages_tenant ON messages FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS notes_tenant ON notes;
CREATE POLICY notes_tenant ON notes FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS contact_events_tenant ON contact_events;
CREATE POLICY contact_events_tenant ON contact_events FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON contact_channels, tags, conversations, conversation_tags, messages, notes, contact_events
  TO app_user;

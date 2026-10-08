-- F3 — bot por regras, filas/distribuição e SLA básico.
-- Mesmas regras da F0–F2b: RLS FORÇADO em todas as tabelas, contexto por
-- transação (`SET LOCAL app.current_workspace_id`), escrita só no workspace.

-- ---------------------------------------------------------------- tabelas ---
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id    UUID NOT NULL PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  absence_message TEXT NOT NULL DEFAULT 'Olá! Estamos fora do horário de atendimento no momento. Deixe sua mensagem que retornaremos em breve.',
  -- Chaves "0".."6" (getDay: 0=domingo). Valor: lista de faixas ["HH:MM","HH:MM"].
  business_hours  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  channel      TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT queues_workspace_name_key UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS queues_workspace_idx ON queues (workspace_id);

CREATE TABLE IF NOT EXISTS queue_members (
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  queue_id     UUID NOT NULL REFERENCES queues (id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT queue_members_pkey PRIMARY KEY (workspace_id, queue_id, user_id)
);

CREATE TABLE IF NOT EXISTS queue_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  queue_id          UUID NOT NULL REFERENCES queues (id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  channel           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'aguardando'
    CONSTRAINT queue_tickets_status_check
    CHECK (status IN ('aguardando', 'em_atendimento', 'resolvido', 'cancelado')),
  assigned_user_id  UUID REFERENCES users (id),
  enqueued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS queue_tickets_workspace_idx
  ON queue_tickets (workspace_id, status);
CREATE INDEX IF NOT EXISTS queue_tickets_assignee_idx
  ON queue_tickets (workspace_id, assigned_user_id);
CREATE INDEX IF NOT EXISTS queue_tickets_conversation_idx
  ON queue_tickets (conversation_id);

CREATE TABLE IF NOT EXISTS bot_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL
    CONSTRAINT bot_rules_kind_check CHECK (kind IN ('palavra_chave', 'menu', 'triagem')),
  priority     INTEGER NOT NULL DEFAULT 100,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  terms        JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply        TEXT,
  options      JSONB NOT NULL DEFAULT '[]'::jsonb,
  queue_id     UUID REFERENCES queues (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bot_rules_workspace_idx ON bot_rules (workspace_id, active, priority);

CREATE TABLE IF NOT EXISTS bot_sessions (
  conversation_id UUID PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  state           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE queues             ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues             FORCE ROW LEVEL SECURITY;
ALTER TABLE queue_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_members      FORCE ROW LEVEL SECURITY;
ALTER TABLE queue_tickets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_tickets      FORCE ROW LEVEL SECURITY;
ALTER TABLE bot_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_rules          FORCE ROW LEVEL SECURITY;
ALTER TABLE bot_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_sessions       FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_settings_tenant ON workspace_settings;
CREATE POLICY workspace_settings_tenant ON workspace_settings FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS queues_tenant ON queues;
CREATE POLICY queues_tenant ON queues FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS queue_members_tenant ON queue_members;
CREATE POLICY queue_members_tenant ON queue_members FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS queue_tickets_tenant ON queue_tickets;
CREATE POLICY queue_tickets_tenant ON queue_tickets FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS bot_rules_tenant ON bot_rules;
CREATE POLICY bot_rules_tenant ON bot_rules FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

DROP POLICY IF EXISTS bot_sessions_tenant ON bot_sessions;
CREATE POLICY bot_sessions_tenant ON bot_sessions FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON workspace_settings, queues, queue_members, queue_tickets, bot_rules, bot_sessions
  TO app_user;

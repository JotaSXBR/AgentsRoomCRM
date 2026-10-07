-- F0 — fundação: schema + RLS em TODAS as tabelas.
-- Aplicada pelo role migrador (`npm run migrate`, DATABASE_URL_MIGRATOR).
-- O placeholder ${APP_DB_PASSWORD} é substituído pelo migrate.ts (env APP_DB_PASSWORD).
-- RLS é FORÇADO (FORCE) para valer até para o owner: só passa quem tem contexto.
-- Contexto por transação: SET LOCAL app.current_workspace_id / app.current_user_id
-- (ver PostgresStore.withWorkspace e @agentsroom/db).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- role app ---
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD}';
  ELSE
    ALTER ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
END $$;

GRANT CONNECT ON DATABASE agentsroom TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- ---------------------------------------------------------------- tabelas ---
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  is_owner_global BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspaces_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         TEXT NOT NULL
    CONSTRAINT workspace_members_role_check
    CHECK (role IN ('admin_ws', 'supervisor', 'atendente')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL
    CONSTRAINT invites_role_check
    CHECK (role IN ('admin_ws', 'supervisor', 'atendente')),
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_by   UUID NOT NULL REFERENCES users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invites_token_hash_key UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS invites_workspace_id_idx ON invites (workspace_id);

-- Entidade tenant de exemplo (prova de isolamento cross-workspace).
CREATE TABLE IF NOT EXISTS contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contacts_workspace_id_idx
  ON contacts (workspace_id, created_at);

-- ------------------------------------------------- RLS em TODAS -------
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              FORCE ROW LEVEL SECURITY;
ALTER TABLE workspaces         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces         FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members  FORCE ROW LEVEL SECURITY;
ALTER TABLE invites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites            FORCE ROW LEVEL SECURITY;
ALTER TABLE contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts           FORCE ROW LEVEL SECURITY;

-- users e workspaces são GLOBAIS (sem workspace_id): autorização na camada app
-- (requireWorkspace + RBAC). RLS fica ativo e permissivo para o app_user.
DROP POLICY IF EXISTS users_app ON users;
CREATE POLICY users_app ON users FOR ALL TO app_user
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspaces_app ON workspaces;
CREATE POLICY workspaces_app ON workspaces FOR ALL TO app_user
  USING (true) WITH CHECK (true);

-- workspace_members: leitura escopada ao workspace OU às próprias memberships
-- (lista "meus workspaces" fixa só app.current_user_id); escrita só no workspace.
DROP POLICY IF EXISTS workspace_members_select ON workspace_members;
CREATE POLICY workspace_members_select ON workspace_members FOR SELECT TO app_user
  USING (
    workspace_id::text = current_setting('app.current_workspace_id', true)
    OR user_id::text = current_setting('app.current_user_id', true)
  );

DROP POLICY IF EXISTS workspace_members_write ON workspace_members;
CREATE POLICY workspace_members_write ON workspace_members
  FOR INSERT TO app_user
  WITH CHECK (
    workspace_id::text = current_setting('app.current_workspace_id', true)
  );
DROP POLICY IF EXISTS workspace_members_update ON workspace_members;
CREATE POLICY workspace_members_update ON workspace_members
  FOR UPDATE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS workspace_members_delete ON workspace_members;
CREATE POLICY workspace_members_delete ON workspace_members
  FOR DELETE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

-- invites: leitura por token opaco (capability de 256 bits, só quem tem o link);
-- escrita estritamente no workspace.
DROP POLICY IF EXISTS invites_select ON invites;
CREATE POLICY invites_select ON invites FOR SELECT TO app_user USING (true);

DROP POLICY IF EXISTS invites_insert ON invites;
CREATE POLICY invites_insert ON invites FOR INSERT TO app_user
  WITH CHECK (
    workspace_id::text = current_setting('app.current_workspace_id', true)
  );
DROP POLICY IF EXISTS invites_update ON invites;
CREATE POLICY invites_update ON invites FOR UPDATE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));
DROP POLICY IF EXISTS invites_delete ON invites;
CREATE POLICY invites_delete ON invites FOR DELETE TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true));

-- contacts: isolamento TOTAL — sem contexto do workspace, nada passa.
DROP POLICY IF EXISTS contacts_tenant ON contacts;
CREATE POLICY contacts_tenant ON contacts FOR ALL TO app_user
  USING (workspace_id::text = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('app.current_workspace_id', true));

-- ---------------------------------------------------------------- grants ---
GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, workspaces, workspace_members, invites, contacts
  TO app_user;

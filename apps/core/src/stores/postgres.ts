import { Pool, type PoolClient } from "pg";
import { setUserContextSql, setWorkspaceContextSql } from "@agentsroom/db";
import type {
  ContactRecord,
  InviteRecord,
  MembershipRecord,
  MemberWithUser,
  Store,
  UserRecord,
  WorkspaceRecord,
} from "./store.js";

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    name: String(row.name),
    isOwnerGlobal: Boolean(row.is_owner_global),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/**
 * Persistência Postgres com RLS (F0).
 * Cada operação tenant roda em transação com `SET LOCAL app.current_workspace_id`,
 * de modo que as policies RLS valem mesmo se a cláusula `workspace_id` for omitida.
 * O role de conexão do app (`app_user`) NÃO tem BYPASSRLS (ver migrations).
 */
export class PostgresStore implements Store {
  constructor(private readonly pool: Pool) {}

  /** Executa `fn` com o contexto RLS do workspace fixado na transação. */
  async withWorkspace<T>(
    workspaceId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ctx = setWorkspaceContextSql(workspaceId);
      await client.query(ctx.text, ctx.values);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async countUsers(): Promise<number> {
    const { rows } = await this.pool.query("SELECT COUNT(*)::int AS n FROM users");
    return Number(rows[0].n);
  }

  async createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    isOwnerGlobal: boolean;
  }): Promise<UserRecord> {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO users (email, password_hash, name, is_owner_global)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.email.toLowerCase(), input.passwordHash, input.name, input.isOwnerGlobal],
      );
      return rowToUser(rows[0]);
    } catch (error) {
      if (String((error as Error).message).includes("users_email_key")) {
        throw new Error("email_em_uso");
      }
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async createWorkspace(input: { name: string; slug: string }): Promise<WorkspaceRecord> {
    try {
      const { rows } = await this.pool.query(
        "INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING *",
        [input.name, input.slug],
      );
      return rowToWorkspace(rows[0]);
    } catch (error) {
      if (String((error as Error).message).includes("workspaces_slug_key")) {
        throw new Error("slug_em_uso");
      }
      throw error;
    }
  }

  async findWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM workspaces WHERE id = $1", [id]);
    return rows[0] ? rowToWorkspace(rows[0]) : null;
  }

  async findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> {
    const { rows } = await this.pool.query("SELECT * FROM workspaces WHERE slug = $1", [
      slug,
    ]);
    return rows[0] ? rowToWorkspace(rows[0]) : null;
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const { rows } = await this.pool.query("SELECT * FROM workspaces ORDER BY created_at");
    return rows.map(rowToWorkspace);
  }

  async addMember(input: {
    workspaceId: string;
    userId: string;
    role: MembershipRecord["role"];
  }): Promise<MembershipRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id)
         DO UPDATE SET role = EXCLUDED.role
         RETURNING workspace_id, user_id, role, created_at`,
        [input.workspaceId, input.userId, input.role],
      );
      const row = rows[0];
      return {
        workspaceId: String(row.workspace_id),
        userId: String(row.user_id),
        role: row.role,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT workspace_id, user_id, role, created_at
           FROM workspace_members
          WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      if (!rows[0]) return null;
      return {
        workspaceId: String(rows[0].workspace_id),
        userId: String(rows[0].user_id),
        role: rows[0].role,
        createdAt: new Date(rows[0].created_at).toISOString(),
      };
    });
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT m.workspace_id, m.user_id, m.role, m.created_at, u.email, u.name
           FROM workspace_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = $1
          ORDER BY u.email`,
        [workspaceId],
      );
      return rows.map((row) => ({
        workspaceId: String(row.workspace_id),
        userId: String(row.user_id),
        role: row.role,
        createdAt: new Date(row.created_at).toISOString(),
        email: String(row.email),
        name: String(row.name),
      }));
    });
  }

  async listMembershipsByUser(userId: string): Promise<MembershipRecord[]> {
    // Contexto só de usuário: a policy workspace_members_select permite
    // `user_id = app.current_user_id` (lista "meus workspaces").
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ctx = setUserContextSql(userId);
      await client.query(ctx.text, ctx.values);
      const { rows } = await client.query(
        `SELECT workspace_id, user_id, role, created_at
           FROM workspace_members WHERE user_id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return rows.map((row) => ({
        workspaceId: String(row.workspace_id),
        userId: String(row.user_id),
        role: row.role,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvite(input: {
    workspaceId: string;
    email: string;
    role: InviteRecord["role"];
    tokenHash: string;
    expiresAt: string;
    createdBy: string;
  }): Promise<InviteRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO invites (workspace_id, email, role, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          input.workspaceId,
          input.email.toLowerCase(),
          input.role,
          input.tokenHash,
          input.expiresAt,
          input.createdBy,
        ],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        email: String(row.email),
        role: row.role,
        tokenHash: String(row.token_hash),
        expiresAt: new Date(row.expires_at).toISOString(),
        acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
        createdBy: String(row.created_by),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async findInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    // Busca por hash fora de contexto tenant; o aceite valida o workspace depois.
    const { rows } = await this.pool.query("SELECT * FROM invites WHERE token_hash = $1", [
      tokenHash,
    ]);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      email: String(row.email),
      role: row.role,
      tokenHash: String(row.token_hash),
      expiresAt: new Date(row.expires_at).toISOString(),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
      createdBy: String(row.created_by),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async markInviteAccepted(id: string, workspaceId: string): Promise<void> {
    // Dentro do contexto do workspace: a policy invites_update exige.
    await this.withWorkspace(workspaceId, async (client) => {
      await client.query("UPDATE invites SET accepted_at = NOW() WHERE id = $1", [id]);
    });
  }

  async createContact(input: {
    workspaceId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  }): Promise<ContactRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO contacts (workspace_id, name, phone, email)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.workspaceId, input.name, input.phone ?? null, input.email ?? null],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        name: String(row.name),
        phone: row.phone,
        email: row.email,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async listContacts(workspaceId: string): Promise<ContactRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM contacts WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        name: String(row.name),
        phone: row.phone,
        email: row.email,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    });
  }
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

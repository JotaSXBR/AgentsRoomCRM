import { Pool, type PoolClient } from "pg";
import { setUserContextSql, setWorkspaceContextSql } from "@agentsroom/db";
import type {
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
  ConversationRecord,
  ConversationStatus,
  InviteRecord,
  MembershipRecord,
  MemberWithUser,
  MessageRecord,
  NoteRecord,
  Store,
  TagRecord,
  UserRecord,
  WorkspaceRecord,
  WorkspaceUpdates,
} from "./store.js";

function rowToContact(row: Record<string, unknown>): ContactRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    mergedIntoId: (row.merged_into_id as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToConversation(row: Record<string, unknown>): ConversationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    channel: String(row.channel),
    status: row.status as ConversationStatus,
    assigneeId: (row.assignee_id as string) ?? null,
    subject: (row.subject as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function rowToMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    direction: row.direction as MessageRecord["direction"],
    authorId: (row.author_id as string) ?? null,
    kind: row.kind as MessageRecord["kind"],
    text: (row.text as string) ?? null,
    mediaUrl: (row.media_url as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToNote(row: Record<string, unknown>): NoteRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    authorId: String(row.author_id),
    content: String(row.content),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToTag(row: Record<string, unknown>): TagRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    color: (row.color as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

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
        mergedIntoId: row.merged_into_id ?? null,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async listContacts(
    workspaceId: string,
    query?: { q?: string },
  ): Promise<ContactRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const q = query?.q?.trim();
      const { rows } = q
        ? await client.query(
            `SELECT * FROM contacts
              WHERE workspace_id = $1 AND merged_into_id IS NULL
                AND (name ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
              ORDER BY created_at`,
            [workspaceId, q],
          )
        : await client.query(
            "SELECT * FROM contacts WHERE workspace_id = $1 AND merged_into_id IS NULL ORDER BY created_at",
            [workspaceId],
          );
      return rows.map(rowToContact);
    });
  }

  async findContactById(
    workspaceId: string,
    id: string,
  ): Promise<ContactRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToContact(rows[0]) : null;
    });
  }

  async addContactChannel(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    value: string;
  }): Promise<ContactChannelRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO contact_channels (workspace_id, contact_id, channel, value)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.workspaceId, input.contactId, input.channel, input.value],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        contactId: String(row.contact_id),
        channel: String(row.channel),
        value: String(row.value),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async listContactChannels(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactChannelRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM contact_channels WHERE workspace_id = $1 AND contact_id = $2 ORDER BY created_at",
        [workspaceId, contactId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        contactId: String(row.contact_id),
        channel: String(row.channel),
        value: String(row.value),
        createdAt: new Date(row.created_at).toISOString(),
      }));
    });
  }

  async mergeContacts(
    workspaceId: string,
    sourceId: string,
    targetId: string,
  ): Promise<ContactRecord> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows: sources } = await client.query(
        "SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2",
        [sourceId, workspaceId],
      );
      const { rows: targets } = await client.query(
        "SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2",
        [targetId, workspaceId],
      );
      if (!sources[0] || !targets[0] || sourceId === targetId) {
        throw new Error("merge_invalido");
      }
      await client.query(
        "UPDATE contact_channels SET contact_id = $2 WHERE contact_id = $1 AND workspace_id = $3",
        [sourceId, targetId, workspaceId],
      );
      await client.query(
        "UPDATE conversations SET contact_id = $2, updated_at = NOW() WHERE contact_id = $1 AND workspace_id = $3",
        [sourceId, targetId, workspaceId],
      );
      await client.query(
        "UPDATE contact_events SET contact_id = $2 WHERE contact_id = $1 AND workspace_id = $3",
        [sourceId, targetId, workspaceId],
      );
      await client.query(
        "UPDATE contacts SET merged_into_id = $2 WHERE id = $1",
        [sourceId, targetId],
      );
      await client.query(
        `INSERT INTO contact_events (workspace_id, contact_id, kind, description)
         VALUES ($1, $2, 'merge', $3)`,
        [workspaceId, targetId, `Contato ${sources[0].name} unificado em ${targets[0].name}.`],
      );
      return rowToContact(targets[0]);
    });
  }

  async contactTimeline(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactEventRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM contact_events WHERE workspace_id = $1 AND contact_id = $2 ORDER BY created_at",
        [workspaceId, contactId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        contactId: String(row.contact_id),
        conversationId: (row.conversation_id as string) ?? null,
        kind: String(row.kind),
        actorId: (row.actor_id as string) ?? null,
        description: String(row.description),
        createdAt: new Date(row.created_at).toISOString(),
      }));
    });
  }

  async addContactEvent(input: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    kind: string;
    actorId?: string | null;
    description: string;
  }): Promise<ContactEventRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO contact_events (workspace_id, contact_id, conversation_id, kind, actor_id, description)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          input.workspaceId,
          input.contactId,
          input.conversationId ?? null,
          input.kind,
          input.actorId ?? null,
          input.description,
        ],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        contactId: String(row.contact_id),
        conversationId: (row.conversation_id as string) ?? null,
        kind: String(row.kind),
        actorId: (row.actor_id as string) ?? null,
        description: String(row.description),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async createTag(input: {
    workspaceId: string;
    name: string;
    color?: string | null;
  }): Promise<TagRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tags (workspace_id, name, color) VALUES ($1, $2, $3) RETURNING *`,
        [input.workspaceId, input.name, input.color ?? null],
      );
      return rowToTag(rows[0]);
    });
  }

  async listTags(workspaceId: string): Promise<TagRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM tags WHERE workspace_id = $1 ORDER BY name",
        [workspaceId],
      );
      return rows.map(rowToTag);
    });
  }

  async tagConversation(
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    await this.withWorkspace(workspaceId, async (client) => {
      const { rows: conv } = await client.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2",
        [conversationId, workspaceId],
      );
      const { rows: tag } = await client.query(
        "SELECT 1 FROM tags WHERE id = $1 AND workspace_id = $2",
        [tagId, workspaceId],
      );
      if (!conv[0] || !tag[0]) throw new Error("tag_invalida");
      await client.query(
        `INSERT INTO conversation_tags (workspace_id, conversation_id, tag_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [workspaceId, conversationId, tagId],
      );
    });
  }

  async untagConversation(
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    await this.withWorkspace(workspaceId, async (client) => {
      await client.query(
        "DELETE FROM conversation_tags WHERE workspace_id = $1 AND conversation_id = $2 AND tag_id = $3",
        [workspaceId, conversationId, tagId],
      );
    });
  }

  async listConversationTags(
    workspaceId: string,
    conversationId: string,
  ): Promise<TagRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT t.* FROM tags t
           JOIN conversation_tags ct ON ct.tag_id = t.id
          WHERE ct.workspace_id = $1 AND ct.conversation_id = $2`,
        [workspaceId, conversationId],
      );
      return rows.map(rowToTag);
    });
  }

  async createConversation(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    subject?: string | null;
  }): Promise<ConversationRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows: contactRows } = await client.query(
        "SELECT 1 FROM contacts WHERE id = $1 AND workspace_id = $2",
        [input.contactId, input.workspaceId],
      );
      if (!contactRows[0]) throw new Error("contato_invalido");
      const { rows } = await client.query(
        `INSERT INTO conversations (workspace_id, contact_id, channel, subject)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.workspaceId, input.contactId, input.channel, input.subject ?? null],
      );
      return rowToConversation(rows[0]);
    });
  }

  async findConversationById(
    workspaceId: string,
    id: string,
  ): Promise<ConversationRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM conversations WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

  async listConversations(
    workspaceId: string,
    filter?: {
      status?: ConversationStatus;
      assigneeId?: string;
      tagId?: string;
      q?: string;
    },
  ): Promise<ConversationRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const params: unknown[] = [workspaceId];
      let sql = `SELECT DISTINCT c.* FROM conversations c
        LEFT JOIN contacts co ON co.id = c.contact_id
        LEFT JOIN conversation_tags ct ON ct.conversation_id = c.id
       WHERE c.workspace_id = $1`;
      if (filter?.status) {
        params.push(filter.status);
        sql += ` AND c.status = $${params.length}`;
      }
      if (filter?.assigneeId) {
        params.push(filter.assigneeId);
        sql += ` AND c.assignee_id = $${params.length}`;
      }
      if (filter?.tagId) {
        params.push(filter.tagId);
        sql += ` AND ct.tag_id = $${params.length}`;
      }
      if (filter?.q) {
        params.push(`%${filter.q}%`);
        sql += ` AND (c.subject ILIKE $${params.length} OR co.name ILIKE $${params.length})`;
      }
      sql += " ORDER BY c.updated_at DESC";
      const { rows } = await client.query(sql, params);
      return rows.map(rowToConversation);
    });
  }

  async setConversationStatus(
    workspaceId: string,
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "UPDATE conversations SET status = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING *",
        [id, workspaceId, status],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

  async assignConversation(
    workspaceId: string,
    id: string,
    assigneeId: string | null,
  ): Promise<ConversationRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      if (assigneeId) {
        const { rows } = await client.query(
          "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
          [workspaceId, assigneeId],
        );
        if (!rows[0]) throw new Error("assignee_invalido");
      }
      const { rows } = await client.query(
        "UPDATE conversations SET assignee_id = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING *",
        [id, workspaceId, assigneeId],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

  async addMessage(input: {
    workspaceId: string;
    conversationId: string;
    direction: MessageRecord["direction"];
    authorId?: string | null;
    kind?: MessageRecord["kind"];
    text?: string | null;
    mediaUrl?: string | null;
  }): Promise<MessageRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows: convRows } = await client.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2",
        [input.conversationId, input.workspaceId],
      );
      if (!convRows[0]) throw new Error("conversa_invalida");
      const { rows } = await client.query(
        `INSERT INTO messages (workspace_id, conversation_id, direction, author_id, kind, text, media_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          input.workspaceId,
          input.conversationId,
          input.direction,
          input.authorId ?? null,
          input.kind ?? "texto",
          input.text ?? null,
          input.mediaUrl ?? null,
        ],
      );
      await client.query(
        "UPDATE conversations SET updated_at = NOW() WHERE id = $1 AND workspace_id = $2",
        [input.conversationId, input.workspaceId],
      );
      return rowToMessage(rows[0]);
    });
  }

  async listMessages(
    workspaceId: string,
    conversationId: string,
    options?: { since?: string },
  ): Promise<MessageRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = options?.since
        ? await client.query(
            "SELECT * FROM messages WHERE workspace_id = $1 AND conversation_id = $2 AND created_at > $3 ORDER BY created_at",
            [workspaceId, conversationId, options.since],
          )
        : await client.query(
            "SELECT * FROM messages WHERE workspace_id = $1 AND conversation_id = $2 ORDER BY created_at",
            [workspaceId, conversationId],
          );
      return rows.map(rowToMessage);
    });
  }

  async addNote(input: {
    workspaceId: string;
    conversationId: string;
    authorId: string;
    content: string;
  }): Promise<NoteRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows: convRows } = await client.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2",
        [input.conversationId, input.workspaceId],
      );
      if (!convRows[0]) throw new Error("conversa_invalida");
      const { rows } = await client.query(
        `INSERT INTO notes (workspace_id, conversation_id, author_id, content)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.workspaceId, input.conversationId, input.authorId, input.content],
      );
      return rowToNote(rows[0]);
    });
  }

  async listNotes(
    workspaceId: string,
    conversationId: string,
  ): Promise<NoteRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM notes WHERE workspace_id = $1 AND conversation_id = $2 ORDER BY created_at",
        [workspaceId, conversationId],
      );
      return rows.map(rowToNote);
    });
  }

  async listUpdates(workspaceId: string, since: string): Promise<WorkspaceUpdates> {
    return this.withWorkspace(workspaceId, async (client) => {
      const conversations = (
        await client.query(
          "SELECT * FROM conversations WHERE workspace_id = $1 AND updated_at > $2",
          [workspaceId, since],
        )
      ).rows.map(rowToConversation);
      const messages = (
        await client.query(
          "SELECT * FROM messages WHERE workspace_id = $1 AND created_at > $2",
          [workspaceId, since],
        )
      ).rows.map(rowToMessage);
      const notes = (
        await client.query(
          "SELECT * FROM notes WHERE workspace_id = $1 AND created_at > $2",
          [workspaceId, since],
        )
      ).rows.map(rowToNote);
      return { conversations, messages, notes };
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

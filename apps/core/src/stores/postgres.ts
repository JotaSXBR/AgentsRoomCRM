import { Pool, type PoolClient } from "pg";
import { setUserContextSql, setWorkspaceContextSql } from "@agentsroom/db";
import type {
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
  ConversationRecord,
  ConversationStatus,
  InviteRecord,
  MailboxRecord,
  MembershipRecord,
  MemberWithUser,
  MessageRecord,
  MetaConnectionRecord,
  NoteRecord,
  OutboundRecord,
  Store,
  TagRecord,
  UserRecord,
  WahaSessionRecord,
  WidgetTokenRecord,
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

  async createWidgetToken(input: {
    workspaceId: string;
    name: string;
    tokenHash: string;
  }): Promise<WidgetTokenRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO widget_tokens (workspace_id, name, token_hash)
         VALUES ($1, $2, $3) RETURNING *`,
        [input.workspaceId, input.name, input.tokenHash],
      );
      const row = rows[0];
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        name: String(row.name),
        tokenHash: String(row.token_hash),
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async listWidgetTokens(workspaceId: string): Promise<WidgetTokenRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM widget_tokens WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        name: String(row.name),
        tokenHash: String(row.token_hash),
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      }));
    });
  }

  async findWidgetTokenByHash(tokenHash: string): Promise<WidgetTokenRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM widget_tokens WHERE token_hash = $1",
      [tokenHash],
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      tokenHash: String(row.token_hash),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async revokeWidgetToken(workspaceId: string, id: string): Promise<boolean> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE widget_tokens SET revoked_at = NOW() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL",
        [id, workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

  async createWahaSession(input: {
    workspaceId: string;
    name: string;
    engine?: string;
  }): Promise<WahaSessionRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      try {
        const { rows } = await client.query(
          `INSERT INTO waha_sessions (workspace_id, name, engine)
           VALUES ($1, $2, $3) RETURNING *`,
          [input.workspaceId, input.name, input.engine ?? "GOWS"],
        );
        return rowToWahaSession(rows[0]);
      } catch (error) {
        if (String((error as Error).message).includes("waha_sessions_name_key")) {
          throw new Error("session_nome_em_uso");
        }
        throw error;
      }
    });
  }

  async listWahaSessions(workspaceId: string): Promise<WahaSessionRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM waha_sessions WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map(rowToWahaSession);
    });
  }

  async findWahaSessionById(
    workspaceId: string,
    id: string,
  ): Promise<WahaSessionRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM waha_sessions WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToWahaSession(rows[0]) : null;
    });
  }

  async findWahaSessionByName(name: string): Promise<WahaSessionRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM waha_sessions WHERE name = $1",
      [name],
    );
    return rows[0] ? rowToWahaSession(rows[0]) : null;
  }

  async updateWahaSession(
    workspaceId: string,
    id: string,
    patch: { status?: string; phone?: string | null },
  ): Promise<WahaSessionRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE waha_sessions
            SET status = COALESCE($3, status),
                phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
                updated_at = NOW()
          WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, patch.status ?? null, patch.phone !== undefined, patch.phone ?? null],
      );
      return rows[0] ? rowToWahaSession(rows[0]) : null;
    });
  }

  async claimIntakeEvent(input: {
    workspaceId: string;
    source: string;
    externalId: string;
  }): Promise<boolean> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rowCount } = await client.query(
        `INSERT INTO intake_events (workspace_id, source, external_id)
         VALUES ($1, $2, $3) ON CONFLICT (workspace_id, source, external_id) DO NOTHING`,
        [input.workspaceId, input.source, input.externalId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

  async linkIntakeEvent(input: {
    workspaceId: string;
    source: string;
    externalId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void> {
    await this.withWorkspace(input.workspaceId, async (client) => {
      await client.query(
        `UPDATE intake_events SET conversation_id = $4, message_id = $5
          WHERE workspace_id = $1 AND source = $2 AND external_id = $3`,
        [input.workspaceId, input.source, input.externalId, input.conversationId, input.messageId],
      );
    });
  }

  async findContactByChannel(
    workspaceId: string,
    channel: string,
    value: string,
  ): Promise<ContactRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT c.* FROM contacts c
           JOIN contact_channels ch ON ch.contact_id = c.id AND ch.workspace_id = c.workspace_id
          WHERE c.workspace_id = $1 AND ch.channel = $2 AND ch.value = $3 AND c.merged_into_id IS NULL
          ORDER BY c.created_at LIMIT 1`,
        [workspaceId, channel, value],
      );
      return rows[0] ? rowToContact(rows[0]) : null;
    });
  }

  async findContactByAnyChannelValue(
    workspaceId: string,
    value: string,
  ): Promise<ContactRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT c.* FROM contacts c
           JOIN contact_channels ch ON ch.contact_id = c.id AND ch.workspace_id = c.workspace_id
          WHERE c.workspace_id = $1 AND ch.value = $2 AND c.merged_into_id IS NULL
          ORDER BY c.created_at LIMIT 1`,
        [workspaceId, value],
      );
      return rows[0] ? rowToContact(rows[0]) : null;
    });
  }

  async findActiveConversation(
    workspaceId: string,
    contactId: string,
    channel: string,
  ): Promise<ConversationRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM conversations
          WHERE workspace_id = $1 AND contact_id = $2 AND channel = $3 AND status <> 'resolvido'
          ORDER BY updated_at DESC LIMIT 1`,
        [workspaceId, contactId, channel],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

  // ---- F2b: Meta oficial ----

  async saveMetaConnection(input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  }): Promise<MetaConnectionRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows: taken } = await client.query(
        "SELECT workspace_id FROM meta_page_index WHERE page_id = $1",
        [input.pageId],
      );
      if (taken[0] && String(taken[0].workspace_id) !== input.workspaceId) {
        throw new Error("pagina_em_uso");
      }
      const { rows } = await client.query(
        `INSERT INTO meta_connections
           (workspace_id, page_id, page_name, ig_user_id, access_token_enc, token_expires_at, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'conectada'), NOW())
         ON CONFLICT (workspace_id) DO UPDATE SET
           page_id = EXCLUDED.page_id,
           page_name = COALESCE(EXCLUDED.page_name, meta_connections.page_name),
           ig_user_id = COALESCE(EXCLUDED.ig_user_id, meta_connections.ig_user_id),
           access_token_enc = EXCLUDED.access_token_enc,
           token_expires_at = COALESCE(EXCLUDED.token_expires_at, meta_connections.token_expires_at),
           status = COALESCE(EXCLUDED.status, meta_connections.status),
           updated_at = NOW()
         RETURNING *`,
        [
          input.workspaceId,
          input.pageId,
          input.pageName ?? null,
          input.igUserId ?? null,
          input.accessTokenEnc,
          input.tokenExpiresAt ?? null,
          input.status ?? null,
        ],
      );
      await client.query("DELETE FROM meta_page_index WHERE workspace_id = $1 AND page_id <> $2", [
        input.workspaceId,
        input.pageId,
      ]);
      await client.query(
        `INSERT INTO meta_page_index (page_id, workspace_id) VALUES ($1, $2)
         ON CONFLICT (page_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id`,
        [input.pageId, input.workspaceId],
      );
      return rowToMetaConnection(rows[0]);
    });
  }

  async getMetaConnection(workspaceId: string): Promise<MetaConnectionRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM meta_connections WHERE workspace_id = $1",
        [workspaceId],
      );
      return rows[0] ? rowToMetaConnection(rows[0]) : null;
    });
  }

  async deleteMetaConnection(workspaceId: string): Promise<boolean> {
    return this.withWorkspace(workspaceId, async (client) => {
      await client.query("DELETE FROM meta_page_index WHERE workspace_id = $1", [workspaceId]);
      const { rowCount } = await client.query(
        "DELETE FROM meta_connections WHERE workspace_id = $1",
        [workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

  async findWorkspaceIdByMetaPage(pageId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT workspace_id FROM meta_page_index WHERE page_id = $1",
      [pageId],
    );
    return rows[0] ? String(rows[0].workspace_id) : null;
  }

  // ---- F2b: mailboxes ----

  async createMailbox(input: {
    workspaceId: string;
    name: string;
    fromEmail: string;
    fromName?: string | null;
    smtpHost: string;
    smtpPort?: number;
    smtpUser: string;
    smtpPassEnc: string;
    imapHost: string;
    imapPort?: number;
    imapUser: string;
    imapPassEnc: string;
  }): Promise<MailboxRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO mailboxes
           (workspace_id, name, from_email, from_name, smtp_host, smtp_port, smtp_user, smtp_pass_enc,
            imap_host, imap_port, imap_user, imap_pass_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          input.workspaceId,
          input.name,
          input.fromEmail.toLowerCase(),
          input.fromName ?? null,
          input.smtpHost,
          input.smtpPort ?? 587,
          input.smtpUser,
          input.smtpPassEnc,
          input.imapHost,
          input.imapPort ?? 993,
          input.imapUser,
          input.imapPassEnc,
        ],
      );
      return rowToMailbox(rows[0]);
    });
  }

  async listMailboxes(workspaceId: string): Promise<MailboxRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM mailboxes WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map(rowToMailbox);
    });
  }

  async findMailboxById(workspaceId: string, id: string): Promise<MailboxRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM mailboxes WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToMailbox(rows[0]) : null;
    });
  }

  async updateMailbox(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      fromName?: string | null;
      status?: string;
      lastUid?: string | null;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPassEnc?: string;
      imapHost?: string;
      imapPort?: number;
      imapUser?: string;
      imapPassEnc?: string;
    },
  ): Promise<MailboxRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE mailboxes SET
           name = COALESCE($3, name),
           from_name = CASE WHEN $4::boolean THEN $5 ELSE from_name END,
           status = COALESCE($6, status),
           last_uid = CASE WHEN $7::boolean THEN $8 ELSE last_uid END,
           smtp_host = COALESCE($9, smtp_host),
           smtp_port = COALESCE($10, smtp_port),
           smtp_user = COALESCE($11, smtp_user),
           smtp_pass_enc = COALESCE($12, smtp_pass_enc),
           imap_host = COALESCE($13, imap_host),
           imap_port = COALESCE($14, imap_port),
           imap_user = COALESCE($15, imap_user),
           imap_pass_enc = COALESCE($16, imap_pass_enc),
           updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        mailboxPatchParams(id, workspaceId, patch),
      );
      return rows[0] ? rowToMailbox(rows[0]) : null;
    });
  }

  async deleteMailbox(workspaceId: string, id: string): Promise<boolean> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "DELETE FROM mailboxes WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

  // ---- F2b: fila de saída ----

  async enqueueOutbound(input: {
    workspaceId: string;
    channel: string;
    conversationId?: string | null;
    messageId?: string | null;
    mailboxId?: string | null;
    toValue: string;
    subject?: string | null;
    text?: string | null;
  }): Promise<OutboundRecord> {
    return this.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO outbound_queue
           (workspace_id, channel, conversation_id, message_id, mailbox_id, to_value, subject, text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          input.workspaceId,
          input.channel,
          input.conversationId ?? null,
          input.messageId ?? null,
          input.mailboxId ?? null,
          input.toValue,
          input.subject ?? null,
          input.text ?? null,
        ],
      );
      return rowToOutbound(rows[0]);
    });
  }

  async listOutboundDue(
    workspaceId: string,
    nowIso: string,
    limit = 25,
  ): Promise<OutboundRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM outbound_queue
          WHERE workspace_id = $1 AND status = 'pendente' AND next_attempt_at <= $2
          ORDER BY next_attempt_at LIMIT $3`,
        [workspaceId, nowIso, limit],
      );
      return rows.map(rowToOutbound);
    });
  }

  async listOutbound(
    workspaceId: string,
    filter?: { status?: string },
  ): Promise<OutboundRecord[]> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = filter?.status
        ? await client.query(
            "SELECT * FROM outbound_queue WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100",
            [workspaceId, filter.status],
          )
        : await client.query(
            "SELECT * FROM outbound_queue WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100",
            [workspaceId],
          );
      return rows.map(rowToOutbound);
    });
  }

  async markOutboundSent(
    workspaceId: string,
    id: string,
    providerMessageId: string | null,
  ): Promise<OutboundRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE outbound_queue SET status = 'enviado', provider_message_id = $3,
           last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, providerMessageId],
      );
      return rows[0] ? rowToOutbound(rows[0]) : null;
    });
  }

  async markOutboundRetry(
    workspaceId: string,
    id: string,
    nextAttemptIso: string,
    error: string,
  ): Promise<OutboundRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE outbound_queue SET status = 'pendente', attempts = attempts + 1,
           next_attempt_at = $3, last_error = $4, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, nextAttemptIso, error.slice(0, 500)],
      );
      return rows[0] ? rowToOutbound(rows[0]) : null;
    });
  }

  async markOutboundFailed(
    workspaceId: string,
    id: string,
    error: string,
  ): Promise<OutboundRecord | null> {
    return this.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE outbound_queue SET status = 'falhou', attempts = attempts + 1,
           last_error = $3, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, error.slice(0, 500)],
      );
      return rows[0] ? rowToOutbound(rows[0]) : null;
    });
  }
}

function rowToWahaSession(row: Record<string, unknown>): WahaSessionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    engine: String(row.engine),
    status: String(row.status),
    phone: (row.phone as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function rowToMetaConnection(row: Record<string, unknown>): MetaConnectionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    pageId: String(row.page_id),
    pageName: (row.page_name as string) ?? null,
    igUserId: (row.ig_user_id as string) ?? null,
    accessTokenEnc: String(row.access_token_enc),
    tokenExpiresAt: row.token_expires_at
      ? new Date(row.token_expires_at as string).toISOString()
      : null,
    status: String(row.status),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function rowToMailbox(row: Record<string, unknown>): MailboxRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    fromEmail: String(row.from_email),
    fromName: (row.from_name as string) ?? null,
    smtpHost: String(row.smtp_host),
    smtpPort: Number(row.smtp_port),
    smtpUser: String(row.smtp_user),
    smtpPassEnc: String(row.smtp_pass_enc),
    imapHost: String(row.imap_host),
    imapPort: Number(row.imap_port),
    imapUser: String(row.imap_user),
    imapPassEnc: String(row.imap_pass_enc),
    lastUid: (row.last_uid as string) ?? null,
    status: String(row.status),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function rowToOutbound(row: Record<string, unknown>): OutboundRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channel: String(row.channel),
    conversationId: (row.conversation_id as string) ?? null,
    messageId: (row.message_id as string) ?? null,
    mailboxId: (row.mailbox_id as string) ?? null,
    toValue: String(row.to_value),
    subject: (row.subject as string) ?? null,
    text: (row.text as string) ?? null,
    status: String(row.status),
    attempts: Number(row.attempts),
    nextAttemptAt: new Date(row.next_attempt_at as string).toISOString(),
    lastError: (row.last_error as string) ?? null,
    providerMessageId: (row.provider_message_id as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function mailboxPatchParams(
  id: string,
  workspaceId: string,
  patch: {
    name?: string;
    fromName?: string | null;
    status?: string;
    lastUid?: string | null;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassEnc?: string;
    imapHost?: string;
    imapPort?: number;
    imapUser?: string;
    imapPassEnc?: string;
  },
): unknown[] {
  const n = <T>(v: T | undefined): T | null => (v ?? null);
  const fromNameSet = patch.fromName !== undefined;
  const lastUidSet = patch.lastUid !== undefined;
  return [
    id,
    workspaceId,
    n(patch.name),
    fromNameSet,
    fromNameSet ? patch.fromName : null,
    n(patch.status),
    lastUidSet,
    lastUidSet ? patch.lastUid : null,
    n(patch.smtpHost),
    n(patch.smtpPort),
    n(patch.smtpUser),
    n(patch.smtpPassEnc),
    n(patch.imapHost),
    n(patch.imapPort),
    n(patch.imapUser),
    n(patch.imapPassEnc),
  ];
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

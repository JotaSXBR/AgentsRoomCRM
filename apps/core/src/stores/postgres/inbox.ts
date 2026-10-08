import type {
  ConversationRecord,
  ConversationStatus,
  MessageRecord,
  NoteRecord,
  TagRecord,
  WorkspaceUpdates,
} from "../store.js";
import { rowToConversation, rowToMessage, rowToNote, rowToTag, type PostgresDeps } from "./rows.js";

export async function createTag(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    color?: string | null;
  }): Promise<TagRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tags (workspace_id, name, color) VALUES ($1, $2, $3) RETURNING *`,
        [input.workspaceId, input.name, input.color ?? null],
      );
      return rowToTag(rows[0]);
    });
  }

export async function listTags(deps: PostgresDeps, workspaceId: string): Promise<TagRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM tags WHERE workspace_id = $1 ORDER BY name",
        [workspaceId],
      );
      return rows.map(rowToTag);
    });
  }

export async function tagConversation(deps: PostgresDeps, 
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    await deps.withWorkspace(workspaceId, async (client) => {
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

export async function untagConversation(deps: PostgresDeps, 
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    await deps.withWorkspace(workspaceId, async (client) => {
      await client.query(
        "DELETE FROM conversation_tags WHERE workspace_id = $1 AND conversation_id = $2 AND tag_id = $3",
        [workspaceId, conversationId, tagId],
      );
    });
  }

export async function listConversationTags(deps: PostgresDeps, 
    workspaceId: string,
    conversationId: string,
  ): Promise<TagRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT t.* FROM tags t
           JOIN conversation_tags ct ON ct.tag_id = t.id
          WHERE ct.workspace_id = $1 AND ct.conversation_id = $2`,
        [workspaceId, conversationId],
      );
      return rows.map(rowToTag);
    });
  }

export async function createConversation(deps: PostgresDeps, input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    subject?: string | null;
  }): Promise<ConversationRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function findConversationById(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
  ): Promise<ConversationRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM conversations WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

export async function listConversations(deps: PostgresDeps, 
    workspaceId: string,
    filter?: {
      status?: ConversationStatus;
      assigneeId?: string;
      tagId?: string;
      q?: string;
    },
  ): Promise<ConversationRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function setConversationStatus(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "UPDATE conversations SET status = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING *",
        [id, workspaceId, status],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

export async function assignConversation(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    assigneeId: string | null,
  ): Promise<ConversationRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function addMessage(deps: PostgresDeps, input: {
    workspaceId: string;
    conversationId: string;
    direction: MessageRecord["direction"];
    authorId?: string | null;
    kind?: MessageRecord["kind"];
    text?: string | null;
    mediaUrl?: string | null;
  }): Promise<MessageRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listMessages(deps: PostgresDeps, 
    workspaceId: string,
    conversationId: string,
    options?: { since?: string },
  ): Promise<MessageRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function addNote(deps: PostgresDeps, input: {
    workspaceId: string;
    conversationId: string;
    authorId: string;
    content: string;
  }): Promise<NoteRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listNotes(deps: PostgresDeps, 
    workspaceId: string,
    conversationId: string,
  ): Promise<NoteRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM notes WHERE workspace_id = $1 AND conversation_id = $2 ORDER BY created_at",
        [workspaceId, conversationId],
      );
      return rows.map(rowToNote);
    });
  }

export async function listUpdates(deps: PostgresDeps, workspaceId: string, since: string): Promise<WorkspaceUpdates> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

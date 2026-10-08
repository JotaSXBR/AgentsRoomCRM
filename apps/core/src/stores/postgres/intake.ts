import type {
  ContactRecord,
  ConversationRecord,
} from "../store.js";
import { rowToContact, rowToConversation, type PostgresDeps } from "./rows.js";

export async function claimIntakeEvent(deps: PostgresDeps, input: {
    workspaceId: string;
    source: string;
    externalId: string;
  }): Promise<boolean> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rowCount } = await client.query(
        `INSERT INTO intake_events (workspace_id, source, external_id)
         VALUES ($1, $2, $3) ON CONFLICT (workspace_id, source, external_id) DO NOTHING`,
        [input.workspaceId, input.source, input.externalId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

export async function linkIntakeEvent(deps: PostgresDeps, input: {
    workspaceId: string;
    source: string;
    externalId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void> {
    await deps.withWorkspace(input.workspaceId, async (client) => {
      await client.query(
        `UPDATE intake_events SET conversation_id = $4, message_id = $5
          WHERE workspace_id = $1 AND source = $2 AND external_id = $3`,
        [input.workspaceId, input.source, input.externalId, input.conversationId, input.messageId],
      );
    });
  }

export async function findContactByChannel(deps: PostgresDeps, 
    workspaceId: string,
    channel: string,
    value: string,
  ): Promise<ContactRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function findContactByAnyChannelValue(deps: PostgresDeps, 
    workspaceId: string,
    value: string,
  ): Promise<ContactRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function findActiveConversation(deps: PostgresDeps, 
    workspaceId: string,
    contactId: string,
    channel: string,
  ): Promise<ConversationRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM conversations
          WHERE workspace_id = $1 AND contact_id = $2 AND channel = $3 AND status <> 'resolvido'
          ORDER BY updated_at DESC LIMIT 1`,
        [workspaceId, contactId, channel],
      );
      return rows[0] ? rowToConversation(rows[0]) : null;
    });
  }

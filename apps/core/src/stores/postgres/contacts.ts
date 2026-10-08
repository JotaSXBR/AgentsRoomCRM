import type {
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
} from "../store.js";
import { rowToContact, type PostgresDeps } from "./rows.js";

export async function createContact(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  }): Promise<ContactRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listContacts(deps: PostgresDeps, 
    workspaceId: string,
    query?: { q?: string },
  ): Promise<ContactRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function findContactById(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
  ): Promise<ContactRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToContact(rows[0]) : null;
    });
  }

export async function addContactChannel(deps: PostgresDeps, input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    value: string;
  }): Promise<ContactChannelRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listContactChannels(deps: PostgresDeps, 
    workspaceId: string,
    contactId: string,
  ): Promise<ContactChannelRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function mergeContacts(deps: PostgresDeps, 
    workspaceId: string,
    sourceId: string,
    targetId: string,
  ): Promise<ContactRecord> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function contactTimeline(deps: PostgresDeps, 
    workspaceId: string,
    contactId: string,
  ): Promise<ContactEventRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function addContactEvent(deps: PostgresDeps, input: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    kind: string;
    actorId?: string | null;
    description: string;
  }): Promise<ContactEventRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

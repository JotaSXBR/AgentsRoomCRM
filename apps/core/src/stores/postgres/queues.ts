import type {
  QueueRecord,
  QueueTicketRecord,
  TicketStatus,
} from "../store.js";
import { rowToQueue, rowToTicket, type PostgresDeps } from "./rows.js";

export async function createQueue(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    channel?: string | null;
    isDefault?: boolean;
  }): Promise<QueueRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      if (input.isDefault) {
        await client.query("UPDATE queues SET is_default = FALSE WHERE workspace_id = $1", [input.workspaceId]);
      }
      try {
        const { rows } = await client.query(
          `INSERT INTO queues (workspace_id, name, channel, is_default)
           VALUES ($1, $2, $3, COALESCE($4, FALSE)) RETURNING *`,
          [input.workspaceId, input.name, input.channel ?? null, input.isDefault ?? false],
        );
        return rowToQueue(rows[0]);
      } catch (error) {
        if (String((error as Error).message).includes("queues_workspace_name_key")) {
          throw new Error("fila_nome_em_uso");
        }
        throw error;
      }
    });
  }

export async function listQueues(deps: PostgresDeps, workspaceId: string): Promise<QueueRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM queues WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map(rowToQueue);
    });
  }

export async function findQueueById(deps: PostgresDeps, workspaceId: string, id: string): Promise<QueueRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM queues WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToQueue(rows[0]) : null;
    });
  }

export async function deleteQueue(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "DELETE FROM queues WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

export async function addQueueMember(deps: PostgresDeps, input: { workspaceId: string; queueId: string; userId: string }): Promise<void> {
    await deps.withWorkspace(input.workspaceId, async (client) => {
      await client.query(
        `INSERT INTO queue_members (workspace_id, queue_id, user_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [input.workspaceId, input.queueId, input.userId],
      );
    });
  }

export async function removeQueueMember(deps: PostgresDeps, workspaceId: string, queueId: string, userId: string): Promise<boolean> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "DELETE FROM queue_members WHERE workspace_id = $1 AND queue_id = $2 AND user_id = $3",
        [workspaceId, queueId, userId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

export async function listQueueMembers(deps: PostgresDeps, workspaceId: string, queueId: string): Promise<string[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT user_id FROM queue_members
         WHERE workspace_id = $1 AND queue_id = $2 ORDER BY created_at`,
        [workspaceId, queueId],
      );
      return rows.map((r) => String(r.user_id));
    });
  }

export async function enqueueTicket(deps: PostgresDeps, input: {
    workspaceId: string;
    queueId: string;
    conversationId: string;
    channel: string;
  }): Promise<QueueTicketRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO queue_tickets (workspace_id, queue_id, conversation_id, channel)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.workspaceId, input.queueId, input.conversationId, input.channel],
      );
      return rowToTicket(rows[0]);
    });
  }

export async function listTickets(deps: PostgresDeps, 
    workspaceId: string,
    filter?: { queueId?: string; status?: string; assignedUserId?: string },
  ): Promise<QueueTicketRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const clauses = ["workspace_id = $1"];
      const params: unknown[] = [workspaceId];
      if (filter?.queueId) { params.push(filter.queueId); clauses.push(`queue_id = $${params.length}`); }
      if (filter?.status) { params.push(filter.status); clauses.push(`status = $${params.length}`); }
      if (filter?.assignedUserId) { params.push(filter.assignedUserId); clauses.push(`assigned_user_id = $${params.length}`); }
      const { rows } = await client.query(
        `SELECT * FROM queue_tickets WHERE ${clauses.join(" AND ")} ORDER BY enqueued_at DESC LIMIT 500`,
        params,
      );
      return rows.map(rowToTicket);
    });
  }

export async function findTicketById(deps: PostgresDeps, workspaceId: string, id: string): Promise<QueueTicketRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM queue_tickets WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToTicket(rows[0]) : null;
    });
  }

export async function findOpenTicketByConversation(deps: PostgresDeps, workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM queue_tickets
         WHERE workspace_id = $1 AND conversation_id = $2 AND status NOT IN ('resolvido', 'cancelado')
         ORDER BY enqueued_at LIMIT 1`,
        [workspaceId, conversationId],
      );
      return rows[0] ? rowToTicket(rows[0]) : null;
    });
  }

export async function updateTicket(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    patch: {
      status?: TicketStatus;
      assignedUserId?: string | null;
      firstResponseAt?: string | null;
      resolvedAt?: string | null;
    },
  ): Promise<QueueTicketRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE queue_tickets SET
           status = COALESCE($3, status),
           assigned_user_id = CASE WHEN $4::boolean THEN $5 ELSE assigned_user_id END,
           first_response_at = CASE WHEN $6::boolean THEN $7 ELSE first_response_at END,
           resolved_at = CASE WHEN $8::boolean THEN $9 ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [
          id,
          workspaceId,
          patch.status ?? null,
          patch.assignedUserId !== undefined,
          patch.assignedUserId ?? null,
          patch.firstResponseAt !== undefined,
          patch.firstResponseAt ?? null,
          patch.resolvedAt !== undefined,
          patch.resolvedAt ?? null,
        ],
      );
      return rows[0] ? rowToTicket(rows[0]) : null;
    });
  }

export async function markTicketFirstResponse(deps: PostgresDeps, workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE queue_tickets SET
           first_response_at = COALESCE(first_response_at, NOW()),
           status = CASE WHEN status = 'aguardando' AND first_response_at IS NULL THEN 'em_atendimento' ELSE status END,
           updated_at = NOW()
         WHERE workspace_id = $1 AND conversation_id = $2 AND status NOT IN ('resolvido', 'cancelado')
         RETURNING *`,
        [workspaceId, conversationId],
      );
      return rows[0] ? rowToTicket(rows[0]) : null;
    });
  }

export async function resolveOpenTicketForConversation(deps: PostgresDeps, workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE queue_tickets SET status = 'resolvido', resolved_at = NOW(), updated_at = NOW()
         WHERE workspace_id = $1 AND conversation_id = $2 AND status NOT IN ('resolvido', 'cancelado')
         RETURNING *`,
        [workspaceId, conversationId],
      );
      return rows[0] ? rowToTicket(rows[0]) : null;
    });
  }

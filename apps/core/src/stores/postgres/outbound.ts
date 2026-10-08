import type {
  OutboundRecord,
} from "../store.js";
import { rowToOutbound, type PostgresDeps } from "./rows.js";

export async function enqueueOutbound(deps: PostgresDeps, input: {
    workspaceId: string;
    channel: string;
    conversationId?: string | null;
    messageId?: string | null;
    mailboxId?: string | null;
    toValue: string;
    subject?: string | null;
    text?: string | null;
  }): Promise<OutboundRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listOutboundDue(deps: PostgresDeps, 
    workspaceId: string,
    nowIso: string,
    limit = 25,
  ): Promise<OutboundRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM outbound_queue
          WHERE workspace_id = $1 AND status = 'pendente' AND next_attempt_at <= $2
          ORDER BY next_attempt_at LIMIT $3`,
        [workspaceId, nowIso, limit],
      );
      return rows.map(rowToOutbound);
    });
  }

export async function listOutbound(deps: PostgresDeps, 
    workspaceId: string,
    filter?: { status?: string },
  ): Promise<OutboundRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function markOutboundSent(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    providerMessageId: string | null,
  ): Promise<OutboundRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE outbound_queue SET status = 'enviado', provider_message_id = $3,
           last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, providerMessageId],
      );
      return rows[0] ? rowToOutbound(rows[0]) : null;
    });
  }

export async function markOutboundRetry(deps: PostgresDeps, input: { workspaceId: string; id: string; nextAttemptIso: string; error: string }): Promise<OutboundRecord | null> {
    const { workspaceId, id, nextAttemptIso, error } = input;
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE outbound_queue SET status = 'pendente', attempts = attempts + 1,
           next_attempt_at = $3, last_error = $4, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, nextAttemptIso, error.slice(0, 500)],
      );
      return rows[0] ? rowToOutbound(rows[0]) : null;
    });
  }

export async function markOutboundFailed(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    error: string,
  ): Promise<OutboundRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE outbound_queue SET status = 'falhou', attempts = attempts + 1,
           last_error = $3, updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [id, workspaceId, error.slice(0, 500)],
      );
      return rows[0] ? rowToOutbound(rows[0]) : null;
    });
  }

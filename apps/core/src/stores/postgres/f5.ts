import type {
  ApiKeyRecord,
  ApiKeyScope,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookEndpointRecord,
} from "../store.js";
import type { PostgresDeps } from "./rows.js";
import {
  rowToApiKey,
  rowToWebhookDelivery,
  rowToWebhookEndpoint,
} from "./rowsF5.js";

// --------------------------------------------------------- API keys ---

export async function createApiKey(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    prefix: string;
    keyHash: string;
    scopes?: ApiKeyScope[];
    createdBy?: string | null;
  }): Promise<ApiKeyRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO api_keys (workspace_id, name, prefix, key_hash, scopes, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [input.workspaceId, input.name, input.prefix, input.keyHash,
        JSON.stringify(input.scopes ?? ["mcp"]), input.createdBy ?? null],
    );
    return rowToApiKey(rows[0]);
  });
}

export async function listApiKeys(deps: PostgresDeps, workspaceId: string): Promise<ApiKeyRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC",
      [workspaceId],
    );
    return rows.map(rowToApiKey);
  });
}

/** Busca global (sem contexto RLS): o hash da chave é o próprio isolating token. */
export async function findApiKeyByHash(deps: PostgresDeps, keyHash: string): Promise<ApiKeyRecord | null> {
  const { rows } = await deps.pool.query("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash]);
  return rows[0] ? rowToApiKey(rows[0]) : null;
}

export async function touchApiKey(deps: PostgresDeps, workspaceId: string, id: string): Promise<ApiKeyRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING *",
      [id, workspaceId],
    );
    return rows[0] ? rowToApiKey(rows[0]) : null;
  });
}

export async function revokeApiKey(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rowCount } = await client.query(
      "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL",
      [id, workspaceId],
    );
    return (rowCount ?? 0) > 0;
  });
}

// -------------------------------------------------------- webhooks ---

export async function createWebhookEndpoint(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    url: string;
    secret: string;
    events?: string[];
  }): Promise<WebhookEndpointRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO webhook_endpoints (workspace_id, name, url, secret, events)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [input.workspaceId, input.name, input.url, input.secret,
        JSON.stringify(input.events ?? ["*"])],
    );
    return rowToWebhookEndpoint(rows[0]);
  });
}

export async function listWebhookEndpoints(deps: PostgresDeps, workspaceId: string): Promise<WebhookEndpointRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY created_at",
      [workspaceId],
    );
    return rows.map(rowToWebhookEndpoint);
  });
}

export async function findWebhookEndpoint(deps: PostgresDeps, workspaceId: string, id: string): Promise<WebhookEndpointRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2",
      [id, workspaceId],
    );
    return rows[0] ? rowToWebhookEndpoint(rows[0]) : null;
  });
}

export async function deleteWebhookEndpoint(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2",
      [id, workspaceId],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function enqueueWebhookDelivery(deps: PostgresDeps, input: {
    workspaceId: string;
    endpointId: string;
    event: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: string;
  }): Promise<WebhookDeliveryRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO webhook_deliveries (workspace_id, endpoint_id, event, payload, next_attempt_at)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, NOW())) RETURNING *`,
      [input.workspaceId, input.endpointId, input.event, JSON.stringify(input.payload),
        input.nextAttemptAt ?? null],
    );
    return rowToWebhookDelivery(rows[0]);
  });
}

export async function listWebhookDeliveries(deps: PostgresDeps, workspaceId: string,
    filter?: { endpointId?: string; status?: WebhookDeliveryStatus },
  ): Promise<WebhookDeliveryRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const clauses = ["workspace_id = $1"];
    const params: unknown[] = [workspaceId];
    if (filter?.endpointId) { params.push(filter.endpointId); clauses.push(`endpoint_id = $${params.length}`); }
    if (filter?.status) { params.push(filter.status); clauses.push(`status = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT * FROM webhook_deliveries WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    return rows.map(rowToWebhookDelivery);
  });
}

export async function markWebhookDelivery(deps: PostgresDeps, workspaceId: string, id: string, patch: {
    status?: WebhookDeliveryStatus;
    attempts?: number;
    nextAttemptAt?: string;
    responseCode?: number | null;
    lastError?: string | null;
  }): Promise<WebhookDeliveryRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      `UPDATE webhook_deliveries SET
         status = COALESCE($3, status),
         attempts = COALESCE($4, attempts),
         next_attempt_at = COALESCE($5::timestamptz, next_attempt_at),
         response_code = CASE WHEN $6::boolean THEN $7 ELSE response_code END,
         last_error = CASE WHEN $8::boolean THEN $9 ELSE last_error END,
         updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 RETURNING *`,
      [id, workspaceId, patch.status ?? null, patch.attempts ?? null,
        patch.nextAttemptAt ?? null, patch.responseCode !== undefined,
        patch.responseCode ?? null, patch.lastError !== undefined, patch.lastError ?? null],
    );
    return rows[0] ? rowToWebhookDelivery(rows[0]) : null;
  });
}
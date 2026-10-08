import type {
  WidgetTokenRecord,
} from "../store.js";
import type { PostgresDeps } from "./rows.js";

export async function createWidgetToken(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    tokenHash: string;
  }): Promise<WidgetTokenRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listWidgetTokens(deps: PostgresDeps, workspaceId: string): Promise<WidgetTokenRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

export async function findWidgetTokenByHash(deps: PostgresDeps, tokenHash: string): Promise<WidgetTokenRecord | null> {
    const { rows } = await deps.pool.query(
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

export async function revokeWidgetToken(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE widget_tokens SET revoked_at = NOW() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL",
        [id, workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

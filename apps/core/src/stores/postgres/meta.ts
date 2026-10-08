import type {
  MetaConnectionRecord,
} from "../store.js";
import { rowToMetaConnection, type PostgresDeps } from "./rows.js";

export async function saveMetaConnection(deps: PostgresDeps, input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  }): Promise<MetaConnectionRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function getMetaConnection(deps: PostgresDeps, workspaceId: string): Promise<MetaConnectionRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM meta_connections WHERE workspace_id = $1",
        [workspaceId],
      );
      return rows[0] ? rowToMetaConnection(rows[0]) : null;
    });
  }

export async function deleteMetaConnection(deps: PostgresDeps, workspaceId: string): Promise<boolean> {
    return deps.withWorkspace(workspaceId, async (client) => {
      await client.query("DELETE FROM meta_page_index WHERE workspace_id = $1", [workspaceId]);
      const { rowCount } = await client.query(
        "DELETE FROM meta_connections WHERE workspace_id = $1",
        [workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

export async function findWorkspaceIdByMetaPage(deps: PostgresDeps, pageId: string): Promise<string | null> {
    const { rows } = await deps.pool.query(
      "SELECT workspace_id FROM meta_page_index WHERE page_id = $1",
      [pageId],
    );
    return rows[0] ? String(rows[0].workspace_id) : null;
  }

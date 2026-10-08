import type {
  WahaSessionRecord,
} from "../store.js";
import { rowToWahaSession, type PostgresDeps } from "./rows.js";

export async function createWahaSession(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    engine?: string;
  }): Promise<WahaSessionRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
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

export async function listWahaSessions(deps: PostgresDeps, workspaceId: string): Promise<WahaSessionRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM waha_sessions WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map(rowToWahaSession);
    });
  }

export async function findWahaSessionById(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
  ): Promise<WahaSessionRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM waha_sessions WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToWahaSession(rows[0]) : null;
    });
  }

export async function findWahaSessionByName(deps: PostgresDeps, name: string): Promise<WahaSessionRecord | null> {
    const { rows } = await deps.pool.query(
      "SELECT * FROM waha_sessions WHERE name = $1",
      [name],
    );
    return rows[0] ? rowToWahaSession(rows[0]) : null;
  }

export async function updateWahaSession(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    patch: { status?: string; phone?: string | null },
  ): Promise<WahaSessionRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
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

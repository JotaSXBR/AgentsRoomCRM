import type {
  FlowAction,
  FlowRecord,
  FlowStepRecord,
  WorkspaceModuleRecord,
} from "../store.js";
import type { PostgresDeps } from "./rows.js";
import { rowToFlow, rowToFlowStep, rowToWorkspaceModule } from "./rowsF5.js";

async function stepsOf(
  deps: PostgresDeps,
  workspaceId: string,
  flowId: string,
): Promise<FlowStepRecord[]> {
  const { rows } = await deps.withWorkspace(workspaceId, async (client) =>
    client.query(
      "SELECT * FROM flow_steps WHERE workspace_id = $1 AND flow_id = $2 ORDER BY position",
      [workspaceId, flowId],
    ),
  );
  return rows.map(rowToFlowStep);
}

export async function createFlow(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    terms?: string[];
    active?: boolean;
    steps: Array<{ action: FlowAction; payload: Record<string, unknown> }>;
  }): Promise<FlowRecord> {
  const flow = await deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO flows (workspace_id, name, terms, active)
       VALUES ($1, $2, $3::jsonb, COALESCE($4, TRUE)) RETURNING *`,
      [input.workspaceId, input.name, JSON.stringify(input.terms ?? []), input.active ?? null],
    );
    return rowToFlow(rows[0], []);
  });
  for (const [index, step] of input.steps.entries()) {
    await deps.withWorkspace(input.workspaceId, async (client) => {
      await client.query(
        `INSERT INTO flow_steps (workspace_id, flow_id, position, action, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [input.workspaceId, flow.id, index, step.action, JSON.stringify(step.payload)],
      );
    });
  }
  return { ...flow, steps: await stepsOf(deps, input.workspaceId, flow.id) };
}

export async function listFlows(deps: PostgresDeps, workspaceId: string): Promise<FlowRecord[]> {
  const { rows } = await deps.withWorkspace(workspaceId, async (client) =>
    client.query("SELECT * FROM flows WHERE workspace_id = $1 ORDER BY created_at", [workspaceId]),
  );
  const flows: FlowRecord[] = [];
  for (const row of rows) {
    flows.push(rowToFlow(row, await stepsOf(deps, workspaceId, String(row.id))));
  }
  return flows;
}

export async function findFlowById(
  deps: PostgresDeps,
  workspaceId: string,
  id: string,
): Promise<FlowRecord | null> {
  const { rows } = await deps.withWorkspace(workspaceId, async (client) =>
    client.query("SELECT * FROM flows WHERE id = $1 AND workspace_id = $2", [id, workspaceId]),
  );
  return rows[0] ? rowToFlow(rows[0], await stepsOf(deps, workspaceId, id)) : null;
}

export async function setFlowActive(
  deps: PostgresDeps,
  workspaceId: string,
  id: string,
  active: boolean,
): Promise<FlowRecord | null> {
  const { rows } = await deps.withWorkspace(workspaceId, async (client) =>
    client.query(
      "UPDATE flows SET active = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING *",
      [id, workspaceId, active],
    ),
  );
  return rows[0] ? rowToFlow(rows[0], await stepsOf(deps, workspaceId, id)) : null;
}

export async function deleteFlow(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM flows WHERE id = $1 AND workspace_id = $2",
      [id, workspaceId],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function listWorkspaceModules(
  deps: PostgresDeps,
  workspaceId: string,
): Promise<WorkspaceModuleRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) =>
    client.query(
      "SELECT * FROM workspace_modules WHERE workspace_id = $1 ORDER BY module_key",
      [workspaceId],
    ),
  ).then((r) => r.rows.map(rowToWorkspaceModule));
}

export async function setWorkspaceModule(deps: PostgresDeps, input: {
    workspaceId: string;
    moduleKey: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }): Promise<WorkspaceModuleRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) =>
    client.query(
      `INSERT INTO workspace_modules (workspace_id, module_key, enabled, config)
       VALUES ($1, $2, COALESCE($3, TRUE), COALESCE($4::jsonb, '{}'::jsonb))
       ON CONFLICT (workspace_id, module_key) DO UPDATE SET
         enabled = COALESCE($3, workspace_modules.enabled),
         config = COALESCE($4::jsonb, workspace_modules.config),
         updated_at = NOW()
       RETURNING *`,
      [input.workspaceId, input.moduleKey, input.enabled ?? null,
        input.config ? JSON.stringify(input.config) : null],
    ),
  ).then((r) => rowToWorkspaceModule(r.rows[0]));
}
import { randomUUID } from "node:crypto";
import type {
  FlowRecord,
  FlowStepRecord,
  WorkspaceModuleRecord,
} from "../types/f5.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

/** Estado de fluxos e módulos por workspace (F5). */
export type F5FlowsState = Pick<MemoryState, "flows" | "flowSteps" | "workspaceModules">;

export function createF5FlowsMaps(): F5FlowsState {
  return { flows: new Map(), flowSteps: new Map(), workspaceModules: new Map() };
}

/** Grava os passos na posição de cada um e devolve-os na ordem. */
function buildFlowSteps(
  state: F5FlowsState,
  workspaceId: string,
  flowId: string,
  steps: Array<{ action: FlowStepRecord["action"]; payload: Record<string, unknown> }>,
): FlowStepRecord[] {
  return steps.map((step, index) => {
    const record: FlowStepRecord = {
      id: randomUUID(),
      workspaceId,
      flowId,
      position: index,
      action: step.action,
      payload: step.payload,
      createdAt: now(),
    };
    state.flowSteps.set(record.id, record);
    return record;
  });
}

export async function createFlow(
  state: F5FlowsState,
  input: {
    workspaceId: string;
    name: string;
    terms?: string[];
    active?: boolean;
    steps: Array<{ action: FlowStepRecord["action"]; payload: Record<string, unknown> }>;
  },
): Promise<FlowRecord> {
  const record: FlowRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    terms: input.terms ?? [],
    active: input.active ?? true,
    steps: [],
    createdAt: now(),
    updatedAt: now(),
  };
  record.steps = buildFlowSteps(state, input.workspaceId, record.id, input.steps);
  state.flows.set(record.id, record);
  return record;
}

/** Fluxos do workspace, com passos em ordem de execução. */
export async function listFlows(state: F5FlowsState, workspaceId: string): Promise<FlowRecord[]> {
  const flows = [...state.flows.values()]
    .filter((f) => f.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const flow of flows) {
    flow.steps = [...state.flowSteps.values()]
      .filter((s) => s.flowId === flow.id)
      .sort((a, b) => a.position - b.position);
  }
  return flows;
}

export async function findFlowById(
  state: F5FlowsState,
  workspaceId: string,
  id: string,
): Promise<FlowRecord | null> {
  const flow = state.flows.get(id);
  if (!flow || flow.workspaceId !== workspaceId) return null;
  return { ...flow, steps: listStepsOf(state, id) };
}

function listStepsOf(state: F5FlowsState, flowId: string): FlowStepRecord[] {
  return [...state.flowSteps.values()]
    .filter((s) => s.flowId === flowId)
    .sort((a, b) => a.position - b.position);
}

export async function setFlowActive(
  state: F5FlowsState,
  workspaceId: string,
  id: string,
  active: boolean,
): Promise<FlowRecord | null> {
  const flow = await findFlowById(state, workspaceId, id);
  if (!flow) return null;
  const updated = { ...flow, active, updatedAt: now() };
  state.flows.set(id, updated);
  return updated;
}

export async function deleteFlow(
  state: F5FlowsState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const flow = state.flows.get(id);
  if (!flow || flow.workspaceId !== workspaceId) return false;
  state.flows.delete(id);
  for (const [key, step] of state.flowSteps) {
    if (step.flowId === id) state.flowSteps.delete(key);
  }
  return true;
}

// ------------------------------------------------------------- módulos ---

export async function listWorkspaceModules(
  state: F5FlowsState,
  workspaceId: string,
): Promise<WorkspaceModuleRecord[]> {
  return [...state.workspaceModules.values()].filter((m) => m.workspaceId === workspaceId);
}

export async function setWorkspaceModule(
  state: F5FlowsState,
  input: {
    workspaceId: string;
    moduleKey: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  },
): Promise<WorkspaceModuleRecord> {
  const key = `${input.workspaceId}:${input.moduleKey}`;
  const current = state.workspaceModules.get(key);
  const record: WorkspaceModuleRecord = {
    workspaceId: input.workspaceId,
    moduleKey: input.moduleKey,
    enabled: input.enabled ?? current?.enabled ?? true,
    config: input.config ?? current?.config ?? {},
    updatedAt: now(),
  };
  state.workspaceModules.set(key, record);
  return record;
}
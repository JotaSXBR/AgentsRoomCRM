import { randomUUID } from "node:crypto";
import type { WidgetTokenRecord } from "../types/widget.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type WidgetState = Pick<MemoryState, "widgetTokens">;

export async function createWidgetToken(
  state: WidgetState,
  input: {
    workspaceId: string;
    name: string;
    tokenHash: string;
  },
): Promise<WidgetTokenRecord> {
  const record: WidgetTokenRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    tokenHash: input.tokenHash,
    revokedAt: null,
    createdAt: now(),
  };
  state.widgetTokens.set(record.id, record);
  return record;
}

export async function listWidgetTokens(
  state: WidgetState,
  workspaceId: string,
): Promise<WidgetTokenRecord[]> {
  return [...state.widgetTokens.values()].filter(
    (t) => t.workspaceId === workspaceId,
  );
}

export async function findWidgetTokenByHash(
  state: WidgetState,
  tokenHash: string,
): Promise<WidgetTokenRecord | null> {
  for (const t of state.widgetTokens.values()) {
    if (t.tokenHash === tokenHash) return t;
  }
  return null;
}

export async function revokeWidgetToken(
  state: WidgetState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const t = state.widgetTokens.get(id);
  if (!t || t.workspaceId !== workspaceId || t.revokedAt) return false;
  state.widgetTokens.set(id, { ...t, revokedAt: now() });
  return true;
}

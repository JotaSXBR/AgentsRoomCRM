import { randomUUID } from "node:crypto";
import type { WahaSessionRecord } from "../types/waha.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type WahaState = Pick<MemoryState, "wahaSessions">;

export async function createWahaSession(
  state: WahaState,
  input: {
    workspaceId: string;
    name: string;
    engine?: string;
  },
): Promise<WahaSessionRecord> {
  for (const s of state.wahaSessions.values()) {
    if (s.name === input.name) throw new Error("session_nome_em_uso");
  }
  const record: WahaSessionRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    engine: input.engine ?? "GOWS",
    status: "criada",
    phone: null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.wahaSessions.set(record.id, record);
  return record;
}

export async function listWahaSessions(
  state: WahaState,
  workspaceId: string,
): Promise<WahaSessionRecord[]> {
  return [...state.wahaSessions.values()].filter(
    (s) => s.workspaceId === workspaceId,
  );
}

export async function findWahaSessionById(
  state: WahaState,
  workspaceId: string,
  id: string,
): Promise<WahaSessionRecord | null> {
  const s = state.wahaSessions.get(id);
  return s && s.workspaceId === workspaceId ? s : null;
}

export async function findWahaSessionByName(
  state: WahaState,
  name: string,
): Promise<WahaSessionRecord | null> {
  for (const s of state.wahaSessions.values()) {
    if (s.name === name) return s;
  }
  return null;
}

export async function updateWahaSession(
  state: WahaState,
  workspaceId: string,
  id: string,
  patch: { status?: string; phone?: string | null },
): Promise<WahaSessionRecord | null> {
  const s = state.wahaSessions.get(id);
  if (!s || s.workspaceId !== workspaceId) return null;
  const updated = {
    ...s,
    status: patch.status ?? s.status,
    phone: patch.phone !== undefined ? patch.phone : s.phone,
    updatedAt: now(),
  };
  state.wahaSessions.set(id, updated);
  return updated;
}

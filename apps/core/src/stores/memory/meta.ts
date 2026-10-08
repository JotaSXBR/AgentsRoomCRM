import { randomUUID } from "node:crypto";
import type { MetaConnectionRecord } from "../types/meta.js";
import type { MemoryState } from "./shared.js";
import { now, pick } from "./shared.js";

export type MetaState = Pick<MemoryState, "metaConnections" | "metaPageIndex">;

function assertPageFree(state: MetaState, pageId: string, workspaceId: string): void {
  const owner = state.metaPageIndex.get(pageId);
  if (owner && owner !== workspaceId) {
    throw new Error("pagina_em_uso");
  }
}

function releaseOldPages(state: MetaState, workspaceId: string, pageId: string): void {
  // Página trocada? Remove o mapeamento antigo do workspace.
  for (const [oldPageId, wsId] of state.metaPageIndex) {
    if (wsId === workspaceId && oldPageId !== pageId) {
      state.metaPageIndex.delete(oldPageId);
    }
  }
}

function buildMetaRecord(
  existing: MetaConnectionRecord | undefined,
  input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  },
): MetaConnectionRecord {
  return {
    id: existing?.id ?? randomUUID(),
    workspaceId: input.workspaceId,
    pageId: input.pageId,
    pageName: pick(input.pageName, existing?.pageName, null),
    igUserId: pick(input.igUserId, existing?.igUserId, null),
    accessTokenEnc: input.accessTokenEnc,
    tokenExpiresAt: pick(input.tokenExpiresAt, existing?.tokenExpiresAt, null),
    status: pick(input.status, existing?.status, "conectada"),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
}

export async function saveMetaConnection(
  state: MetaState,
  input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  },
): Promise<MetaConnectionRecord> {
  assertPageFree(state, input.pageId, input.workspaceId);
  releaseOldPages(state, input.workspaceId, input.pageId);
  state.metaPageIndex.set(input.pageId, input.workspaceId);
  const record = buildMetaRecord(state.metaConnections.get(input.workspaceId), input);
  state.metaConnections.set(input.workspaceId, record);
  return record;
}

export async function getMetaConnection(
  state: MetaState,
  workspaceId: string,
): Promise<MetaConnectionRecord | null> {
  return state.metaConnections.get(workspaceId) ?? null;
}

export async function deleteMetaConnection(
  state: MetaState,
  workspaceId: string,
): Promise<boolean> {
  const existing = state.metaConnections.get(workspaceId);
  if (!existing) return false;
  state.metaConnections.delete(workspaceId);
  for (const [pageId, wsId] of state.metaPageIndex) {
    if (wsId === workspaceId) state.metaPageIndex.delete(pageId);
  }
  return true;
}

export async function findWorkspaceIdByMetaPage(
  state: MetaState,
  pageId: string,
): Promise<string | null> {
  return state.metaPageIndex.get(pageId) ?? null;
}

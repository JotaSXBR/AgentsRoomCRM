import { randomUUID } from "node:crypto";
import type { ApiKeyRecord, WebhookDeliveryRecord, WebhookEndpointRecord } from "../types/f5.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

/** Estado usado pelas operações de chave de API e webhook (F5). */
export type F5KeysState = Pick<
  MemoryState,
  "apiKeys" | "webhookEndpoints" | "webhookDeliveries"
>;

export function createF5KeysMaps(): F5KeysState {
  return {
    apiKeys: new Map(),
    webhookEndpoints: new Map(),
    webhookDeliveries: new Map(),
  };
}

// ------------------------------------------------------------- API keys ---

export async function createApiKey(
  state: F5KeysState,
  input: {
    workspaceId: string;
    name: string;
    prefix: string;
    keyHash: string;
    scopes?: ApiKeyRecord["scopes"];
    createdBy?: string | null;
  },
): Promise<ApiKeyRecord> {
  const record: ApiKeyRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    prefix: input.prefix,
    keyHash: input.keyHash,
    scopes: input.scopes ?? ["mcp"],
    createdBy: input.createdBy ?? null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now(),
  };
  state.apiKeys.set(record.id, record);
  return record;
}

export async function listApiKeys(state: F5KeysState, workspaceId: string): Promise<ApiKeyRecord[]> {
  return [...state.apiKeys.values()]
    .filter((k) => k.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findApiKeyByHash(
  state: F5KeysState,
  keyHash: string,
): Promise<ApiKeyRecord | null> {
  for (const key of state.apiKeys.values()) {
    if (key.keyHash === keyHash) return key;
  }
  return null;
}

export async function touchApiKey(
  state: F5KeysState,
  workspaceId: string,
  id: string,
): Promise<ApiKeyRecord | null> {
  const key = state.apiKeys.get(id);
  if (!key || key.workspaceId !== workspaceId) return null;
  const updated = { ...key, lastUsedAt: now() };
  state.apiKeys.set(id, updated);
  return updated;
}

export async function revokeApiKey(
  state: F5KeysState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const key = state.apiKeys.get(id);
  if (!key || key.workspaceId !== workspaceId || key.revokedAt) return false;
  state.apiKeys.set(id, { ...key, revokedAt: now() });
  return true;
}

// ------------------------------------------------------------ webhooks ---

export async function createWebhookEndpoint(
  state: F5KeysState,
  input: {
    workspaceId: string;
    name: string;
    url: string;
    secret: string;
    events?: string[];
  },
): Promise<WebhookEndpointRecord> {
  const record: WebhookEndpointRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    url: input.url,
    secret: input.secret,
    events: input.events ?? ["*"],
    active: true,
    createdAt: now(),
    updatedAt: now(),
  };
  state.webhookEndpoints.set(record.id, record);
  return record;
}

export async function listWebhookEndpoints(
  state: F5KeysState,
  workspaceId: string,
): Promise<WebhookEndpointRecord[]> {
  return [...state.webhookEndpoints.values()]
    .filter((e) => e.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findWebhookEndpoint(
  state: F5KeysState,
  workspaceId: string,
  id: string,
): Promise<WebhookEndpointRecord | null> {
  const endpoint = state.webhookEndpoints.get(id);
  return endpoint && endpoint.workspaceId === workspaceId ? endpoint : null;
}

/** Apagar o endpoint leva junto as entregas dele (FK `ON DELETE CASCADE`). */
export async function deleteWebhookEndpoint(
  state: F5KeysState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const endpoint = state.webhookEndpoints.get(id);
  if (!endpoint || endpoint.workspaceId !== workspaceId) return false;
  state.webhookEndpoints.delete(id);
  for (const [key, delivery] of state.webhookDeliveries) {
    if (delivery.endpointId === id) state.webhookDeliveries.delete(key);
  }
  return true;
}

export async function enqueueWebhookDelivery(
  state: F5KeysState,
  input: {
    workspaceId: string;
    endpointId: string;
    event: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: string;
  },
): Promise<WebhookDeliveryRecord> {
  const record: WebhookDeliveryRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    endpointId: input.endpointId,
    event: input.event,
    payload: input.payload,
    status: "pendente",
    attempts: 0,
    nextAttemptAt: input.nextAttemptAt ?? now(),
    responseCode: null,
    lastError: null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.webhookDeliveries.set(record.id, record);
  return record;
}

export async function listWebhookDeliveries(
  state: F5KeysState,
  workspaceId: string,
  filter?: { endpointId?: string; status?: WebhookDeliveryRecord["status"] },
): Promise<WebhookDeliveryRecord[]> {
  return [...state.webhookDeliveries.values()]
    .filter(
      (d) =>
        d.workspaceId === workspaceId &&
        (!filter?.endpointId || d.endpointId === filter.endpointId) &&
        (!filter?.status || d.status === filter.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Patch parcial da entrega; campos ausentes mantêm o valor atual. */
export async function markWebhookDelivery(
  state: F5KeysState,
  workspaceId: string,
  id: string,
  patch: {
    status?: WebhookDeliveryRecord["status"];
    attempts?: number;
    nextAttemptAt?: string;
    responseCode?: number | null;
    lastError?: string | null;
  },
): Promise<WebhookDeliveryRecord | null> {
  const current = state.webhookDeliveries.get(id);
  if (!current || current.workspaceId !== workspaceId) return null;
  const updated: WebhookDeliveryRecord = {
    ...current,
    status: patch.status ?? current.status,
    attempts: patch.attempts ?? current.attempts,
    nextAttemptAt: patch.nextAttemptAt ?? current.nextAttemptAt,
    responseCode: patch.responseCode !== undefined ? patch.responseCode : current.responseCode,
    lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
    updatedAt: now(),
  };
  state.webhookDeliveries.set(id, updated);
  return updated;
}
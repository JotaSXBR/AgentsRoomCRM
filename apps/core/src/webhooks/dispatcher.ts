import type { Store, WebhookDeliveryRecord, WebhookEndpointRecord } from "../stores/store.js";
import { signWebhookPayload } from "../lib/apiKeys.js";

export interface WebhookDispatcherDeps {
  store: Store;
  /** Injetável para teste (o servidor usa `fetch`). */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => Date;
}

export interface EmitResult {
  queued: number;
  event: string;
}

/** Endpoint recebe o evento seINCLUDE `*` ou lista o nome explicitamente. */
function subscribedTo(endpoint: WebhookEndpointRecord, event: string): boolean {
  return endpoint.active && endpoint.events.includes("*")
    ? true
    : endpoint.active && endpoint.events.includes(event);
}

function retryDelayMs(attempts: number, base: number, max: number): number {
  return Math.min(base * 2 ** Math.max(0, attempts - 1), max);
}

function isoPlusMs(now: Date, ms: number): string {
  return new Date(now.getTime() + ms).toISOString();
}

/**
 * Publica um evento nos endpoints do workspace, enfileirando uma entrega por
 * endpoint. Nunca lança: uma falha aqui não pode derrubar a operação de
 * negócio que originou o evento (a fila de entrega é quem carrega o erro).
 */
export async function emitWebhookEvent(
  deps: WebhookDispatcherDeps,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<EmitResult> {
  const endpoints = (await deps.store.listWebhookEndpoints(workspaceId)).filter((e) =>
    subscribedTo(e, event),
  );
  for (const endpoint of endpoints) {
    await deps.store.enqueueWebhookDelivery({
      workspaceId,
      endpointId: endpoint.id,
      event,
      payload: { event, workspaceId, at: new Date().toISOString(), data: payload },
    });
  }
  return { queued: endpoints.length, event };
}

function headersFor(
  endpoint: WebhookEndpointRecord,
  delivery: WebhookDeliveryRecord,
  body: string,
  timestamp: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-agentsroom-event": delivery.event,
    "x-agentsroom-delivery": delivery.id,
    "x-agentsroom-timestamp": timestamp,
    "x-agentsroom-signature": signWebhookPayload(endpoint.secret, timestamp, body),
    "user-agent": "AgentsRoomCRM-Webhooks/1",
  };
}

async function deliver(
  deps: WebhookDispatcherDeps,
  endpoint: WebhookEndpointRecord,
  delivery: WebhookDeliveryRecord,
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? new Date();
  const attempts = delivery.attempts + 1;
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify(delivery.payload);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: headersFor(endpoint, delivery, body, timestamp),
      body,
    });
    if (response.ok) {
      await deps.store.markWebhookDelivery(endpoint.workspaceId, delivery.id, {
        status: "entregue",
        attempts,
        responseCode: response.status,
        lastError: null,
      });
      return true;
    }
    await failOrRetry(deps, endpoint, delivery, { attempts, reason: `HTTP ${response.status}` });
    return false;
  } catch (error) {
    await failOrRetry(deps, endpoint, delivery, { attempts, reason: (error as Error).message });
    return false;
  }
}

/** Desfecho de uma tentativa de entrega (objeto único para caber no orçamento de parâmetros). */
interface AttemptOutcome {
  attempts: number;
  reason: string;
}

async function failOrRetry(
  deps: WebhookDispatcherDeps,
  endpoint: WebhookEndpointRecord,
  delivery: WebhookDeliveryRecord,
  outcome: AttemptOutcome,
): Promise<void> {
  const { attempts, reason } = outcome;
  const maxAttempts = deps.maxAttempts ?? 5;
  if (attempts >= maxAttempts) {
    await deps.store.markWebhookDelivery(endpoint.workspaceId, delivery.id, {
      status: "falhou",
      attempts,
      lastError: reason,
    });
    return;
  }
  const now = deps.now?.() ?? new Date();
  const delay = retryDelayMs(attempts, deps.baseDelayMs ?? 30_000, deps.maxDelayMs ?? 3_600_000);
  await deps.store.markWebhookDelivery(endpoint.workspaceId, delivery.id, {
    status: "pendente",
    attempts,
    nextAttemptAt: isoPlusMs(now, delay),
    lastError: reason,
  });
}

/** Processa as entregas pendentes de TODOS os workspaces (ticker do servidor). */
export async function deliverAllWorkspaces(
  deps: WebhookDispatcherDeps,
  options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number },
): Promise<{ workspaces: number; delivered: number }> {
  const workspaces = await deps.store.listWorkspaces();
  let delivered = 0;
  for (const workspace of workspaces) {
    const result = await processWebhookDeliveries(
      { ...deps, maxAttempts: options.maxAttempts, baseDelayMs: options.baseDelayMs, maxDelayMs: options.maxDelayMs },
      workspace.id,
    );
    delivered += result.delivered;
  }
  return { workspaces: workspaces.length, delivered };
}

/** Processa as entregas pendentes de um workspace (ticker do servidor). */
export async function processWebhookDeliveries(
  deps: WebhookDispatcherDeps,
  workspaceId: string,
  limit = 25,
): Promise<{ attempted: number; delivered: number }> {
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const due = (await deps.store.listWebhookDeliveries(workspaceId, { status: "pendente" }))
    .filter((d) => d.nextAttemptAt <= nowIso)
    .slice(0, limit);
  let delivered = 0;
  for (const delivery of due) {
    const endpoint = await deps.store.findWebhookEndpoint(workspaceId, delivery.endpointId);
    // Endpoint apagado: a entrega em cascata já sumiu; nada a fazer.
    if (!endpoint) continue;
    if (await deliver(deps, endpoint, delivery)) delivered += 1;
  }
  return { attempted: due.length, delivered };
}
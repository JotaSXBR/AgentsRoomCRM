import type {
  ApiKeyRecord,
  ApiKeyScope,
  ConsentKind,
  ContactConsentRecord,
  ConversationRatingRecord,
  FlowAction,
  FlowRecord,
  FlowStepRecord,
  LgpdRequestRecord,
  RatingSource,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookEndpointRecord,
  WorkspaceModuleRecord,
} from "../store.js";

const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v ? iso(v) : null);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function rowToApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    prefix: String(row.prefix),
    keyHash: String(row.key_hash),
    scopes: (row.scopes as ApiKeyScope[]) ?? [],
    createdBy: strOrNull(row.created_by),
    lastUsedAt: isoOrNull(row.last_used_at),
    revokedAt: isoOrNull(row.revoked_at),
    createdAt: iso(row.created_at),
  };
}

export function rowToWebhookEndpoint(row: Record<string, unknown>): WebhookEndpointRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    url: String(row.url),
    secret: String(row.secret),
    events: (row.events as string[]) ?? [],
    active: Boolean(row.active),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function rowToWebhookDelivery(row: Record<string, unknown>): WebhookDeliveryRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    endpointId: String(row.endpoint_id),
    event: String(row.event),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as WebhookDeliveryStatus,
    attempts: Number(row.attempts),
    nextAttemptAt: iso(row.next_attempt_at),
    responseCode: row.response_code === null ? null : Number(row.response_code),
    lastError: strOrNull(row.last_error),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function rowToRating(row: Record<string, unknown>): ConversationRatingRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    score: Number(row.score),
    comment: strOrNull(row.comment),
    source: row.source as RatingSource,
    ratedBy: strOrNull(row.rated_by),
    createdAt: iso(row.created_at),
  };
}

export function rowToConsent(row: Record<string, unknown>): ContactConsentRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    kind: row.kind as ConsentKind,
    granted: Boolean(row.granted),
    source: String(row.source),
    note: strOrNull(row.note),
    grantedAt: isoOrNull(row.granted_at),
    revokedAt: isoOrNull(row.revoked_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function rowToLgpdRequest(row: Record<string, unknown>): LgpdRequestRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    contactId: strOrNull(row.contact_id),
    scope: row.scope as LgpdRequestRecord["scope"],
    action: row.action as LgpdRequestRecord["action"],
    status: row.status as LgpdRequestRecord["status"],
    summary: (row.summary as Record<string, unknown>) ?? {},
    requestedBy: strOrNull(row.requested_by),
    createdAt: iso(row.created_at),
  };
}

export function rowToFlowStep(row: Record<string, unknown>): FlowStepRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    flowId: String(row.flow_id),
    position: Number(row.position),
    action: row.action as FlowAction,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: iso(row.created_at),
  };
}

export function rowToFlow(row: Record<string, unknown>, steps: FlowStepRecord[]): FlowRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    terms: (row.terms as string[]) ?? [],
    active: Boolean(row.active),
    steps,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function rowToWorkspaceModule(row: Record<string, unknown>): WorkspaceModuleRecord {
  return {
    workspaceId: String(row.workspace_id),
    moduleKey: String(row.module_key),
    enabled: Boolean(row.enabled),
    config: (row.config as Record<string, unknown>) ?? {},
    updatedAt: iso(row.updated_at),
  };
}
import { randomUUID } from "node:crypto";
import type { OutboundRecord } from "../types/outbound.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type OutboundState = Pick<MemoryState, "outboundQueue">;

export async function enqueueOutbound(
  state: OutboundState,
  input: {
    workspaceId: string;
    channel: string;
    conversationId?: string | null;
    messageId?: string | null;
    mailboxId?: string | null;
    toValue: string;
    subject?: string | null;
    text?: string | null;
  },
): Promise<OutboundRecord> {
  const record: OutboundRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    channel: input.channel,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    mailboxId: input.mailboxId ?? null,
    toValue: input.toValue,
    subject: input.subject ?? null,
    text: input.text ?? null,
    status: "pendente",
    attempts: 0,
    nextAttemptAt: now(),
    lastError: null,
    providerMessageId: null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.outboundQueue.set(record.id, record);
  return record;
}

export async function listOutboundDue(
  state: OutboundState,
  workspaceId: string,
  nowIso: string,
  limit = 25,
): Promise<OutboundRecord[]> {
  return [...state.outboundQueue.values()]
    .filter(
      (o) =>
        o.workspaceId === workspaceId &&
        o.status === "pendente" &&
        o.nextAttemptAt <= nowIso,
    )
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
    .slice(0, limit);
}

export async function listOutbound(
  state: OutboundState,
  workspaceId: string,
  filter?: { status?: string },
): Promise<OutboundRecord[]> {
  return [...state.outboundQueue.values()]
    .filter(
      (o) =>
        o.workspaceId === workspaceId &&
        (!filter?.status || o.status === filter.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
}

export async function markOutboundSent(
  state: OutboundState,
  workspaceId: string,
  id: string,
  providerMessageId: string | null,
): Promise<OutboundRecord | null> {
  const o = state.outboundQueue.get(id);
  if (!o || o.workspaceId !== workspaceId) return null;
  const updated: OutboundRecord = {
    ...o,
    status: "enviado",
    providerMessageId,
    lastError: null,
    updatedAt: now(),
  };
  state.outboundQueue.set(id, updated);
  return updated;
}

export async function markOutboundRetry(
  state: OutboundState,
  workspaceId: string,
  id: string,
  retry: { nextAttemptIso: string; error: string },
): Promise<OutboundRecord | null> {
  const o = state.outboundQueue.get(id);
  if (!o || o.workspaceId !== workspaceId) return null;
  const updated: OutboundRecord = {
    ...o,
    status: "pendente",
    attempts: o.attempts + 1,
    nextAttemptAt: retry.nextAttemptIso,
    lastError: retry.error.slice(0, 500),
    updatedAt: now(),
  };
  state.outboundQueue.set(id, updated);
  return updated;
}

export async function markOutboundFailed(
  state: OutboundState,
  workspaceId: string,
  id: string,
  error: string,
): Promise<OutboundRecord | null> {
  const o = state.outboundQueue.get(id);
  if (!o || o.workspaceId !== workspaceId) return null;
  const updated: OutboundRecord = {
    ...o,
    status: "falhou",
    attempts: o.attempts + 1,
    lastError: error.slice(0, 500),
    updatedAt: now(),
  };
  state.outboundQueue.set(id, updated);
  return updated;
}

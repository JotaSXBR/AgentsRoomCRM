import { randomUUID } from "node:crypto";
import type {
  QueueRecord,
  QueueTicketRecord,
  TicketStatus,
} from "../types/queues.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type QueuesState = Pick<
  MemoryState,
  "queues" | "queueMembers" | "tickets" | "conversations"
>;

export async function createQueue(
  state: QueuesState,
  input: {
    workspaceId: string;
    name: string;
    channel?: string | null;
    isDefault?: boolean;
  },
): Promise<QueueRecord> {
  for (const q of state.queues.values()) {
    if (q.workspaceId === input.workspaceId && q.name === input.name) {
      throw new Error("fila_nome_em_uso");
    }
  }
  if (input.isDefault) {
    for (const q of state.queues.values()) {
      if (q.workspaceId === input.workspaceId) state.queues.set(q.id, { ...q, isDefault: false });
    }
  }
  const queue: QueueRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    channel: input.channel ?? null,
    isDefault: input.isDefault ?? false,
    createdAt: now(),
  };
  state.queues.set(queue.id, queue);
  return queue;
}

export async function listQueues(
  state: QueuesState,
  workspaceId: string,
): Promise<QueueRecord[]> {
  return [...state.queues.values()]
    .filter((q) => q.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findQueueById(
  state: QueuesState,
  workspaceId: string,
  id: string,
): Promise<QueueRecord | null> {
  const q = state.queues.get(id);
  return q && q.workspaceId === workspaceId ? q : null;
}

export async function deleteQueue(
  state: QueuesState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const q = state.queues.get(id);
  if (!q || q.workspaceId !== workspaceId) return false;
  state.queues.delete(id);
  for (const [key, m] of state.queueMembers) if (m.queueId === id) state.queueMembers.delete(key);
  return true;
}

export async function addQueueMember(
  state: QueuesState,
  input: { workspaceId: string; queueId: string; userId: string },
): Promise<void> {
  const key = `${input.queueId}:${input.userId}`;
  if (!state.queueMembers.has(key)) {
    state.queueMembers.set(key, { ...input, createdAt: now() });
  }
}

export async function removeQueueMember(
  state: QueuesState,
  workspaceId: string,
  queueId: string,
  userId: string,
): Promise<boolean> {
  const key = `${queueId}:${userId}`;
  const m = state.queueMembers.get(key);
  if (!m || m.workspaceId !== workspaceId) return false;
  return state.queueMembers.delete(key);
}

export async function listQueueMembers(
  state: QueuesState,
  workspaceId: string,
  queueId: string,
): Promise<string[]> {
  return [...state.queueMembers.values()]
    .filter((m) => m.workspaceId === workspaceId && m.queueId === queueId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((m) => m.userId);
}

export async function enqueueTicket(
  state: QueuesState,
  input: {
    workspaceId: string;
    queueId: string;
    conversationId: string;
    channel: string;
  },
): Promise<QueueTicketRecord> {
  const queue = state.queues.get(input.queueId);
  if (!queue || queue.workspaceId !== input.workspaceId) throw new Error("fila_invalida");
  const conv = state.conversations.get(input.conversationId);
  if (!conv || conv.workspaceId !== input.workspaceId) throw new Error("conversa_invalida");
  const ticket: QueueTicketRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    queueId: input.queueId,
    conversationId: input.conversationId,
    channel: input.channel,
    status: "aguardando",
    assignedUserId: null,
    enqueuedAt: now(),
    firstResponseAt: null,
    resolvedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.tickets.set(ticket.id, ticket);
  return ticket;
}

export async function listTickets(
  state: QueuesState,
  workspaceId: string,
  filter?: { queueId?: string; status?: string; assignedUserId?: string },
): Promise<QueueTicketRecord[]> {
  return [...state.tickets.values()]
    .filter(
      (t) =>
        t.workspaceId === workspaceId &&
        (!filter?.queueId || t.queueId === filter.queueId) &&
        (!filter?.status || t.status === filter.status) &&
        (!filter?.assignedUserId || t.assignedUserId === filter.assignedUserId),
    )
    .sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt));
}

export async function findTicketById(
  state: QueuesState,
  workspaceId: string,
  id: string,
): Promise<QueueTicketRecord | null> {
  const t = state.tickets.get(id);
  return t && t.workspaceId === workspaceId ? t : null;
}

export async function findOpenTicketByConversation(
  state: QueuesState,
  workspaceId: string,
  conversationId: string,
): Promise<QueueTicketRecord | null> {
  for (const t of state.tickets.values()) {
    if (
      t.workspaceId === workspaceId &&
      t.conversationId === conversationId &&
      t.status !== "resolvido" &&
      t.status !== "cancelado"
    ) {
      return t;
    }
  }
  return null;
}

export async function updateTicket(
  state: QueuesState,
  workspaceId: string,
  id: string,
  patch: {
    status?: TicketStatus;
    assignedUserId?: string | null;
    firstResponseAt?: string | null;
    resolvedAt?: string | null;
  },
): Promise<QueueTicketRecord | null> {
  const t = state.tickets.get(id);
  if (!t || t.workspaceId !== workspaceId) return null;
  const updated: QueueTicketRecord = {
    ...t,
    status: patch.status ?? t.status,
    assignedUserId: patch.assignedUserId !== undefined ? patch.assignedUserId : t.assignedUserId,
    firstResponseAt: patch.firstResponseAt !== undefined ? patch.firstResponseAt : t.firstResponseAt,
    resolvedAt: patch.resolvedAt !== undefined ? patch.resolvedAt : t.resolvedAt,
    updatedAt: now(),
  };
  state.tickets.set(id, updated);
  return updated;
}

export async function markTicketFirstResponse(
  state: QueuesState,
  workspaceId: string,
  conversationId: string,
): Promise<QueueTicketRecord | null> {
  const ticket = await findOpenTicketByConversation(state, workspaceId, conversationId);
  if (!ticket || ticket.firstResponseAt) return ticket;
  return updateTicket(state, workspaceId, ticket.id, {
    firstResponseAt: now(),
    status: ticket.status === "aguardando" ? "em_atendimento" : ticket.status,
  });
}

export async function resolveOpenTicketForConversation(
  state: QueuesState,
  workspaceId: string,
  conversationId: string,
): Promise<QueueTicketRecord | null> {
  const ticket = await findOpenTicketByConversation(state, workspaceId, conversationId);
  if (!ticket) return null;
  return updateTicket(state, workspaceId, ticket.id, { status: "resolvido", resolvedAt: now() });
}

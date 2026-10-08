import type { QueueRecord, Store } from "../stores/store.js";
import type { RealtimeHub } from "../realtime/hub.js";

// Distribuição automática: atende quem tem menos tickets abertos na fila;
// empate cai para o atendente que entrou primeiro na fila.
export async function leastLoadedAssignee(
  store: Store,
  workspaceId: string,
  queueId: string,
): Promise<string | null> {
  const members = await store.listQueueMembers(workspaceId, queueId);
  if (members.length === 0) return null;
  const open = await store.listTickets(workspaceId, { queueId });
  const count = new Map<string, number>(members.map((m) => [m, 0]));
  for (const ticket of open) {
    if (ticket.status === "resolvido" || ticket.status === "cancelado") continue;
    if (ticket.assignedUserId && count.has(ticket.assignedUserId)) {
      count.set(ticket.assignedUserId, (count.get(ticket.assignedUserId) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const userId of members) {
    const c = count.get(userId) ?? 0;
    if (c < bestCount) {
      best = userId;
      bestCount = c;
    }
  }
  return best;
}

export function pickDefaultQueue(
  queues: QueueRecord[],
  channel?: string,
): QueueRecord | null {
  if (queues.length === 0) return null;
  return (
    queues.find((q) => q.isDefault) ??
    (channel ? queues.find((q) => q.channel === channel) : undefined) ??
    queues[0]
  );
}

export async function enqueueAndDistribute(
  store: Store,
  hub: RealtimeHub | null,
  input: { workspaceId: string; queueId: string; conversationId: string; channel: string },
): Promise<{ ticketId: string; assignedUserId: string | null }> {
  const ticket = await store.enqueueTicket(input);
  const assignee = await leastLoadedAssignee(store, input.workspaceId, input.queueId);
  const assigned =
    assignee === null
      ? ticket
      : ((await store.updateTicket(input.workspaceId, ticket.id, { assignedUserId: assignee })) ?? ticket);
  hub?.publish(input.workspaceId, {
    kind: "fila.ticket",
    data: { ...assigned, event: "criado" },
  });
  return { ticketId: ticket.id, assignedUserId: assigned.assignedUserId };
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { QueueTicketRecord, Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";

const GROUPS = ["queue", "channel", "assignee", "all"] as const;
type GroupBy = (typeof GROUPS)[number];

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  groupBy: z.enum(GROUPS).default("queue"),
});

interface SlaBucket {
  key: string;
  total: number;
  resolvidos: number;
  tmeMedioSeg: number | null;
  tmaMedioSeg: number | null;
  tmeAmostras: number;
  tmaAmostras: number;
}

interface BucketSummary {
  resolvidos: number;
  tme: number[];
  tma: number[];
}

function groupKey(ticket: QueueTicketRecord, groupBy: GroupBy): string {
  switch (groupBy) {
    case "queue": return ticket.queueId;
    case "channel": return ticket.channel;
    case "assignee": return ticket.assignedUserId ?? "sem_atendente";
    case "all": return "todos";
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function parseSlaWindow(query: unknown): { from: Date; to: Date; groupBy: GroupBy } {
  const parsed = querySchema.parse(query ?? {});
  return {
    from: parsed.from ? new Date(parsed.from) : new Date(0),
    to: parsed.to ? new Date(parsed.to) : new Date(),
    groupBy: parsed.groupBy,
  };
}

function filterTicketsByWindow(
  tickets: QueueTicketRecord[],
  from: Date,
  to: Date,
): QueueTicketRecord[] {
  return tickets.filter((t) => {
    const enq = new Date(t.enqueuedAt);
    return enq >= from && enq <= to;
  });
}

function bucketTicketsByGroup(
  tickets: QueueTicketRecord[],
  groupBy: GroupBy,
): Map<string, QueueTicketRecord[]> {
  const buckets = new Map<string, QueueTicketRecord[]>();
  for (const ticket of tickets) {
    const key = groupKey(ticket, groupBy);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(ticket);
    } else {
      buckets.set(key, [ticket]);
    }
  }
  return buckets;
}

function collectWaitSeconds(ticket: QueueTicketRecord, enqueuedMs: number, tme: number[]): void {
  if (!ticket.firstResponseAt) return;
  const wait = (Date.parse(ticket.firstResponseAt) - enqueuedMs) / 1000;
  if (wait >= 0) tme.push(wait);
}

function collectServiceSeconds(ticket: QueueTicketRecord, enqueuedMs: number, tma: number[]): void {
  if (!ticket.resolvedAt) return;
  const end = Date.parse(ticket.resolvedAt);
  const start = ticket.firstResponseAt ? Date.parse(ticket.firstResponseAt) : enqueuedMs;
  const dur = (end - start) / 1000;
  if (dur >= 0) tma.push(dur);
}

function summarizeBucket(tickets: QueueTicketRecord[]): BucketSummary {
  const tme: number[] = [];
  const tma: number[] = [];
  let resolvidos = 0;
  for (const ticket of tickets) {
    if (ticket.resolvedAt) resolvidos += 1;
    const enq = Date.parse(ticket.enqueuedAt);
    collectWaitSeconds(ticket, enq, tme);
    collectServiceSeconds(ticket, enq, tma);
  }
  return { resolvidos, tme, tma };
}

function resolveBucketLabel(
  groupBy: GroupBy,
  key: string,
  queueName: Map<string, string>,
): string {
  if (groupBy !== "queue") return key;
  return queueName.get(key) ?? key;
}

function buildSlaGroups(
  buckets: Map<string, QueueTicketRecord[]>,
  groupBy: GroupBy,
  queueName: Map<string, string>,
): SlaBucket[] {
  const groups: SlaBucket[] = [];
  for (const [key, tickets] of buckets) {
    const summary = summarizeBucket(tickets);
    groups.push({
      key: resolveBucketLabel(groupBy, key, queueName),
      total: tickets.length,
      resolvidos: summary.resolvidos,
      tmeMedioSeg: average(summary.tme),
      tmaMedioSeg: average(summary.tma),
      tmeAmostras: summary.tme.length,
      tmaAmostras: summary.tma.length,
    });
  }
  return groups;
}

/**
 * SLA básico (F3). Por ticket, na janela `from`..`to` (filtra enqueued_at):
 * - TME (tempo médio de espera): enqueued_at → first_response_at.
 * - TMA (tempo médio de atendimento): first_response_at → resolved_at
 *   (sem 1ª resposta registrada, cai para enqueued_at → resolved_at).
 * Agrupa por fila (padrão), canal, atendente ou "all".
 */
export async function metricsRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/metrics/sla",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const slaWindow = parseSlaWindow(request.query);
      const all = await store.listTickets(workspaceId, {});
      const tickets = filterTicketsByWindow(all, slaWindow.from, slaWindow.to);
      const queues = await store.listQueues(workspaceId);
      const queueName = new Map(queues.map((q) => [q.id, q.name]));
      const buckets = bucketTicketsByGroup(tickets, slaWindow.groupBy);
      const groups = buildSlaGroups(buckets, slaWindow.groupBy, queueName);
      groups.sort((a, b) => b.total - a.total);
      return {
        from: slaWindow.from.toISOString(),
        to: slaWindow.to.toISOString(),
        groupBy: slaWindow.groupBy,
        data: groups,
      };
    },
  );
}

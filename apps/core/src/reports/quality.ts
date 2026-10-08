import type {
  ConversationRatingRecord,
  QueueTicketRecord,
  QueueRecord,
  Store,
} from "../stores/store.js";

export const QUALITY_GROUPS = ["assignee", "queue", "channel", "all"] as const;
export type QualityGroup = (typeof QUALITY_GROUPS)[number];

export interface QualityBucket {
  key: string;
  tickets: number;
  resolvidos: number;
  /** TME: enqueued_at → first_response_at (segundos). */
  tmeMedioSeg: number | null;
  tmeMedianaSeg: number | null;
  /** TMA: first_response_at → resolved_at (segundos). */
  tmaMedioSeg: number | null;
  tmaMedianaSeg: number | null;
  /** CSAT: média das notas 1..5 das conversas deste grupo. */
  csatMedio: number | null;
  csatRespostas: number;
  /** % de tickets com TME abaixo da meta (`tmeAlvoSeg`), quando definida. */
  slaTmePct: number | null;
  /** % de tickets resolvidos dentro da janela. */
  resolucaoPct: number | null;
  tmeAmostras: number;
  tmaAmostras: number;
}

export interface QualityReport {
  from: string;
  to: string;
  groupBy: QualityGroup;
  /** Meta de TME por bucket (mesma chave de `key`), em segundos. */
  tmeAlvoSeg: number | null;
  totals: QualityBucket;
  data: QualityBucket[];
}

interface Accumulator {
  tickets: number;
  resolvidos: number;
  tme: number[];
  tma: number[];
  csat: number[];
}

function emptyAccumulator(): Accumulator {
  return { tickets: 0, resolvidos: 0, tme: [], tma: [], csat: [] };
}

/** Mediana de uma lista já ordenada de forma crescente. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return value;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function meanToOneDecimal(values: number[]): number | null {
  const value = mean(values);
  return value === null ? null : Math.round(value * 10) / 10;
}

function ticketWaitSeconds(ticket: QueueTicketRecord): number | null {
  if (!ticket.firstResponseAt) return null;
  const wait = (Date.parse(ticket.firstResponseAt) - Date.parse(ticket.enqueuedAt)) / 1000;
  return wait >= 0 ? wait : null;
}

function ticketServiceSeconds(ticket: QueueTicketRecord): number | null {
  if (!ticket.resolvedAt) return null;
  const start = ticket.firstResponseAt ?? ticket.enqueuedAt;
  const duration = (Date.parse(ticket.resolvedAt) - Date.parse(start)) / 1000;
  return duration >= 0 ? duration : null;
}

function groupKeyOf(
  ticket: QueueTicketRecord,
  groupBy: QualityGroup,
  queueNames: Map<string, string>,
): string {
  switch (groupBy) {
    case "queue": return queueNames.get(ticket.queueId) ?? ticket.queueId;
    case "channel": return ticket.channel;
    case "assignee": return ticket.assignedUserId ?? "sem_atendente";
    case "all": return "todos";
  }
}

function withinWindow(ticket: QueueTicketRecord, from: Date, to: Date): boolean {
  const enqueued = new Date(ticket.enqueuedAt);
  return enqueued >= from && enqueued <= to;
}

function pushIfNotNull(target: number[], value: number | null): void {
  if (value !== null) target.push(value);
}

function collect(
  acc: Accumulator,
  ticket: QueueTicketRecord,
  ratingByConversation: Map<string, ConversationRatingRecord>,
): void {
  acc.tickets += 1;
  if (ticket.resolvedAt) acc.resolvidos += 1;
  pushIfNotNull(acc.tme, ticketWaitSeconds(ticket));
  pushIfNotNull(acc.tma, ticketServiceSeconds(ticket));
  const rating = ratingByConversation.get(ticket.conversationId);
  if (rating) acc.csat.push(rating.score);
}

function buildBucket(key: string, acc: Accumulator, tmeAlvoSeg: number | null): QualityBucket {
  const dentroDoAlvo = tmeAlvoSeg === null ? null : acc.tme.filter((v) => v <= tmeAlvoSeg).length;
  return {
    key,
    tickets: acc.tickets,
    resolvidos: acc.resolvidos,
    tmeMedioSeg: mean(acc.tme),
    tmeMedianaSeg: median([...acc.tme].sort((a, b) => a - b)),
    tmaMedioSeg: mean(acc.tma),
    tmaMedianaSeg: median([...acc.tma].sort((a, b) => a - b)),
    csatMedio: meanToOneDecimal(acc.csat),
    csatRespostas: acc.csat.length,
    slaTmePct: dentroDoAlvo === null || acc.tme.length === 0
      ? null
      : Math.round((dentroDoAlvo / acc.tme.length) * 1000) / 10,
    resolucaoPct: acc.tickets === 0
      ? null
      : Math.round((acc.resolvidos / acc.tickets) * 1000) / 10,
    tmeAmostras: acc.tme.length,
    tmaAmostras: acc.tma.length,
  };
}

export interface QualityQuery {
  from?: Date;
  to?: Date;
  groupBy?: QualityGroup;
  tmeAlvoSeg?: number | null;
}

/**
 * Relatório de qualidade (F5): TME/TMA + CSAT por atendente, fila ou canal.
 * Mesmas amostras do SLA da F3 (`first_response_at`/`resolved_at` do ticket),
 * mais as notas 1..5 de `conversation_ratings`.
 */
export async function buildQualityReport(
  store: Store,
  workspaceId: string,
  query: QualityQuery = {},
): Promise<QualityReport> {
  const groupBy: QualityGroup = query.groupBy ?? "assignee";
  const from = query.from ?? new Date(0);
  const to = query.to ?? new Date();
  const tmeAlvoSeg = query.tmeAlvoSeg ?? null;
  const tickets = (await store.listTickets(workspaceId)).filter((t) => withinWindow(t, from, to));
  const queues = await store.listQueues(workspaceId);
  const queueNames = new Map(queues.map((q: QueueRecord) => [q.id, q.name]));
  const ratings = await store.listRatings(workspaceId);
  const ratingByConversation = new Map(ratings.map((r) => [r.conversationId, r]));

  const buckets = new Map<string, Accumulator>();
  const totals = emptyAccumulator();
  for (const ticket of tickets) {
    const key = groupKeyOf(ticket, groupBy, queueNames);
    const acc = buckets.get(key) ?? emptyAccumulator();
    buckets.set(key, acc);
    collect(acc, ticket, ratingByConversation);
    collect(totals, ticket, ratingByConversation);
  }

  const data = [...buckets.entries()]
    .map(([key, acc]) => buildBucket(key, acc, tmeAlvoSeg))
    .sort((a, b) => b.tickets - a.tickets);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy,
    tmeAlvoSeg,
    totals: buildBucket("todos", totals, tmeAlvoSeg),
    data,
  };
}
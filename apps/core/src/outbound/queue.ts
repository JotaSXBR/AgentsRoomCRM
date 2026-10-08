import type { Store } from "../stores/store.js";

/**
 * Fila de saída (F2b): toda resposta do atendente para Meta/e-mail é
 * enfileirada e entregue com retry exponencial. Isolamento total: o
 * processador só enxerga itens do `workspaceId` informado.
 */

export interface OutboundSender {
  sendMeta(input: {
    channel: string;
    toValue: string;
    text: string | null;
  }): Promise<{ externalId: string }>;
  sendMail(input: {
    mailboxId: string | null;
    toValue: string;
    subject: string | null;
    text: string | null;
  }): Promise<{ externalId: string }>;
}

export interface ProcessOutboundOptions {
  now?: Date;
  limit?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface ProcessOutboundSummary {
  due: number;
  sent: number;
  retried: number;
  failed: number;
}

/** Backoff exponencial: base * 2^attempts, limitado ao teto. */
export function computeBackoffDelayMs(
  attempts: number,
  baseMs: number,
  capMs: number,
): number {
  const delay = baseMs * 2 ** Math.max(0, attempts);
  return Math.min(delay, capMs);
}

interface OutboundTuning {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function resolveTuning(options: ProcessOutboundOptions): { now: Date; limit: number; tuning: OutboundTuning } {
  return {
    now: options.now ?? new Date(),
    limit: options.limit ?? 25,
    tuning: {
      maxAttempts: options.maxAttempts ?? 8,
      baseDelayMs: options.baseDelayMs ?? 30_000,
      maxDelayMs: options.maxDelayMs ?? 3_600_000,
    },
  };
}

async function deliverOutboundItem(
  sender: OutboundSender,
  item: { channel: string; mailboxId: string | null; toValue: string; subject: string | null; text: string | null },
): Promise<{ externalId: string }> {
  if (item.channel === "email") {
    return sender.sendMail({
      mailboxId: item.mailboxId,
      toValue: item.toValue,
      subject: item.subject,
      text: item.text,
    });
  }
  return sender.sendMeta({ channel: item.channel, toValue: item.toValue, text: item.text });
}

interface SettleCtx {
  store: Store;
  workspaceId: string;
  sender: OutboundSender;
  now: Date;
  tuning: OutboundTuning;
  summary: ProcessOutboundSummary;
}

async function settleOutboundFailure(
  ctx: SettleCtx,
  item: { id: string; attempts: number },
  message: string,
): Promise<void> {
  const { store, workspaceId, now, tuning, summary } = ctx;
  const attemptsAfter = item.attempts + 1;
  if (attemptsAfter >= tuning.maxAttempts) {
    await store.markOutboundFailed(workspaceId, item.id, message);
    summary.failed += 1;
    return;
  }
  const delay = computeBackoffDelayMs(item.attempts, tuning.baseDelayMs, tuning.maxDelayMs);
  await store.markOutboundRetry(
    workspaceId,
    item.id,
    new Date(now.getTime() + delay).toISOString(),
    message,
  );
  summary.retried += 1;
}

async function settleOutboundItem(
  ctx: SettleCtx,
  item: { id: string; attempts: number; channel: string; mailboxId: string | null; toValue: string; subject: string | null; text: string | null },
): Promise<void> {
  const { store, workspaceId, sender, summary } = ctx;
  try {
    const result = await deliverOutboundItem(sender, item);
    await store.markOutboundSent(workspaceId, item.id, result.externalId);
    summary.sent += 1;
  } catch (error) {
    await settleOutboundFailure(ctx, item, errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Processa os itens vencidos de UM workspace: tenta enviar, marca `enviado`
 * no sucesso; no erro, reagenda (backoff) ou marca `falhou` ao estourar
 * `maxAttempts`. Nunca toca outro workspace.
 */
export async function processWorkspaceOutbound(
  store: Store,
  workspaceId: string,
  sender: OutboundSender,
  options: ProcessOutboundOptions = {},
): Promise<ProcessOutboundSummary> {
  const { now, limit, tuning } = resolveTuning(options);
  const due = await store.listOutboundDue(workspaceId, now.toISOString(), limit);
  const summary: ProcessOutboundSummary = { due: due.length, sent: 0, retried: 0, failed: 0 };
  const ctx: SettleCtx = { store, workspaceId, sender, now, tuning, summary };
  for (const item of due) {
    await settleOutboundItem(ctx, item);
  }
  return summary;
}

/** Varre todos os workspaces (usado pelo ticker de fundo do servidor). */
export async function processAllWorkspaces(
  store: Store,
  buildSender: (workspaceId: string) => Promise<OutboundSender | null>,
  options: ProcessOutboundOptions = {},
): Promise<Record<string, ProcessOutboundSummary>> {
  const result: Record<string, ProcessOutboundSummary> = {};
  for (const ws of await store.listWorkspaces()) {
    const sender = await buildSender(ws.id);
    if (!sender) continue;
    result[ws.id] = await processWorkspaceOutbound(store, ws.id, sender, options);
  }
  return result;
}

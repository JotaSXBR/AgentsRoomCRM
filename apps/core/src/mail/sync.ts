import { ingestIncoming } from "../intake.js";
import { runBotOnIncoming } from "../bot/engine.js";
import { decryptSecret } from "../lib/secrets.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { MailboxRecord, Store } from "../stores/store.js";
import type { IncomingMail, MailReceiver } from "./transport.js";

export interface MailSyncSummary {
  ingested: number;
  duplicates: number;
  errors: Array<{ mailboxId: string; error: string }>;
}

export interface MailSyncCtx {
  store: Store;
  hub: RealtimeHub | null;
  workspaceId: string;
  receiver: MailReceiver;
  secretsKey: string;
  ai?: import("../ai/orchestrate.js").AiDeps;
}

function mailboxCredentials(
  mailbox: MailboxRecord,
  secretsKey: string,
): Parameters<MailReceiver["listNew"]>[0] {
  return {
    fromEmail: mailbox.fromEmail,
    fromName: mailbox.fromName,
    smtpHost: mailbox.smtpHost,
    smtpPort: mailbox.smtpPort,
    smtpUser: mailbox.smtpUser,
    smtpPass: decryptSecret(mailbox.smtpPassEnc, secretsKey),
    imapHost: mailbox.imapHost,
    imapPort: mailbox.imapPort,
    imapUser: mailbox.imapUser,
    imapPass: decryptSecret(mailbox.imapPassEnc, secretsKey),
  };
}

function mailText(mail: IncomingMail): string {
  return mail.subject ? `Assunto: ${mail.subject}\n\n${mail.text ?? ""}` : (mail.text ?? "");
}

async function ingestOneMail(
  ctx: MailSyncCtx,
  mail: IncomingMail,
): Promise<"ingerida" | "duplicada" | "invalida"> {
  const fromValue = mail.fromEmail.trim().toLowerCase();
  if (!fromValue.includes("@")) return "invalida";
  const result = await ingestIncoming(ctx.store, {
    workspaceId: ctx.workspaceId,
    channel: "email",
    source: "mail",
    externalId: mail.messageId,
    contactName: mail.fromName ?? fromValue,
    contactValue: fromValue,
    email: fromValue,
    text: mailText(mail),
  });
  if (result.duplicate) return "duplicada";
  ctx.hub?.publish(ctx.workspaceId, { kind: "mensagem.criada", data: result.message });
  ctx.hub?.publish(ctx.workspaceId, { kind: "conversa.atualizada", data: result.conversation });
  await runBotOnIncoming(ctx.store, ctx.hub, {
    workspaceId: ctx.workspaceId,
    conversationId: result.conversation.id,
    channel: "email",
    text: mailText(mail),
  }, ctx.ai);
  return "ingerida";
}

/**
 * Polling IMAP de UM mailbox: lê novas mensagens, ingere no intake unificado
 * (idempotente por Message-ID) e avança `last_uid`. Erros de UM mailbox não
 * derrubam os demais (vão para `errors`).
 */
export async function syncOneMailbox(
  ctx: MailSyncCtx,
  mailbox: MailboxRecord,
): Promise<{ ingested: number; duplicates: number }> {
  const { mails, lastUid } = await ctx.receiver.listNew(
    mailboxCredentials(mailbox, ctx.secretsKey),
    mailbox.lastUid,
  );
  let ingested = 0;
  let duplicates = 0;
  for (const mail of mails) {
    const outcome = await ingestOneMail(ctx, mail);
    if (outcome === "ingerida") ingested += 1;
    else duplicates += 1;
  }
  if (lastUid && lastUid !== mailbox.lastUid) {
    await ctx.store.updateMailbox(ctx.workspaceId, mailbox.id, { lastUid });
  }
  return { ingested, duplicates };
}

async function syncSingleBox(
  ctx: MailSyncCtx,
  summary: MailSyncSummary,
  mailbox: MailboxRecord | null,
): Promise<void> {
  if (!mailbox || mailbox.status !== "ativa") return;
  try {
    const result = await syncOneMailbox(ctx, mailbox);
    summary.ingested += result.ingested;
    summary.duplicates += result.duplicates;
  } catch (error) {
    summary.errors.push({ mailboxId: mailbox.id, error: (error as Error).message });
  }
}

/** Sincroniza todos os mailboxes ativos de UM workspace. */
export async function syncWorkspaceMailboxes(
  ctx: MailSyncCtx,
  mailboxId?: string | null,
): Promise<MailSyncSummary> {
  const summary: MailSyncSummary = { ingested: 0, duplicates: 0, errors: [] };
  const boxes = mailboxId
    ? [await ctx.store.findMailboxById(ctx.workspaceId, mailboxId)]
    : await ctx.store.listMailboxes(ctx.workspaceId);
  for (const mailbox of boxes) {
    await syncSingleBox(ctx, summary, mailbox);
  }
  return summary;
}

/** Varre todos os workspaces (ticker de fundo do servidor). */
export async function syncAllMailboxes(
  store: Store,
  receiver: MailReceiver,
  secretsKey: string,
  ai?: import("../ai/orchestrate.js").AiDeps,
): Promise<Record<string, MailSyncSummary>> {
  const result: Record<string, MailSyncSummary> = {};
  for (const ws of await store.listWorkspaces()) {
    result[ws.id] = await syncWorkspaceMailboxes({ store, hub: null, workspaceId: ws.id, receiver, secretsKey, ai });
  }
  return result;
}

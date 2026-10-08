import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import { encryptSecret } from "../lib/secrets.js";
import { syncWorkspaceMailboxes } from "../mail/sync.js";
import type { MailReceiver } from "../mail/transport.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { MailboxRecord, Store } from "../stores/store.js";

export interface MailRouteOptions {
  receiver: MailReceiver | null;
  secretsKey: string;
}

const mailboxSchema = z.object({
  name: z.string().min(1).max(80).default("principal"),
  fromEmail: z.string().email().max(200),
  fromName: z.string().max(160).nullish(),
  smtpHost: z.string().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().min(1).max(255),
  smtpPass: z.string().min(1).max(500),
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapUser: z.string().min(1).max(255),
  imapPass: z.string().min(1).max(500),
});

const mailboxPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  fromName: z.string().max(160).nullish(),
  status: z.enum(["ativa", "pausada"]).optional(),
  smtpHost: z.string().min(1).max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().min(1).max(255).optional(),
  smtpPass: z.string().min(1).max(500).optional(),
  imapHost: z.string().min(1).max(255).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapUser: z.string().min(1).max(255).optional(),
  imapPass: z.string().min(1).max(500).optional(),
});

const sendMailSchema = z.object({
  mailboxId: z.string().min(1),
  to: z.string().email().max(200),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(50_000),
  conversationId: z.string().min(1).nullish(),
});

const syncSchema = z.object({
  mailboxId: z.string().min(1).nullish(),
});

function redact(mailbox: MailboxRecord) {
  const { smtpPassEnc: _s, imapPassEnc: _i, ...rest } = mailbox;
  return rest;
}

async function ensureEmailChannel(
  store: Store,
  workspaceId: string,
  contactId: string,
  value: string,
): Promise<void> {
  const existing = await store.listContactChannels(workspaceId, contactId);
  if (existing.some((c) => c.channel === "email" && c.value === value)) return;
  await store.addContactChannel({ workspaceId, contactId, channel: "email", value });
}

function toCreateMailboxInput(
  body: z.infer<typeof mailboxSchema>,
  secretsKey: string,
): Omit<Parameters<Store["createMailbox"]>[0], "workspaceId"> {
  return {
    name: body.name,
    fromEmail: body.fromEmail,
    fromName: body.fromName ?? null,
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort,
    smtpUser: body.smtpUser,
    smtpPassEnc: encryptSecret(body.smtpPass, secretsKey),
    imapHost: body.imapHost,
    imapPort: body.imapPort,
    imapUser: body.imapUser,
    imapPassEnc: encryptSecret(body.imapPass, secretsKey),
  };
}

function toMailboxPatchInput(
  body: z.infer<typeof mailboxPatchSchema>,
  secretsKey: string,
): Parameters<Store["updateMailbox"]>[2] {
  return {
    name: body.name,
    fromName: body.fromName,
    status: body.status,
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort,
    smtpUser: body.smtpUser,
    smtpPassEnc: body.smtpPass ? encryptSecret(body.smtpPass, secretsKey) : undefined,
    imapHost: body.imapHost,
    imapPort: body.imapPort,
    imapUser: body.imapUser,
    imapPassEnc: body.imapPass ? encryptSecret(body.imapPass, secretsKey) : undefined,
  };
}

interface SendTarget {
  workspaceId: string;
  toValue: string;
  subject: string;
  conversationIdOpt: string | null;
}

async function resolveSendConversation(
  store: Store,
  target: SendTarget,
): Promise<string> {
  const { workspaceId, toValue, subject, conversationIdOpt } = target;
  if (conversationIdOpt) {
    const conversation = await store.findConversationById(workspaceId, conversationIdOpt);
    if (!conversation) throw HttpError.notFound("Conversa não encontrada.");
    if (conversation.channel !== "email") {
      throw HttpError.badRequest("canal_invalido", "Esta conversa não é de e-mail.");
    }
    return conversation.id;
  }
  const contact =
    (await store.findContactByChannel(workspaceId, "email", toValue)) ??
    (await store.createContact({ workspaceId, name: toValue, email: toValue }));
  await ensureEmailChannel(store, workspaceId, contact.id, toValue);
  const open = await store.findActiveConversation(workspaceId, contact.id, "email");
  const conversation =
    open ??
    (await store.createConversation({ workspaceId, contactId: contact.id, channel: "email", subject }));
  return conversation.id;
}

/**
 * Mailbox por workspace (F2b).
 * - CRUD de mailboxes (senhas cifradas, nunca expostas).
 * - `POST send`: resposta/novo e-mail → mensagem "saida" + fila com backoff.
 * - `POST sync`: polling IMAP → intake unificado (idempotente por Message-ID).
 *   Unifica no mesmo contato: o e-mail do remetente casa com `contact_channels`
 *   (canal "email") ou com o e-mail de um contato de outro canal.
 */
export async function mailRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
  options: MailRouteOptions,
): Promise<void> {
  const params = (request: { params: unknown }) =>
    request.params as { workspaceId: string; id?: string };

  app.post(
    "/workspaces/:workspaceId/mail/mailboxes",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = params(request);
      await requireWorkspace(store, request, workspaceId);
      const body = mailboxSchema.parse((await request.body) ?? {});
      const record = await store.createMailbox({
        workspaceId,
        ...toCreateMailboxInput(body, options.secretsKey),
      });
      return reply.code(201).send(redact(record));
    },
  );

  app.get(
    "/workspaces/:workspaceId/mail/mailboxes",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = params(request);
      await requireWorkspace(store, request, workspaceId);
      const boxes = await store.listMailboxes(workspaceId);
      return { data: boxes.map(redact) };
    },
  );

  app.patch(
    "/workspaces/:workspaceId/mail/mailboxes/:id",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = params(request);
      await requireWorkspace(store, request, workspaceId);
      const body = mailboxPatchSchema.parse((await request.body) ?? {});
      const updated = await store.updateMailbox(workspaceId, id as string, {
        ...toMailboxPatchInput(body, options.secretsKey),
      });
      if (!updated) throw HttpError.notFound("Mailbox não encontrada.");
      return redact(updated);
    },
  );

  app.delete(
    "/workspaces/:workspaceId/mail/mailboxes/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = params(request);
      await requireWorkspace(store, request, workspaceId);
      const ok = await store.deleteMailbox(workspaceId, id as string);
      if (!ok) throw HttpError.notFound("Mailbox não encontrada.");
      return reply.code(204).send();
    },
  );

  app.post(
    "/workspaces/:workspaceId/mail/send",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = params(request);
      await requireWorkspace(store, request, workspaceId);
      const body = sendMailSchema.parse((await request.body) ?? {});
      const mailbox = await store.findMailboxById(workspaceId, body.mailboxId);
      if (!mailbox) throw HttpError.notFound("Mailbox não encontrada.");
      if (mailbox.status !== "ativa") {
        throw HttpError.badRequest("mailbox_inativa", "Mailbox pausada.");
      }
      const toValue = body.to.trim().toLowerCase();
      const conversationId = await resolveSendConversation(store, {
        workspaceId,
        toValue,
        subject: body.subject,
        conversationIdOpt: body.conversationId ?? null,
      });
      const message = await store.addMessage({
        workspaceId,
        conversationId,
        direction: "saida",
        authorId: request.authUser.id,
        kind: "texto",
        text: body.text,
      });
      const queued = await store.enqueueOutbound({
        workspaceId,
        channel: "email",
        conversationId,
        messageId: message.id,
        mailboxId: mailbox.id,
        toValue,
        subject: body.subject,
        text: body.text,
      });
      const conversation = await store.findConversationById(workspaceId, conversationId);
      hub.publish(workspaceId, { kind: "mensagem.criada", data: message });
      if (conversation) {
        hub.publish(workspaceId, { kind: "conversa.atualizada", data: conversation });
      }
      return reply.code(201).send({ message, queued });
    },
  );

  app.post(
    "/workspaces/:workspaceId/mail/sync",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = params(request);
      await requireWorkspace(store, request, workspaceId);
      if (!options.receiver) {
        throw HttpError.badGateway(
          "imap_indisponivel",
          "Recebimento IMAP não configurado neste ambiente.",
        );
      }
      const body = syncSchema.parse((await request.body) ?? {});
      if (body.mailboxId) {
        const mailbox = await store.findMailboxById(workspaceId, body.mailboxId);
        if (!mailbox) throw HttpError.notFound("Mailbox não encontrada.");
      }
      const summary = await syncWorkspaceMailboxes(
        {
          store,
          hub,
          workspaceId,
          receiver: options.receiver,
          secretsKey: options.secretsKey,
        },
        body.mailboxId ?? null,
      );
      return { ok: true, ...summary };
    },
  );
}

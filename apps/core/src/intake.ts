import type { Store } from "./stores/store.js";
import type {
  ContactRecord,
  ConversationRecord,
  MessageRecord,
} from "./stores/store.js";

/**
 * Normalização idempotente do intake (widget, WhatsApp/WAHA, futuros canais).
 * Toda mensagem de fora vira: contato unificado + canal + conversa aberta +
 * mensagem "entrada". O par (source, externalId) é único por workspace:
 * reenvios (retry do webhook, duplo clique do widget) saem como duplicata,
 * sem mensagem a mais.
 */
export interface IntakeInput {
  workspaceId: string;
  /** Canal da conversa/contato ("widget", "whatsapp", ...). */
  channel: string;
  /** Proveniência do dedup: "widget" | "waha" | ... */
  source: string;
  /** Id externo para idempotência (message id do WAHA, client id do widget). */
  externalId?: string | null;
  contactName?: string | null;
  /** Valor do canal desta mensagem (phone whatsapp, e-mail ou visitor id). */
  contactValue: string;
  /** Identificadores alternativos usados para unificar contatos. */
  phone?: string | null;
  email?: string | null;
  text?: string | null;
  mediaUrl?: string | null;
}

export type IntakeResult =
  | {
      duplicate: false;
      contact: ContactRecord;
      conversation: ConversationRecord;
      message: MessageRecord;
    }
  | { duplicate: true };

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

async function claimFreshEvent(
  store: Store,
  input: IntakeInput,
  externalId: string,
): Promise<boolean> {
  return store.claimIntakeEvent({
    workspaceId: input.workspaceId,
    source: input.source,
    externalId,
  });
}

async function findByAlternateValue(
  store: Store,
  workspaceId: string,
  raw: string | null | undefined,
  value: string,
): Promise<ContactRecord | null> {
  if (!raw) return null;
  const normalized = normalizeValue(raw);
  if (normalized === value) return null;
  return store.findContactByAnyChannelValue(workspaceId, normalized);
}

async function resolveContact(
  store: Store,
  input: IntakeInput,
  value: string,
): Promise<ContactRecord> {
  const direct =
    (await store.findContactByChannel(input.workspaceId, input.channel, value)) ??
    (await store.findContactByAnyChannelValue(input.workspaceId, value));
  if (direct) return direct;
  const byPhone = await findByAlternateValue(store, input.workspaceId, input.phone, value);
  if (byPhone) return byPhone;
  const byEmail = await findByAlternateValue(store, input.workspaceId, input.email, value);
  if (byEmail) return byEmail;
  return store.createContact({
    workspaceId: input.workspaceId,
    name: input.contactName?.trim() || value,
    phone: input.phone ?? (input.channel === "whatsapp" ? value : null),
    email: input.email ?? null,
  });
}

async function ensureContactChannel(
  store: Store,
  input: IntakeInput,
  contactId: string,
  value: string,
): Promise<void> {
  const existing = await store.listContactChannels(input.workspaceId, contactId);
  if (existing.some((c) => c.channel === input.channel && c.value === value)) return;
  await store.addContactChannel({
    workspaceId: input.workspaceId,
    contactId,
    channel: input.channel,
    value,
  });
}

async function openConversation(
  store: Store,
  input: IntakeInput,
  contactId: string,
): Promise<ConversationRecord> {
  return (
    (await store.findActiveConversation(input.workspaceId, contactId, input.channel)) ??
    (await store.createConversation({
      workspaceId: input.workspaceId,
      contactId,
      channel: input.channel,
      subject: input.contactName ?? null,
    }))
  );
}

async function appendIntakeMessage(
  store: Store,
  input: IntakeInput,
  conversationId: string,
): Promise<MessageRecord> {
  const message = await store.addMessage({
    workspaceId: input.workspaceId,
    conversationId,
    direction: "entrada",
    authorId: null,
    kind: input.mediaUrl ? "midia" : "texto",
    text: input.text ?? null,
    mediaUrl: input.mediaUrl ?? null,
  });
  const externalId = input.externalId?.trim() || null;
  if (externalId) {
    await store.linkIntakeEvent({
      workspaceId: input.workspaceId,
      source: input.source,
      externalId,
      conversationId,
      messageId: message.id,
    });
  }
  return message;
}

export async function ingestIncoming(
  store: Store,
  input: IntakeInput,
): Promise<IntakeResult> {
  const externalId = input.externalId?.trim() || null;

  // 1) idempotência ANTES de escrever qualquer mensagem
  if (externalId && !(await claimFreshEvent(store, input, externalId))) {
    return { duplicate: true };
  }

  // 2) contato: canal desta mensagem → qualquer canal com mesmo valor
  const value = normalizeValue(input.contactValue);
  const contact = await resolveContact(store, input, value);
  await ensureContactChannel(store, input, contact.id, value);

  // 3) conversa aberta do mesmo canal, ou nova
  const conversation = await openConversation(store, input, contact.id);

  // 4) mensagem de entrada
  const message = await appendIntakeMessage(store, input, conversation.id);

  return { duplicate: false, contact, conversation, message };
}

import type { Store } from "../stores/store.js";
import { generateApiKey } from "../lib/apiKeys.js";

/**
 * Resolve (ou cria) a fila pelo nome — assim o agente externo não precisa
 * conhecer ids internos para montar um fluxo do zero.
 */
export async function resolveQueueId(
  store: Store,
  workspaceId: string,
  queueName: string | null,
): Promise<string | null> {
  if (!queueName) return null;
  const queues = await store.listQueues(workspaceId);
  const found = queues.find((q) => q.name.toLowerCase() === queueName.trim().toLowerCase());
  if (found) return found.id;
  const created = await store.createQueue({ workspaceId, name: queueName });
  return created.id;
}

/** Cria a chave de API e devolve o segredo UMA única vez. */
export async function createKeyRecord(
  store: Store,
  workspaceId: string,
  name: string,
  scopes: string[],
  createdBy: string | null = null,
): Promise<Record<string, unknown>> {
  const generated = generateApiKey();
  const record = await store.createApiKey({
    workspaceId,
    name,
    prefix: generated.prefix,
    keyHash: generated.keyHash,
    scopes: scopes as never,
    createdBy,
  });
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    key: generated.key,
    aviso: "Guarde a chave agora: só o hash fica no servidor.",
  };
}

export interface ContactExport {
  contact: unknown;
  channels: unknown[];
  timeline: unknown[];
  consents: unknown[];
  conversations: unknown[];
}

/** Portabilidade LGPD (art. 18, V): tudo que o CRM guardou sobre o titular. */
export async function exportContact(
  store: Store,
  workspaceId: string,
  contactId: string,
): Promise<ContactExport> {
  const contact = await store.findContactById(workspaceId, contactId);
  if (!contact) throw new Error("Contato não encontrado neste workspace.");
  const conversations = await store.listConversations(workspaceId);
  const own = conversations.filter((c) => c.contactId === contactId);
  const withContent = await Promise.all(
    own.map(async (c) => ({
      ...c,
      messages: await store.listMessages(workspaceId, c.id),
      notes: await store.listNotes(workspaceId, c.id),
      avaliacao: await store.findRating(workspaceId, c.id),
    })),
  );
  const [channels, timeline, consents] = await Promise.all([
    store.listContactChannels(workspaceId, contactId),
    store.contactTimeline(workspaceId, contactId),
    store.listConsents(workspaceId, { contactId }),
  ]);
  return { contact, channels, timeline, consents, conversations: withContent };
}
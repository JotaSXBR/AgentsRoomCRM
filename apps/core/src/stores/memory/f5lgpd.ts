import { randomUUID } from "node:crypto";
import type {
  ContactConsentRecord,
  ConversationRatingRecord,
  LgpdRequestRecord,
} from "../types/f5.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

/** Estado usado por CSAT e LGPD (F5), incluindo o conteúdo pessoal. */
export type F5LgpdState = Pick<
  MemoryState,
  | "ratings"
  | "consents"
  | "lgpdRequests"
  | "contacts"
  | "contactChannels"
  | "contactEvents"
  | "conversations"
  | "conversationTags"
  | "messages"
  | "notes"
  | "tickets"
  | "botSessions"
>;

export function createF5LgpdMaps(): Pick<
  F5LgpdState,
  "ratings" | "consents" | "lgpdRequests"
> {
  return { ratings: new Map(), consents: new Map(), lgpdRequests: new Map() };
}

const COUNTERS = [
  "conversas_removidas",
  "mensagens_removidas",
  "notas_removidas",
  "tickets_removidos",
  "avaliacoes_removidas",
  "canais_removidos",
  "eventos_removidos",
] as const;

function emptyCounters(): Record<string, number> {
  return Object.fromEntries(COUNTERS.map((key) => [key, 0]));
}

// --------------------------------------------------------------- CSAT ---

export async function rateConversation(
  state: F5LgpdState,
  input: {
    workspaceId: string;
    conversationId: string;
    score: number;
    comment?: string | null;
    source?: ConversationRatingRecord["source"];
    ratedBy?: string | null;
  },
): Promise<ConversationRatingRecord> {
  const conversation = state.conversations.get(input.conversationId);
  if (!conversation || conversation.workspaceId !== input.workspaceId) {
    throw new Error("conversa_invalida");
  }
  const record: ConversationRatingRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    score: input.score,
    comment: input.comment ?? null,
    source: input.source ?? "atendente",
    ratedBy: input.ratedBy ?? null,
    createdAt: now(),
  };
  // Uma nota por conversa: repetir sobrescreve (mesma chave da UNIQUE do Postgres).
  state.ratings.set(conversation.id, record);
  return record;
}

export async function findRating(
  state: F5LgpdState,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationRatingRecord | null> {
  const rating = state.ratings.get(conversationId);
  return rating && rating.workspaceId === workspaceId ? rating : null;
}

export async function listRatings(
  state: F5LgpdState,
  workspaceId: string,
  options?: { conversationIds?: string[] },
): Promise<ConversationRatingRecord[]> {
  const filter = options?.conversationIds ? new Set(options.conversationIds) : null;
  return [...state.ratings.values()].filter(
    (r) => r.workspaceId === workspaceId && (!filter || filter.has(r.conversationId)),
  );
}

// --------------------------------------------------- consentimento (LGPD) ---

function consentKey(contactId: string, kind: string): string {
  return `${contactId}:${kind}`;
}

/** Grava/revoga o consentimento por finalidade, carimbando granted/revoked_at. */
export async function setConsent(
  state: F5LgpdState,
  input: {
    workspaceId: string;
    contactId: string;
    kind: ContactConsentRecord["kind"];
    granted: boolean;
    source?: string;
    note?: string | null;
  },
): Promise<ContactConsentRecord> {
  const contact = state.contacts.get(input.contactId);
  if (!contact || contact.workspaceId !== input.workspaceId) throw new Error("contato_invalido");
  const key = consentKey(input.contactId, input.kind);
  const current = state.consents.get(key);
  const timestamp = now();
  const record: ContactConsentRecord = {
    id: current?.id ?? randomUUID(),
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    kind: input.kind,
    granted: input.granted,
    source: input.source ?? current?.source ?? "manual",
    note: input.note ?? current?.note ?? null,
    grantedAt: input.granted ? timestamp : (current?.grantedAt ?? null),
    revokedAt: input.granted ? null : timestamp,
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  state.consents.set(key, record);
  return record;
}

export async function listConsents(
  state: F5LgpdState,
  workspaceId: string,
  filter?: { contactId?: string; kind?: ContactConsentRecord["kind"] },
): Promise<ContactConsentRecord[]> {
  return [...state.consents.values()].filter(
    (c) =>
      c.workspaceId === workspaceId &&
      (!filter?.contactId || c.contactId === filter.contactId) &&
      (!filter?.kind || c.kind === filter.kind),
  );
}

// ------------------------------------------------ trilha de auditoria ---

export async function addLgpdRequest(
  state: F5LgpdState,
  input: {
    workspaceId: string;
    contactId?: string | null;
    scope: LgpdRequestRecord["scope"];
    action: LgpdRequestRecord["action"];
    status?: LgpdRequestRecord["status"];
    summary: Record<string, unknown>;
    requestedBy?: string | null;
  },
): Promise<LgpdRequestRecord> {
  const record: LgpdRequestRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    contactId: input.contactId ?? null,
    scope: input.scope,
    action: input.action,
    status: input.status ?? "concluido",
    summary: input.summary,
    requestedBy: input.requestedBy ?? null,
    createdAt: now(),
  };
  state.lgpdRequests.set(record.id, record);
  return record;
}

export async function listLgpdRequests(
  state: F5LgpdState,
  workspaceId: string,
): Promise<LgpdRequestRecord[]> {
  return [...state.lgpdRequests.values()]
    .filter((r) => r.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ------------------------------------------------------- eliminação (art. 18 VI) ---

/** Apaga todo o conteúdo pessoal das conversas de um contato. */
function purgeConversations(
  state: F5LgpdState,
  workspaceId: string,
  contactId: string,
  counters: Record<string, number>,
): void {
  const conversationIds = new Set(
    [...state.conversations.values()]
      .filter((c) => c.workspaceId === workspaceId && c.contactId === contactId)
      .map((c) => c.id),
  );
  counters.conversas_removidas += conversationIds.size;
  counters.mensagens_removidas += deleteBy(state.messages, (m) =>
    conversationIds.has(m.conversationId),
  );
  counters.notas_removidas += deleteBy(state.notes, (n) =>
    conversationIds.has(n.conversationId),
  );
  counters.tickets_removidos += deleteBy(state.tickets, (t) =>
    conversationIds.has(t.conversationId),
  );
  counters.avaliacoes_removidas += deleteBy(state.ratings, (r) =>
    conversationIds.has(r.conversationId),
  );
  deleteBy(state.conversationTags, (t) => conversationIds.has(t.conversationId));
  deleteBy(state.botSessions, (_session, key) => conversationIds.has(key));
  deleteBy(state.conversations, (c) => conversationIds.has(c.id));
  deleteBy(state.consents, (c) => c.contactId === contactId);
}

function deleteBy<T>(
  map: Map<string, T>,
  match: (value: T, key: string) => boolean,
): number {
  let removed = 0;
  for (const [key, value] of [...map]) {
    if (match(value, key)) {
      map.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Eliminação de um titular: apaga conteúdo, canais, eventos e consentimentos,
 * e anonimiza o cadastro (nome fixo, telefone/e-mail nulos). A linha do contato
 * sobrevive para preservar a contagem histórica e a trilha de auditoria.
 */
export async function purgeContactData(
  state: F5LgpdState,
  workspaceId: string,
  contactId: string,
): Promise<Record<string, number>> {
  const contact = state.contacts.get(contactId);
  if (!contact || contact.workspaceId !== workspaceId) throw new Error("contato_invalido");
  const counters = emptyCounters();
  purgeConversations(state, workspaceId, contactId, counters);
  counters.canais_removidos += deleteBy(state.contactChannels, (ch) => ch.contactId === contactId);
  counters.eventos_removidos += deleteBy(state.contactEvents, (ev) => ev.contactId === contactId);
  state.contacts.set(contactId, {
    ...contact,
    name: "Contato eliminado (LGPD)",
    phone: null,
    email: null,
  });
  return counters;
}

/** Eliminação em massa: todos os contatos do workspace. */
export async function purgeWorkspaceContacts(
  state: F5LgpdState,
  workspaceId: string,
): Promise<Record<string, number>> {
  const contactIds = [...state.contacts.values()]
    .filter((c) => c.workspaceId === workspaceId)
    .map((c) => c.id);
  const totals: Record<string, number> = { contatos_anonimizados: contactIds.length };
  for (const id of contactIds) {
    const counters = await purgeContactData(state, workspaceId, id);
    for (const [key, value] of Object.entries(counters)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}
import { randomUUID } from "node:crypto";
import type {
  ConversationRecord,
  ConversationStatus,
  MessageRecord,
  NoteRecord,
  TagRecord,
  WorkspaceUpdates,
} from "../types/inbox.js";
import { membershipKey } from "./identity.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type InboxState = Pick<
  MemoryState,
  | "contacts"
  | "tags"
  | "conversationTags"
  | "conversations"
  | "messages"
  | "notes"
  | "memberships"
>;

export async function createTag(
  state: InboxState,
  input: {
    workspaceId: string;
    name: string;
    color?: string | null;
  },
): Promise<TagRecord> {
  const tag: TagRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    color: input.color ?? null,
    createdAt: now(),
  };
  state.tags.set(tag.id, tag);
  return tag;
}

export async function listTags(
  state: InboxState,
  workspaceId: string,
): Promise<TagRecord[]> {
  return [...state.tags.values()].filter((t) => t.workspaceId === workspaceId);
}

export async function tagConversation(
  state: InboxState,
  workspaceId: string,
  conversationId: string,
  tagId: string,
): Promise<void> {
  const conv = state.conversations.get(conversationId);
  const tag = state.tags.get(tagId);
  if (!conv || conv.workspaceId !== workspaceId || !tag || tag.workspaceId !== workspaceId) {
    throw new Error("tag_invalida");
  }
  state.conversationTags.set(`${conversationId}:${tagId}`, { conversationId, tagId });
}

export async function untagConversation(
  state: InboxState,
  workspaceId: string,
  conversationId: string,
  tagId: string,
): Promise<void> {
  state.conversationTags.delete(`${conversationId}:${tagId}`);
}

export async function listConversationTags(
  state: InboxState,
  workspaceId: string,
  conversationId: string,
): Promise<TagRecord[]> {
  const out: TagRecord[] = [];
  for (const link of state.conversationTags.values()) {
    if (link.conversationId !== conversationId) continue;
    const tag = state.tags.get(link.tagId);
    if (tag && tag.workspaceId === workspaceId) out.push(tag);
  }
  return out;
}

export async function createConversation(
  state: InboxState,
  input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    subject?: string | null;
  },
): Promise<ConversationRecord> {
  const contact = state.contacts.get(input.contactId);
  if (!contact || contact.workspaceId !== input.workspaceId) {
    throw new Error("contato_invalido");
  }
  const conv: ConversationRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    channel: input.channel,
    status: "aberto",
    assigneeId: null,
    subject: input.subject ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
  state.conversations.set(conv.id, conv);
  return conv;
}

export async function findConversationById(
  state: InboxState,
  workspaceId: string,
  id: string,
): Promise<ConversationRecord | null> {
  const c = state.conversations.get(id);
  return c && c.workspaceId === workspaceId ? c : null;
}

function matchesFacets(
  c: ConversationRecord,
  filter: { status?: ConversationStatus; assigneeId?: string; tagId?: string } | undefined,
  taggedIds: Set<string>,
): boolean {
  if (filter?.status && c.status !== filter.status) return false;
  if (filter?.assigneeId && c.assigneeId !== filter.assigneeId) return false;
  if (filter?.tagId && !taggedIds.has(c.id)) return false;
  return true;
}

function matchesQuery(state: InboxState, c: ConversationRecord, q: string | undefined): boolean {
  if (!q) return true;
  const contact = state.contacts.get(c.contactId);
  const hay = `${c.subject ?? ""} ${contact?.name ?? ""}`.toLowerCase();
  return hay.includes(q);
}

export async function listConversations(
  state: InboxState,
  workspaceId: string,
  filter?: {
    status?: ConversationStatus;
    assigneeId?: string;
    tagId?: string;
    q?: string;
  },
): Promise<ConversationRecord[]> {
  const q = filter?.q?.trim().toLowerCase();
  const taggedIds = new Set<string>();
  if (filter?.tagId) {
    for (const link of state.conversationTags.values()) {
      if (link.tagId === filter.tagId) taggedIds.add(link.conversationId);
    }
  }
  return [...state.conversations.values()]
    .filter((c) => {
      if (c.workspaceId !== workspaceId) return false;
      if (!matchesFacets(c, filter, taggedIds)) return false;
      return matchesQuery(state, c, q);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function setConversationStatus(
  state: InboxState,
  workspaceId: string,
  id: string,
  status: ConversationStatus,
): Promise<ConversationRecord | null> {
  const conv = state.conversations.get(id);
  if (!conv || conv.workspaceId !== workspaceId) return null;
  const updated = { ...conv, status, updatedAt: now() };
  state.conversations.set(id, updated);
  return updated;
}

export async function assignConversation(
  state: InboxState,
  workspaceId: string,
  id: string,
  assigneeId: string | null,
): Promise<ConversationRecord | null> {
  const conv = state.conversations.get(id);
  if (!conv || conv.workspaceId !== workspaceId) return null;
  if (assigneeId !== null) {
    const membership = state.memberships.get(membershipKey(workspaceId, assigneeId)) ?? null;
    if (!membership) throw new Error("assignee_invalido");
  }
  const updated = { ...conv, assigneeId, updatedAt: now() };
  state.conversations.set(id, updated);
  return updated;
}

export async function addMessage(
  state: InboxState,
  input: {
    workspaceId: string;
    conversationId: string;
    direction: MessageRecord["direction"];
    authorId?: string | null;
    kind?: MessageRecord["kind"];
    text?: string | null;
    mediaUrl?: string | null;
  },
): Promise<MessageRecord> {
  const conv = state.conversations.get(input.conversationId);
  if (!conv || conv.workspaceId !== input.workspaceId) {
    throw new Error("conversa_invalida");
  }
  const msg: MessageRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: input.direction,
    authorId: input.authorId ?? null,
    kind: input.kind ?? "texto",
    text: input.text ?? null,
    mediaUrl: input.mediaUrl ?? null,
    createdAt: now(),
  };
  state.messages.set(msg.id, msg);
  state.conversations.set(conv.id, { ...conv, updatedAt: now() });
  return msg;
}

export async function listMessages(
  state: InboxState,
  workspaceId: string,
  conversationId: string,
  options?: { since?: string },
): Promise<MessageRecord[]> {
  return [...state.messages.values()]
    .filter(
      (m) =>
        m.workspaceId === workspaceId &&
        m.conversationId === conversationId &&
        (!options?.since || m.createdAt > options.since),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addNote(
  state: InboxState,
  input: {
    workspaceId: string;
    conversationId: string;
    authorId: string;
    content: string;
  },
): Promise<NoteRecord> {
  const conv = state.conversations.get(input.conversationId);
  if (!conv || conv.workspaceId !== input.workspaceId) {
    throw new Error("conversa_invalida");
  }
  const note: NoteRecord = { id: randomUUID(), ...input, createdAt: now() };
  state.notes.set(note.id, note);
  return note;
}

export async function listNotes(
  state: InboxState,
  workspaceId: string,
  conversationId: string,
): Promise<NoteRecord[]> {
  return [...state.notes.values()]
    .filter((n) => n.workspaceId === workspaceId && n.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listUpdates(
  state: InboxState,
  workspaceId: string,
  since: string,
): Promise<WorkspaceUpdates> {
  const conversations = [...state.conversations.values()].filter(
    (c) => c.workspaceId === workspaceId && c.updatedAt > since,
  );
  const messages = [...state.messages.values()].filter(
    (m) => m.workspaceId === workspaceId && m.createdAt > since,
  );
  const notes = [...state.notes.values()].filter(
    (n) => n.workspaceId === workspaceId && n.createdAt > since,
  );
  return { conversations, messages, notes };
}

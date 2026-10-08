import { randomUUID } from "node:crypto";
import type {
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
} from "../types/contacts.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type ContactsState = Pick<
  MemoryState,
  "contacts" | "contactChannels" | "contactEvents" | "conversations"
>;

export async function createContact(
  state: ContactsState,
  input: {
    workspaceId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  },
): Promise<ContactRecord> {
  const contact: ContactRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    mergedIntoId: null,
    createdAt: now(),
  };
  state.contacts.set(contact.id, contact);
  return contact;
}

export async function listContacts(
  state: ContactsState,
  workspaceId: string,
  query?: { q?: string },
): Promise<ContactRecord[]> {
  const q = query?.q?.trim().toLowerCase();
  return [...state.contacts.values()].filter((c) => {
    if (c.workspaceId !== workspaceId || c.mergedIntoId !== null) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });
}

export async function findContactById(
  state: ContactsState,
  workspaceId: string,
  id: string,
): Promise<ContactRecord | null> {
  const c = state.contacts.get(id);
  return c && c.workspaceId === workspaceId ? c : null;
}

export async function addContactChannel(
  state: ContactsState,
  input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    value: string;
  },
): Promise<ContactChannelRecord> {
  const record: ContactChannelRecord = {
    id: randomUUID(),
    ...input,
    createdAt: now(),
  };
  state.contactChannels.set(record.id, record);
  return record;
}

export async function listContactChannels(
  state: ContactsState,
  workspaceId: string,
  contactId: string,
): Promise<ContactChannelRecord[]> {
  return [...state.contactChannels.values()].filter(
    (c) => c.workspaceId === workspaceId && c.contactId === contactId,
  );
}

function assertMergeable(
  state: ContactsState,
  workspaceId: string,
  sourceId: string,
  targetId: string,
): { source: ContactRecord; target: ContactRecord } {
  const source = state.contacts.get(sourceId);
  const target = state.contacts.get(targetId);
  if (
    !source ||
    !target ||
    source.workspaceId !== workspaceId ||
    target.workspaceId !== workspaceId ||
    source.id === target.id
  ) {
    throw new Error("merge_invalido");
  }
  return { source, target };
}

function reassignMergeRefs(
  state: ContactsState,
  workspaceId: string,
  sourceId: string,
  targetId: string,
): void {
  for (const ch of state.contactChannels.values()) {
    if (ch.workspaceId === workspaceId && ch.contactId === sourceId) {
      state.contactChannels.set(ch.id, { ...ch, contactId: targetId });
    }
  }
  for (const conv of state.conversations.values()) {
    if (conv.workspaceId === workspaceId && conv.contactId === sourceId) {
      state.conversations.set(conv.id, { ...conv, contactId: targetId, updatedAt: now() });
    }
  }
  for (const ev of state.contactEvents.values()) {
    if (ev.workspaceId === workspaceId && ev.contactId === sourceId) {
      state.contactEvents.set(ev.id, { ...ev, contactId: targetId });
    }
  }
}

export async function mergeContacts(
  state: ContactsState,
  workspaceId: string,
  sourceId: string,
  targetId: string,
): Promise<ContactRecord> {
  const { source, target } = assertMergeable(state, workspaceId, sourceId, targetId);
  reassignMergeRefs(state, workspaceId, sourceId, targetId);
  state.contacts.set(sourceId, { ...source, mergedIntoId: targetId });
  await addContactEvent(state, {
    workspaceId,
    contactId: targetId,
    kind: "merge",
    description: `Contato ${source.name} unificado em ${target.name}.`,
  });
  return target;
}

export async function contactTimeline(
  state: ContactsState,
  workspaceId: string,
  contactId: string,
): Promise<ContactEventRecord[]> {
  return [...state.contactEvents.values()]
    .filter((e) => e.workspaceId === workspaceId && e.contactId === contactId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addContactEvent(
  state: ContactsState,
  input: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    kind: string;
    actorId?: string | null;
    description: string;
  },
): Promise<ContactEventRecord> {
  const record: ContactEventRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    conversationId: input.conversationId ?? null,
    kind: input.kind,
    actorId: input.actorId ?? null,
    description: input.description,
    createdAt: now(),
  };
  state.contactEvents.set(record.id, record);
  return record;
}

import type { ContactRecord } from "../types/contacts.js";
import type { ConversationRecord } from "../types/inbox.js";
import type { MemoryState } from "./shared.js";

export type IntakeState = Pick<
  MemoryState,
  "intakeEvents" | "contactChannels" | "contacts" | "conversations"
>;

export async function claimIntakeEvent(
  state: IntakeState,
  input: {
    workspaceId: string;
    source: string;
    externalId: string;
  },
): Promise<boolean> {
  const key = `${input.workspaceId}:${input.source}:${input.externalId}`;
  if (state.intakeEvents.has(key)) return false;
  state.intakeEvents.set(key, {
    workspaceId: input.workspaceId,
    source: input.source,
    externalId: input.externalId,
    conversationId: null,
    messageId: null,
  });
  return true;
}

export async function linkIntakeEvent(
  state: IntakeState,
  input: {
    workspaceId: string;
    source: string;
    externalId: string;
    conversationId: string;
    messageId: string;
  },
): Promise<void> {
  const key = `${input.workspaceId}:${input.source}:${input.externalId}`;
  const event = state.intakeEvents.get(key);
  if (event) {
    state.intakeEvents.set(key, {
      ...event,
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
  }
}

export async function findContactByChannel(
  state: IntakeState,
  workspaceId: string,
  channel: string,
  value: string,
): Promise<ContactRecord | null> {
  for (const ch of state.contactChannels.values()) {
    if (ch.workspaceId !== workspaceId || ch.channel !== channel || ch.value !== value) {
      continue;
    }
    const contact = state.contacts.get(ch.contactId);
    if (contact && contact.workspaceId === workspaceId && !contact.mergedIntoId) {
      return contact;
    }
  }
  return null;
}

export async function findContactByAnyChannelValue(
  state: IntakeState,
  workspaceId: string,
  value: string,
): Promise<ContactRecord | null> {
  for (const ch of state.contactChannels.values()) {
    if (ch.workspaceId !== workspaceId || ch.value !== value) continue;
    const contact = state.contacts.get(ch.contactId);
    if (contact && contact.workspaceId === workspaceId && !contact.mergedIntoId) {
      return contact;
    }
  }
  return null;
}

export async function findActiveConversation(
  state: IntakeState,
  workspaceId: string,
  contactId: string,
  channel: string,
): Promise<ConversationRecord | null> {
  const candidates = [...state.conversations.values()]
    .filter(
      (c) =>
        c.workspaceId === workspaceId &&
        c.contactId === contactId &&
        c.channel === channel &&
        c.status !== "resolvido",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return candidates[0] ?? null;
}

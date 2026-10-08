import type { ContactRecord } from "./contacts.js";
import type { ConversationRecord } from "./inbox.js";

export interface IntakeStore {
  // intake idempotente
  claimIntakeEvent(input: {
    workspaceId: string;
    source: string;
    externalId: string;
  }): Promise<boolean>;
  linkIntakeEvent(input: {
    workspaceId: string;
    source: string;
    externalId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void>;

  // matching de contato/conversa para o intake unificado
  findContactByChannel(
    workspaceId: string,
    channel: string,
    value: string,
  ): Promise<ContactRecord | null>;
  findContactByAnyChannelValue(
    workspaceId: string,
    value: string,
  ): Promise<ContactRecord | null>;
  findActiveConversation(
    workspaceId: string,
    contactId: string,
    channel: string,
  ): Promise<ConversationRecord | null>;
}

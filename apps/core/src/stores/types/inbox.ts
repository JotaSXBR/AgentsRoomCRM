export type ConversationStatus = "aberto" | "pendente" | "resolvido";

export interface ConversationRecord {
  id: string;
  workspaceId: string;
  contactId: string;
  channel: string;
  status: ConversationStatus;
  assigneeId: string | null;
  subject: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTagRecord {
  conversationId: string;
  tagId: string;
}

export interface TagRecord {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface MessageRecord {
  id: string;
  workspaceId: string;
  conversationId: string;
  direction: "entrada" | "saida";
  authorId: string | null;
  kind: "texto" | "midia" | "sistema";
  text: string | null;
  mediaUrl: string | null;
  createdAt: string;
}

export interface NoteRecord {
  id: string;
  workspaceId: string;
  conversationId: string;
  authorId: string;
  content: string;
  createdAt: string;
}

/** Lanche de atualizações para polling fallback. */
export interface WorkspaceUpdates {
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  notes: NoteRecord[];
}

export interface TagsStore {
  // tags
  createTag(input: {
    workspaceId: string;
    name: string;
    color?: string | null;
  }): Promise<TagRecord>;
  listTags(workspaceId: string): Promise<TagRecord[]>;
  tagConversation(workspaceId: string, conversationId: string, tagId: string): Promise<void>;
  untagConversation(workspaceId: string, conversationId: string, tagId: string): Promise<void>;
  listConversationTags(workspaceId: string, conversationId: string): Promise<TagRecord[]>;
}

export interface InboxStore {
  // inbox (conversas, mensagens, notas)
  createConversation(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    subject?: string | null;
  }): Promise<ConversationRecord>;
  findConversationById(workspaceId: string, id: string): Promise<ConversationRecord | null>;
  listConversations(
    workspaceId: string,
    filter?: { status?: ConversationStatus; assigneeId?: string; tagId?: string; q?: string },
  ): Promise<ConversationRecord[]>;
  setConversationStatus(
    workspaceId: string,
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationRecord | null>;
  assignConversation(
    workspaceId: string,
    id: string,
    assigneeId: string | null,
  ): Promise<ConversationRecord | null>;
  addMessage(input: {
    workspaceId: string;
    conversationId: string;
    direction: MessageRecord["direction"];
    authorId?: string | null;
    kind?: MessageRecord["kind"];
    text?: string | null;
    mediaUrl?: string | null;
  }): Promise<MessageRecord>;
  listMessages(
    workspaceId: string,
    conversationId: string,
    options?: { since?: string },
  ): Promise<MessageRecord[]>;
  addNote(input: {
    workspaceId: string;
    conversationId: string;
    authorId: string;
    content: string;
  }): Promise<NoteRecord>;
  listNotes(workspaceId: string, conversationId: string): Promise<NoteRecord[]>;

  /** Polling fallback: tudo atualizado depois de `since` (ISO). */
  listUpdates(workspaceId: string, since: string): Promise<WorkspaceUpdates>;
}

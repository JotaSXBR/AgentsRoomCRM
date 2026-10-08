import type {
  WorkspaceMemberRole,
  WorkspaceRole,
} from "@agentsroom/shared";

/** Usuário autenticado anexado ao request pelo plugin de auth. */
export interface AuthUser {
  id: string;
  email: string;
  isOwnerGlobal: boolean;
}

export interface UserRecord extends AuthUser {
  passwordHash: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface MembershipRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceMemberRole;
  createdAt: string;
}

export interface MemberWithUser extends MembershipRecord {
  email: string;
  name: string;
}

export interface InviteRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceMemberRole;
  tokenHash: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ContactRecord {
  id: string;
  workspaceId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Contato absorvido por um merge aponta para o sobrevivente. */
  mergedIntoId: string | null;
  createdAt: string;
}

/** Canal do contato unificado (multicanal: whatsapp, e-mail, ...). */
export interface ContactChannelRecord {
  id: string;
  workspaceId: string;
  contactId: string;
  channel: string;
  value: string;
  createdAt: string;
}

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

/** Evento da timeline do contato (merge, notas de canal, etc.). */
export interface ContactEventRecord {
  id: string;
  workspaceId: string;
  contactId: string;
  conversationId: string | null;
  kind: string;
  actorId: string | null;
  description: string;
  createdAt: string;
}

export interface WidgetTokenRecord {
  id: string;
  workspaceId: string;
  name: string;
  tokenHash: string;
  revokedAt: string | null;
  createdAt: string;
}

/** Conexão Meta oficial por workspace (1 Página + IG vinculado). */
export interface MetaConnectionRecord {
  id: string;
  workspaceId: string;
  pageId: string;
  pageName: string | null;
  igUserId: string | null;
  /** Token da Página CIFRADO (AES-256-GCM) — nunca sai do workspace. */
  accessTokenEnc: string;
  tokenExpiresAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Mailbox por workspace: SMTP (envio) + IMAP (recebimento). */
export interface MailboxRecord {
  id: string;
  workspaceId: string;
  name: string;
  fromEmail: string;
  fromName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  /** Senha SMTP CIFRADA — nunca exposta na API. */
  smtpPassEnc: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  /** Senha IMAP CIFRADA — nunca exposta na API. */
  imapPassEnc: string;
  lastUid: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type OutboundStatus = "pendente" | "enviado" | "falhou";

/** Item da fila de saída (Meta/e-mail) com backoff. */
export interface OutboundRecord {
  id: string;
  workspaceId: string;
  /** "messenger" | "instagram" | "email". */
  channel: string;
  conversationId: string | null;
  messageId: string | null;
  mailboxId: string | null;
  toValue: string;
  subject: string | null;
  text: string | null;
  status: OutboundStatus | string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WahaSessionStatus =
  | "criada"
  | "qr"
  | "conectada"
  | "desconectada"
  | "erro"
  | "encerrada";

export interface WahaSessionRecord {
  id: string;
  workspaceId: string;
  name: string;
  engine: string;
  status: WahaSessionStatus | string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lanche de atualizações para polling fallback. */
export interface WorkspaceUpdates {
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  notes: NoteRecord[];
}

/**
 * Contrato de persistência do core (F0).
 * Implementações: memória (dev/teste) e Postgres (prod/staging).
 * TODA leitura/escrita tenant recebe `workspaceId` — isolamento total.
 */
export interface Store {
  // users
  countUsers(): Promise<number>;
  createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    isOwnerGlobal: boolean;
  }): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;

  // workspaces
  createWorkspace(input: { name: string; slug: string }): Promise<WorkspaceRecord>;
  findWorkspaceById(id: string): Promise<WorkspaceRecord | null>;
  findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;

  // memberships
  addMember(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceMemberRole;
  }): Promise<MembershipRecord>;
  findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRecord | null>;
  listMembers(workspaceId: string): Promise<MemberWithUser[]>;
  listMembershipsByUser(userId: string): Promise<MembershipRecord[]>;

  // invites
  createInvite(input: {
    workspaceId: string;
    email: string;
    role: WorkspaceMemberRole;
    tokenHash: string;
    expiresAt: string;
    createdBy: string;
  }): Promise<InviteRecord>;
  findInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null>;
  markInviteAccepted(id: string, workspaceId: string): Promise<void>;

  // contacts (entidade tenant de exemplo)
  createContact(input: {
    workspaceId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  }): Promise<ContactRecord>;
  listContacts(workspaceId: string, query?: { q?: string }): Promise<ContactRecord[]>;
  findContactById(workspaceId: string, id: string): Promise<ContactRecord | null>;
  addContactChannel(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    value: string;
  }): Promise<ContactChannelRecord>;
  listContactChannels(workspaceId: string, contactId: string): Promise<ContactChannelRecord[]>;
  /** Move canais/conversas/eventos de `sourceId` para `targetId` e marca o source como absorvido. */
  mergeContacts(workspaceId: string, sourceId: string, targetId: string): Promise<ContactRecord>;
  contactTimeline(workspaceId: string, contactId: string): Promise<ContactEventRecord[]>;
  addContactEvent(input: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    kind: string;
    actorId?: string | null;
    description: string;
  }): Promise<ContactEventRecord>;

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

  // widget tokens
  createWidgetToken(input: {
    workspaceId: string;
    name: string;
    tokenHash: string;
  }): Promise<WidgetTokenRecord>;
  listWidgetTokens(workspaceId: string): Promise<WidgetTokenRecord[]>;
  findWidgetTokenByHash(tokenHash: string): Promise<WidgetTokenRecord | null>;
  revokeWidgetToken(workspaceId: string, id: string): Promise<boolean>;

  // sessões WAHA/WhatsApp (1+ por workspace)
  createWahaSession(input: {
    workspaceId: string;
    name: string;
    engine?: string;
  }): Promise<WahaSessionRecord>;
  listWahaSessions(workspaceId: string): Promise<WahaSessionRecord[]>;
  findWahaSessionById(
    workspaceId: string,
    id: string,
  ): Promise<WahaSessionRecord | null>;
  findWahaSessionByName(name: string): Promise<WahaSessionRecord | null>;
  updateWahaSession(
    workspaceId: string,
    id: string,
    patch: { status?: string; phone?: string | null },
  ): Promise<WahaSessionRecord | null>;

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

  // conexão Meta oficial (1 Página + IG por workspace)
  saveMetaConnection(input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  }): Promise<MetaConnectionRecord>;
  getMetaConnection(workspaceId: string): Promise<MetaConnectionRecord | null>;
  deleteMetaConnection(workspaceId: string): Promise<boolean>;
  /** Índice global Página → workspace (só ids, usado pelo webhook). */
  findWorkspaceIdByMetaPage(pageId: string): Promise<string | null>;

  // mailboxes (SMTP + IMAP por workspace)
  createMailbox(input: {
    workspaceId: string;
    name: string;
    fromEmail: string;
    fromName?: string | null;
    smtpHost: string;
    smtpPort?: number;
    smtpUser: string;
    smtpPassEnc: string;
    imapHost: string;
    imapPort?: number;
    imapUser: string;
    imapPassEnc: string;
  }): Promise<MailboxRecord>;
  listMailboxes(workspaceId: string): Promise<MailboxRecord[]>;
  findMailboxById(workspaceId: string, id: string): Promise<MailboxRecord | null>;
  updateMailbox(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      fromName?: string | null;
      status?: string;
      lastUid?: string | null;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPassEnc?: string;
      imapHost?: string;
      imapPort?: number;
      imapUser?: string;
      imapPassEnc?: string;
    },
  ): Promise<MailboxRecord | null>;
  deleteMailbox(workspaceId: string, id: string): Promise<boolean>;

  // fila de saída com backoff
  enqueueOutbound(input: {
    workspaceId: string;
    channel: string;
    conversationId?: string | null;
    messageId?: string | null;
    mailboxId?: string | null;
    toValue: string;
    subject?: string | null;
    text?: string | null;
  }): Promise<OutboundRecord>;
  listOutboundDue(
    workspaceId: string,
    nowIso: string,
    limit?: number,
  ): Promise<OutboundRecord[]>;
  listOutbound(
    workspaceId: string,
    filter?: { status?: string },
  ): Promise<OutboundRecord[]>;
  markOutboundSent(
    workspaceId: string,
    id: string,
    providerMessageId: string | null,
  ): Promise<OutboundRecord | null>;
  markOutboundRetry(
    workspaceId: string,
    id: string,
    nextAttemptIso: string,
    error: string,
  ): Promise<OutboundRecord | null>;
  markOutboundFailed(
    workspaceId: string,
    id: string,
    error: string,
  ): Promise<OutboundRecord | null>;
}

export type { WorkspaceMemberRole, WorkspaceRole };

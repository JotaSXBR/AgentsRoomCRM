import type { Pool, PoolClient } from "pg";
import type {
  BotMenuOption,
  BotRuleKind,
  BotRuleRecord,
  BotSessionRecord,
  BotSessionState,
  BusinessHours,
  ContactRecord,
  ConversationRecord,
  ConversationStatus,
  MailboxRecord,
  MessageRecord,
  MetaConnectionRecord,
  NoteRecord,
  OutboundRecord,
  QueueRecord,
  QueueTicketRecord,
  TagRecord,
  TicketStatus,
  UserRecord,
  WorkspaceRecord,
  WorkspaceSettingsRecord,
  WahaSessionRecord,
} from "../store.js";

/** Dependências explícitas das funções de persistência Postgres (sem classe). */
export interface PostgresDeps {
  pool: Pool;
  withWorkspace: <T>(workspaceId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>;
}

export function rowToContact(row: Record<string, unknown>): ContactRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    mergedIntoId: (row.merged_into_id as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToConversation(row: Record<string, unknown>): ConversationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    channel: String(row.channel),
    status: row.status as ConversationStatus,
    assigneeId: (row.assignee_id as string) ?? null,
    subject: (row.subject as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    direction: row.direction as MessageRecord["direction"],
    authorId: (row.author_id as string) ?? null,
    kind: row.kind as MessageRecord["kind"],
    text: (row.text as string) ?? null,
    mediaUrl: (row.media_url as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToNote(row: Record<string, unknown>): NoteRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    authorId: String(row.author_id),
    content: String(row.content),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToTag(row: Record<string, unknown>): TagRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    color: (row.color as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    name: String(row.name),
    isOwnerGlobal: Boolean(row.is_owner_global),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToWahaSession(row: Record<string, unknown>): WahaSessionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    engine: String(row.engine),
    status: String(row.status),
    phone: (row.phone as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToMetaConnection(row: Record<string, unknown>): MetaConnectionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    pageId: String(row.page_id),
    pageName: (row.page_name as string) ?? null,
    igUserId: (row.ig_user_id as string) ?? null,
    accessTokenEnc: String(row.access_token_enc),
    tokenExpiresAt: row.token_expires_at
      ? new Date(row.token_expires_at as string).toISOString()
      : null,
    status: String(row.status),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToMailbox(row: Record<string, unknown>): MailboxRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    fromEmail: String(row.from_email),
    fromName: (row.from_name as string) ?? null,
    smtpHost: String(row.smtp_host),
    smtpPort: Number(row.smtp_port),
    smtpUser: String(row.smtp_user),
    smtpPassEnc: String(row.smtp_pass_enc),
    imapHost: String(row.imap_host),
    imapPort: Number(row.imap_port),
    imapUser: String(row.imap_user),
    imapPassEnc: String(row.imap_pass_enc),
    lastUid: (row.last_uid as string) ?? null,
    status: String(row.status),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToOutbound(row: Record<string, unknown>): OutboundRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channel: String(row.channel),
    conversationId: (row.conversation_id as string) ?? null,
    messageId: (row.message_id as string) ?? null,
    mailboxId: (row.mailbox_id as string) ?? null,
    toValue: String(row.to_value),
    subject: (row.subject as string) ?? null,
    text: (row.text as string) ?? null,
    status: String(row.status),
    attempts: Number(row.attempts),
    nextAttemptAt: new Date(row.next_attempt_at as string).toISOString(),
    lastError: (row.last_error as string) ?? null,
    providerMessageId: (row.provider_message_id as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToWorkspaceSettings(row: Record<string, unknown>): WorkspaceSettingsRecord {
  return {
    workspaceId: String(row.workspace_id),
    timezone: String(row.timezone),
    absenceMessage: String(row.absence_message),
    businessHours: (row.business_hours as BusinessHours) ?? {},
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToQueue(row: Record<string, unknown>): QueueRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    channel: (row.channel as string) ?? null,
    isDefault: Boolean(row.is_default),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function rowToTicket(row: Record<string, unknown>): QueueTicketRecord {
  const toIso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    queueId: String(row.queue_id),
    conversationId: String(row.conversation_id),
    channel: String(row.channel),
    status: row.status as TicketStatus,
    assignedUserId: (row.assigned_user_id as string) ?? null,
    enqueuedAt: new Date(row.enqueued_at as string).toISOString(),
    firstResponseAt: toIso(row.first_response_at),
    resolvedAt: toIso(row.resolved_at),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToBotRule(row: Record<string, unknown>): BotRuleRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    kind: row.kind as BotRuleKind,
    priority: Number(row.priority),
    active: Boolean(row.active),
    terms: (row.terms as string[]) ?? [],
    reply: (row.reply as string) ?? null,
    options: (row.options as BotMenuOption[]) ?? [],
    queueId: (row.queue_id as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export function rowToBotSession(row: Record<string, unknown>): BotSessionRecord {
  return {
    conversationId: String(row.conversation_id),
    workspaceId: String(row.workspace_id),
    state: (row.state as BotSessionState) ?? {},
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}


export function mailboxPatchParams(
  id: string,
  workspaceId: string,
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
): unknown[] {
  const n = <T>(v: T | undefined): T | null => (v ?? null);
  const fromNameSet = patch.fromName !== undefined;
  const lastUidSet = patch.lastUid !== undefined;
  return [
    id,
    workspaceId,
    n(patch.name),
    fromNameSet,
    fromNameSet ? patch.fromName : null,
    n(patch.status),
    lastUidSet,
    lastUidSet ? patch.lastUid : null,
    n(patch.smtpHost),
    n(patch.smtpPort),
    n(patch.smtpUser),
    n(patch.smtpPassEnc),
    n(patch.imapHost),
    n(patch.imapPort),
    n(patch.imapUser),
    n(patch.imapPassEnc),
  ];
}

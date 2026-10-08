import type {
  AiKnowledgeChunkRecord,
  AiKnowledgeSourceRecord,
  AiLogRecord,
  AiProviderRecord,
  AiSettingsRecord,
  ApiKeyRecord,
  BotRuleRecord,
  BotSessionRecord,
  ContactChannelRecord,
  ContactConsentRecord,
  ContactEventRecord,
  ContactRecord,
  ConversationRatingRecord,
  ConversationRecord,
  ConversationTagRecord,
  FlowRecord,
  FlowStepRecord,
  InviteRecord,
  LgpdRequestRecord,
  MailboxRecord,
  MembershipRecord,
  MessageRecord,
  MetaConnectionRecord,
  NoteRecord,
  OutboundRecord,
  QueueRecord,
  QueueTicketRecord,
  TagRecord,
  UserRecord,
  WahaSessionRecord,
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
  WidgetTokenRecord,
  WorkspaceModuleRecord,
  WorkspaceRecord,
  WorkspaceSettingsRecord,
} from "../store.js";

/** Evento de intake idempotente, indexado por `workspaceId:source:externalId`. */
export interface IntakeEventValue {
  workspaceId: string;
  source: string;
  externalId: string;
  conversationId: string | null;
  messageId: string | null;
}

/** Vínculo atendente <-> fila. */
export interface QueueMemberValue {
  workspaceId: string;
  queueId: string;
  userId: string;
  createdAt: string;
}

/**
 * Estado explícito que as funções de domínio recebem em vez de `this`.
 * Cada módulo usa um `Pick` só com os Maps que lê/escreve.
 */
export interface MemoryState {
  users: Map<string, UserRecord>;
  workspaces: Map<string, WorkspaceRecord>;
  memberships: Map<string, MembershipRecord>;
  invites: Map<string, InviteRecord>;
  contacts: Map<string, ContactRecord>;
  contactChannels: Map<string, ContactChannelRecord>;
  contactEvents: Map<string, ContactEventRecord>;
  tags: Map<string, TagRecord>;
  conversationTags: Map<string, ConversationTagRecord>;
  conversations: Map<string, ConversationRecord>;
  messages: Map<string, MessageRecord>;
  notes: Map<string, NoteRecord>;
  widgetTokens: Map<string, WidgetTokenRecord>;
  wahaSessions: Map<string, WahaSessionRecord>;
  intakeEvents: Map<string, IntakeEventValue>;
  metaConnections: Map<string, MetaConnectionRecord>;
  metaPageIndex: Map<string, string>;
  mailboxes: Map<string, MailboxRecord>;
  outboundQueue: Map<string, OutboundRecord>;
  workspaceSettings: Map<string, WorkspaceSettingsRecord>;
  queues: Map<string, QueueRecord>;
  queueMembers: Map<string, QueueMemberValue>;
  tickets: Map<string, QueueTicketRecord>;
  botRules: Map<string, BotRuleRecord>;
  botSessions: Map<string, BotSessionRecord>;
  aiSettings: Map<string, AiSettingsRecord>;
  aiProviders: Map<string, AiProviderRecord>;
  aiSources: Map<string, AiKnowledgeSourceRecord>;
  aiChunks: Map<string, AiKnowledgeChunkRecord>;
  aiLogs: Map<string, AiLogRecord>;
  apiKeys: Map<string, ApiKeyRecord>;
  webhookEndpoints: Map<string, WebhookEndpointRecord>;
  webhookDeliveries: Map<string, WebhookDeliveryRecord>;
  ratings: Map<string, ConversationRatingRecord>;
  consents: Map<string, ContactConsentRecord>;
  lgpdRequests: Map<string, LgpdRequestRecord>;
  flows: Map<string, FlowRecord>;
  flowSteps: Map<string, FlowStepRecord>;
  workspaceModules: Map<string, WorkspaceModuleRecord>;
}

export function now(): string {
  return new Date().toISOString();
}

export function pick<T>(
  primary: T | null | undefined,
  secondary: T | null | undefined,
  fallback: T,
): T {
  return primary ?? secondary ?? fallback;
}

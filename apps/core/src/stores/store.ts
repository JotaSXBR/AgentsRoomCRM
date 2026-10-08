import type { BotStore, WorkspaceSettingsStore } from "./types/bot.js";
import type { ContactsStore } from "./types/contacts.js";
import type { InboxStore, TagsStore } from "./types/inbox.js";
import type { IntakeStore } from "./types/intake.js";
import type {
  InvitesStore,
  MembershipsStore,
  UsersStore,
  WorkspacesStore,
} from "./types/identity.js";
import type { MailboxesStore } from "./types/mail.js";
import type { MetaStore } from "./types/meta.js";
import type { OutboundStore } from "./types/outbound.js";
import type { QueueTicketsStore, QueuesStore } from "./types/queues.js";
import type { WahaSessionsStore } from "./types/waha.js";
import type { WidgetTokensStore } from "./types/widget.js";

/**
 * Contrato de persistência do core (F0).
 * Implementações: memória (dev/teste) e Postgres (prod/staging).
 * TODA leitura/escrita tenant recebe `workspaceId` — isolamento total.
 *
 * Fatias por domínio em `./types/*` — sem membros próprios.
 */
export interface Store
  extends
    UsersStore,
    WorkspacesStore,
    MembershipsStore,
    InvitesStore,
    ContactsStore,
    TagsStore,
    InboxStore,
    WidgetTokensStore,
    WahaSessionsStore,
    IntakeStore,
    MetaStore,
    MailboxesStore,
    OutboundStore,
    WorkspaceSettingsStore,
    QueuesStore,
    QueueTicketsStore,
    BotStore {}

export type {
  AuthUser,
  InviteRecord,
  MemberWithUser,
  MembershipRecord,
  UserRecord,
  WorkspaceMemberRole,
  WorkspaceRecord,
  WorkspaceRole,
} from "./types/identity.js";
export type {
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
} from "./types/contacts.js";
export type {
  ConversationRecord,
  ConversationStatus,
  ConversationTagRecord,
  MessageRecord,
  NoteRecord,
  TagRecord,
  WorkspaceUpdates,
} from "./types/inbox.js";
export type { WidgetTokenRecord } from "./types/widget.js";
export type { WahaSessionRecord, WahaSessionStatus } from "./types/waha.js";
export type { MetaConnectionRecord } from "./types/meta.js";
export type { MailboxRecord } from "./types/mail.js";
export type { OutboundRecord, OutboundStatus } from "./types/outbound.js";
export type {
  QueueRecord,
  QueueTicketRecord,
  TicketStatus,
} from "./types/queues.js";
export type {
  BotMenuOption,
  BotRuleKind,
  BotRuleRecord,
  BotSessionRecord,
  BotSessionState,
  BusinessHours,
  WorkspaceSettingsRecord,
} from "./types/bot.js";

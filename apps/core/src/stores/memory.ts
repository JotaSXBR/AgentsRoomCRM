import type {
  BotMenuOption, BotRuleKind, BotRuleRecord, BotSessionRecord, BotSessionState,
  BusinessHours, ContactChannelRecord, ContactEventRecord, ContactRecord,
  ConversationRecord, ConversationStatus, ConversationTagRecord, InviteRecord,
  MailboxRecord, MembershipRecord, MemberWithUser, MessageRecord,
  MetaConnectionRecord, NoteRecord, OutboundRecord, QueueRecord,
  QueueTicketRecord, Store, TagRecord, TicketStatus, UserRecord,
  WahaSessionRecord, WidgetTokenRecord, WorkspaceRecord, WorkspaceSettingsRecord,
  WorkspaceUpdates,
} from "./store.js";
import * as bot from "./memory/bot.js";
import * as contacts from "./memory/contacts.js";
import * as identity from "./memory/identity.js";
import * as inbox from "./memory/inbox.js";
import * as intake from "./memory/intake.js";
import * as mail from "./memory/mail.js";
import * as meta from "./memory/meta.js";
import * as outbound from "./memory/outbound.js";
import * as queues from "./memory/queues.js";
import * as waha from "./memory/waha.js";
import * as widget from "./memory/widget.js";
import type { IntakeEventValue, MemoryState, QueueMemberValue } from "./memory/shared.js";

/** Implementação em memória — dev e testes. NÃO usar em produção. */
export class MemoryStore implements Store {
  readonly users = new Map<string, UserRecord>();
  readonly workspaces = new Map<string, WorkspaceRecord>();
  readonly memberships = new Map<string, MembershipRecord>();
  readonly invites = new Map<string, InviteRecord>();
  readonly contacts = new Map<string, ContactRecord>();
  readonly contactChannels = new Map<string, ContactChannelRecord>();
  readonly contactEvents = new Map<string, ContactEventRecord>();
  readonly tags = new Map<string, TagRecord>();
  readonly conversationTags = new Map<string, ConversationTagRecord>();
  readonly conversations = new Map<string, ConversationRecord>();
  readonly messages = new Map<string, MessageRecord>();
  readonly notes = new Map<string, NoteRecord>();
  readonly widgetTokens = new Map<string, WidgetTokenRecord>();
  readonly wahaSessions = new Map<string, WahaSessionRecord>();
  readonly intakeEvents = new Map<string, IntakeEventValue>();
  readonly metaConnections = new Map<string, MetaConnectionRecord>();
  readonly metaPageIndex = new Map<string, string>();
  readonly mailboxes = new Map<string, MailboxRecord>();
  readonly outboundQueue = new Map<string, OutboundRecord>();
  readonly workspaceSettings = new Map<string, WorkspaceSettingsRecord>();
  readonly queues = new Map<string, QueueRecord>();
  readonly queueMembers = new Map<string, QueueMemberValue>();
  readonly tickets = new Map<string, QueueTicketRecord>();
  readonly botRules = new Map<string, BotRuleRecord>();
  readonly botSessions = new Map<string, BotSessionRecord>();
  private readonly state: MemoryState = {
    users: this.users, workspaces: this.workspaces,
    memberships: this.memberships, invites: this.invites,
    contacts: this.contacts, contactChannels: this.contactChannels,
    contactEvents: this.contactEvents, tags: this.tags,
    conversationTags: this.conversationTags, conversations: this.conversations,
    messages: this.messages, notes: this.notes,
    widgetTokens: this.widgetTokens, wahaSessions: this.wahaSessions,
    intakeEvents: this.intakeEvents, metaConnections: this.metaConnections,
    metaPageIndex: this.metaPageIndex, mailboxes: this.mailboxes,
    outboundQueue: this.outboundQueue, workspaceSettings: this.workspaceSettings,
    queues: this.queues, queueMembers: this.queueMembers,
    tickets: this.tickets, botRules: this.botRules, botSessions: this.botSessions,
  };
  async countUsers(): Promise<number> {
    return identity.countUsers(this.state);
  }
  async createUser(input: { email: string; passwordHash: string; name: string; isOwnerGlobal: boolean }): Promise<UserRecord> {
    return identity.createUser(this.state, input);
  }
  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return identity.findUserByEmail(this.state, email);
  }
  async findUserById(id: string): Promise<UserRecord | null> {
    return identity.findUserById(this.state, id);
  }
  async createWorkspace(input: { name: string; slug: string }): Promise<WorkspaceRecord> {
    return identity.createWorkspace(this.state, input);
  }
  async findWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    return identity.findWorkspaceById(this.state, id);
  }
  async findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> {
    return identity.findWorkspaceBySlug(this.state, slug);
  }
  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return identity.listWorkspaces(this.state);
  }
  async addMember(input: { workspaceId: string; userId: string; role: MembershipRecord["role"] }): Promise<MembershipRecord> {
    return identity.addMember(this.state, input);
  }
  async findMembership(workspaceId: string, userId: string): Promise<MembershipRecord | null> {
    return identity.findMembership(this.state, workspaceId, userId);
  }
  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    return identity.listMembers(this.state, workspaceId);
  }
  async listMembershipsByUser(userId: string): Promise<MembershipRecord[]> {
    return identity.listMembershipsByUser(this.state, userId);
  }
  async createInvite(input: { workspaceId: string; email: string; role: InviteRecord["role"]; tokenHash: string; expiresAt: string; createdBy: string }): Promise<InviteRecord> {
    return identity.createInvite(this.state, input);
  }
  async findInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    return identity.findInviteByTokenHash(this.state, tokenHash);
  }
  async markInviteAccepted(id: string, _workspaceId: string): Promise<void> {
    return identity.markInviteAccepted(this.state, id);
  }
  async createContact(input: { workspaceId: string; name: string; phone?: string | null; email?: string | null }): Promise<ContactRecord> {
    return contacts.createContact(this.state, input);
  }
  async listContacts(workspaceId: string, query?: { q?: string }): Promise<ContactRecord[]> {
    return contacts.listContacts(this.state, workspaceId, query);
  }
  async findContactById(workspaceId: string, id: string): Promise<ContactRecord | null> {
    return contacts.findContactById(this.state, workspaceId, id);
  }
  async addContactChannel(input: { workspaceId: string; contactId: string; channel: string; value: string }): Promise<ContactChannelRecord> {
    return contacts.addContactChannel(this.state, input);
  }
  async listContactChannels(workspaceId: string, contactId: string): Promise<ContactChannelRecord[]> {
    return contacts.listContactChannels(this.state, workspaceId, contactId);
  }
  async mergeContacts(workspaceId: string, sourceId: string, targetId: string): Promise<ContactRecord> {
    return contacts.mergeContacts(this.state, workspaceId, sourceId, targetId);
  }
  async contactTimeline(workspaceId: string, contactId: string): Promise<ContactEventRecord[]> {
    return contacts.contactTimeline(this.state, workspaceId, contactId);
  }
  async addContactEvent(input: { workspaceId: string; contactId: string; conversationId?: string | null; kind: string; actorId?: string | null; description: string }): Promise<ContactEventRecord> {
    return contacts.addContactEvent(this.state, input);
  }
  async createTag(input: { workspaceId: string; name: string; color?: string | null }): Promise<TagRecord> {
    return inbox.createTag(this.state, input);
  }
  async listTags(workspaceId: string): Promise<TagRecord[]> {
    return inbox.listTags(this.state, workspaceId);
  }
  async tagConversation(workspaceId: string, conversationId: string, tagId: string): Promise<void> {
    return inbox.tagConversation(this.state, workspaceId, conversationId, tagId);
  }
  async untagConversation(workspaceId: string, conversationId: string, tagId: string): Promise<void> {
    return inbox.untagConversation(this.state, workspaceId, conversationId, tagId);
  }
  async listConversationTags(workspaceId: string, conversationId: string): Promise<TagRecord[]> {
    return inbox.listConversationTags(this.state, workspaceId, conversationId);
  }
  async createConversation(input: { workspaceId: string; contactId: string; channel: string; subject?: string | null }): Promise<ConversationRecord> {
    return inbox.createConversation(this.state, input);
  }
  async findConversationById(workspaceId: string, id: string): Promise<ConversationRecord | null> {
    return inbox.findConversationById(this.state, workspaceId, id);
  }
  async listConversations(workspaceId: string, filter?: { status?: ConversationStatus; assigneeId?: string; tagId?: string; q?: string }): Promise<ConversationRecord[]> {
    return inbox.listConversations(this.state, workspaceId, filter);
  }
  async setConversationStatus(workspaceId: string, id: string, status: ConversationStatus): Promise<ConversationRecord | null> {
    return inbox.setConversationStatus(this.state, workspaceId, id, status);
  }
  async assignConversation(workspaceId: string, id: string, assigneeId: string | null): Promise<ConversationRecord | null> {
    return inbox.assignConversation(this.state, workspaceId, id, assigneeId);
  }
  async addMessage(input: { workspaceId: string; conversationId: string; direction: MessageRecord["direction"]; authorId?: string | null; kind?: MessageRecord["kind"]; text?: string | null; mediaUrl?: string | null }): Promise<MessageRecord> {
    return inbox.addMessage(this.state, input);
  }
  async listMessages(workspaceId: string, conversationId: string, options?: { since?: string }): Promise<MessageRecord[]> {
    return inbox.listMessages(this.state, workspaceId, conversationId, options);
  }
  async addNote(input: { workspaceId: string; conversationId: string; authorId: string; content: string }): Promise<NoteRecord> {
    return inbox.addNote(this.state, input);
  }
  async listNotes(workspaceId: string, conversationId: string): Promise<NoteRecord[]> {
    return inbox.listNotes(this.state, workspaceId, conversationId);
  }
  async listUpdates(workspaceId: string, since: string): Promise<WorkspaceUpdates> {
    return inbox.listUpdates(this.state, workspaceId, since);
  }
  async createWidgetToken(input: { workspaceId: string; name: string; tokenHash: string }): Promise<WidgetTokenRecord> {
    return widget.createWidgetToken(this.state, input);
  }
  async listWidgetTokens(workspaceId: string): Promise<WidgetTokenRecord[]> {
    return widget.listWidgetTokens(this.state, workspaceId);
  }
  async findWidgetTokenByHash(tokenHash: string): Promise<WidgetTokenRecord | null> {
    return widget.findWidgetTokenByHash(this.state, tokenHash);
  }
  async revokeWidgetToken(workspaceId: string, id: string): Promise<boolean> {
    return widget.revokeWidgetToken(this.state, workspaceId, id);
  }
  async createWahaSession(input: { workspaceId: string; name: string; engine?: string }): Promise<WahaSessionRecord> {
    return waha.createWahaSession(this.state, input);
  }
  async listWahaSessions(workspaceId: string): Promise<WahaSessionRecord[]> {
    return waha.listWahaSessions(this.state, workspaceId);
  }
  async findWahaSessionById(workspaceId: string, id: string): Promise<WahaSessionRecord | null> {
    return waha.findWahaSessionById(this.state, workspaceId, id);
  }
  async findWahaSessionByName(name: string): Promise<WahaSessionRecord | null> {
    return waha.findWahaSessionByName(this.state, name);
  }
  async updateWahaSession(workspaceId: string, id: string, patch: { status?: string; phone?: string | null }): Promise<WahaSessionRecord | null> {
    return waha.updateWahaSession(this.state, workspaceId, id, patch);
  }
  async claimIntakeEvent(input: { workspaceId: string; source: string; externalId: string }): Promise<boolean> {
    return intake.claimIntakeEvent(this.state, input);
  }
  async linkIntakeEvent(input: { workspaceId: string; source: string; externalId: string; conversationId: string; messageId: string }): Promise<void> {
    return intake.linkIntakeEvent(this.state, input);
  }
  async findContactByChannel(workspaceId: string, channel: string, value: string): Promise<ContactRecord | null> {
    return intake.findContactByChannel(this.state, workspaceId, channel, value);
  }
  async findContactByAnyChannelValue(workspaceId: string, value: string): Promise<ContactRecord | null> {
    return intake.findContactByAnyChannelValue(this.state, workspaceId, value);
  }
  async findActiveConversation(workspaceId: string, contactId: string, channel: string): Promise<ConversationRecord | null> {
    return intake.findActiveConversation(this.state, workspaceId, contactId, channel);
  }
  async saveMetaConnection(input: { workspaceId: string; pageId: string; pageName?: string | null; igUserId?: string | null; accessTokenEnc: string; tokenExpiresAt?: string | null; status?: string }): Promise<MetaConnectionRecord> {
    return meta.saveMetaConnection(this.state, input);
  }
  async getMetaConnection(workspaceId: string): Promise<MetaConnectionRecord | null> {
    return meta.getMetaConnection(this.state, workspaceId);
  }
  async deleteMetaConnection(workspaceId: string): Promise<boolean> {
    return meta.deleteMetaConnection(this.state, workspaceId);
  }
  async findWorkspaceIdByMetaPage(pageId: string): Promise<string | null> {
    return meta.findWorkspaceIdByMetaPage(this.state, pageId);
  }
  async createMailbox(input: { workspaceId: string; name: string; fromEmail: string; fromName?: string | null; smtpHost: string; smtpPort?: number; smtpUser: string; smtpPassEnc: string; imapHost: string; imapPort?: number; imapUser: string; imapPassEnc: string }): Promise<MailboxRecord> {
    return mail.createMailbox(this.state, input);
  }
  async listMailboxes(workspaceId: string): Promise<MailboxRecord[]> {
    return mail.listMailboxes(this.state, workspaceId);
  }
  async findMailboxById(workspaceId: string, id: string): Promise<MailboxRecord | null> {
    return mail.findMailboxById(this.state, workspaceId, id);
  }
  async updateMailbox(workspaceId: string, id: string, patch: mail.MailboxPatch): Promise<MailboxRecord | null> {
    return mail.updateMailbox(this.state, workspaceId, id, patch);
  }
  async deleteMailbox(workspaceId: string, id: string): Promise<boolean> {
    return mail.deleteMailbox(this.state, workspaceId, id);
  }
  async enqueueOutbound(input: { workspaceId: string; channel: string; conversationId?: string | null; messageId?: string | null; mailboxId?: string | null; toValue: string; subject?: string | null; text?: string | null }): Promise<OutboundRecord> {
    return outbound.enqueueOutbound(this.state, input);
  }
  async listOutboundDue(workspaceId: string, nowIso: string, limit = 25): Promise<OutboundRecord[]> {
    return outbound.listOutboundDue(this.state, workspaceId, nowIso, limit);
  }
  async listOutbound(workspaceId: string, filter?: { status?: string }): Promise<OutboundRecord[]> {
    return outbound.listOutbound(this.state, workspaceId, filter);
  }
  async markOutboundSent(workspaceId: string, id: string, providerMessageId: string | null): Promise<OutboundRecord | null> {
    return outbound.markOutboundSent(this.state, workspaceId, id, providerMessageId);
  }
  async markOutboundRetry(workspaceId: string, id: string, nextAttemptIso: string, error: string): Promise<OutboundRecord | null> {
    return outbound.markOutboundRetry(this.state, workspaceId, id, { nextAttemptIso, error });
  }
  async markOutboundFailed(workspaceId: string, id: string, error: string): Promise<OutboundRecord | null> {
    return outbound.markOutboundFailed(this.state, workspaceId, id, error);
  }
  async getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettingsRecord | null> {
    return bot.getWorkspaceSettings(this.state, workspaceId);
  }
  async upsertWorkspaceSettings(input: { workspaceId: string; timezone?: string; absenceMessage?: string; businessHours?: BusinessHours }): Promise<WorkspaceSettingsRecord> {
    return bot.upsertWorkspaceSettings(this.state, input);
  }
  async createQueue(input: { workspaceId: string; name: string; channel?: string | null; isDefault?: boolean }): Promise<QueueRecord> {
    return queues.createQueue(this.state, input);
  }
  async listQueues(workspaceId: string): Promise<QueueRecord[]> {
    return queues.listQueues(this.state, workspaceId);
  }
  async findQueueById(workspaceId: string, id: string): Promise<QueueRecord | null> {
    return queues.findQueueById(this.state, workspaceId, id);
  }
  async deleteQueue(workspaceId: string, id: string): Promise<boolean> {
    return queues.deleteQueue(this.state, workspaceId, id);
  }
  async addQueueMember(input: { workspaceId: string; queueId: string; userId: string }): Promise<void> {
    return queues.addQueueMember(this.state, input);
  }
  async removeQueueMember(workspaceId: string, queueId: string, userId: string): Promise<boolean> {
    return queues.removeQueueMember(this.state, workspaceId, queueId, userId);
  }
  async listQueueMembers(workspaceId: string, queueId: string): Promise<string[]> {
    return queues.listQueueMembers(this.state, workspaceId, queueId);
  }
  async enqueueTicket(input: { workspaceId: string; queueId: string; conversationId: string; channel: string }): Promise<QueueTicketRecord> {
    return queues.enqueueTicket(this.state, input);
  }
  async listTickets(workspaceId: string, filter?: { queueId?: string; status?: string; assignedUserId?: string }): Promise<QueueTicketRecord[]> {
    return queues.listTickets(this.state, workspaceId, filter);
  }
  async findTicketById(workspaceId: string, id: string): Promise<QueueTicketRecord | null> {
    return queues.findTicketById(this.state, workspaceId, id);
  }
  async findOpenTicketByConversation(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    return queues.findOpenTicketByConversation(this.state, workspaceId, conversationId);
  }
  async updateTicket(workspaceId: string, id: string, patch: { status?: TicketStatus; assignedUserId?: string | null; firstResponseAt?: string | null; resolvedAt?: string | null }): Promise<QueueTicketRecord | null> {
    return queues.updateTicket(this.state, workspaceId, id, patch);
  }
  async markTicketFirstResponse(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    return queues.markTicketFirstResponse(this.state, workspaceId, conversationId);
  }
  async resolveOpenTicketForConversation(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    return queues.resolveOpenTicketForConversation(this.state, workspaceId, conversationId);
  }
  async createBotRule(input: { workspaceId: string; name: string; kind: BotRuleKind; priority?: number; active?: boolean; terms?: string[]; reply?: string | null; options?: BotMenuOption[]; queueId?: string | null }): Promise<BotRuleRecord> {
    return bot.createBotRule(this.state, input);
  }
  async listBotRules(workspaceId: string): Promise<BotRuleRecord[]> {
    return bot.listBotRules(this.state, workspaceId);
  }
  async updateBotRule(workspaceId: string, id: string, patch: Partial<{ name: string; priority: number; active: boolean; terms: string[]; reply: string | null; options: BotMenuOption[]; queueId: string | null }>): Promise<BotRuleRecord | null> {
    return bot.updateBotRule(this.state, workspaceId, id, patch);
  }
  async deleteBotRule(workspaceId: string, id: string): Promise<boolean> {
    return bot.deleteBotRule(this.state, workspaceId, id);
  }
  async getBotSession(workspaceId: string, conversationId: string): Promise<BotSessionRecord | null> {
    return bot.getBotSession(this.state, workspaceId, conversationId);
  }
  async setBotSession(input: { workspaceId: string; conversationId: string; state: BotSessionState }): Promise<BotSessionRecord> {
    return bot.setBotSession(this.state, input);
  }
}

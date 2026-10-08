import { Pool, type PoolClient } from "pg";
import { setWorkspaceContextSql } from "@agentsroom/db";
import type {
  BotMenuOption,
  BotRuleKind,
  BotRuleRecord,
  BotSessionRecord,
  BotSessionState,
  BusinessHours,
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
  ConversationRecord,
  ConversationStatus,
  InviteRecord,
  MailboxRecord,
  MembershipRecord,
  MemberWithUser,
  MessageRecord,
  MetaConnectionRecord,
  NoteRecord,
  OutboundRecord,
  QueueRecord,
  QueueTicketRecord,
  Store,
  TagRecord,
  TicketStatus,
  UserRecord,
  WahaSessionRecord,
  WidgetTokenRecord,
  WorkspaceRecord,
  WorkspaceSettingsRecord,
  WorkspaceUpdates,
} from "./store.js";
import * as botOps from "./postgres/bot.js";
import * as contactsOps from "./postgres/contacts.js";
import * as identityOps from "./postgres/identity.js";
import * as inboxOps from "./postgres/inbox.js";
import * as intakeOps from "./postgres/intake.js";
import * as mailOps from "./postgres/mail.js";
import * as metaOps from "./postgres/meta.js";
import * as outboundOps from "./postgres/outbound.js";
import * as queuesOps from "./postgres/queues.js";
import * as wahaOps from "./postgres/waha.js";
import * as widgetOps from "./postgres/widget.js";
import type { PostgresDeps } from "./postgres/rows.js";

/**
 * Persistência Postgres com RLS (F0).
 * Cada operação tenant roda em transação com `SET LOCAL app.current_workspace_id`,
 * de modo que as policies RLS valem mesmo se a cláusula `workspace_id` for omitida.
 * O role de conexão do app (`app_user`) NÃO tem BYPASSRLS (ver migrations).
 *
 * Classe fina: só delega para as funções de `./postgres/*` (sem SQL aqui).
 */
export class PostgresStore implements Store {
  private readonly deps: PostgresDeps;
  constructor(private readonly pool: Pool) {
    const poolRef = pool;
    this.deps = {
      pool: poolRef,
      withWorkspace: <T>(
        workspaceId: string,
        fn: (client: PoolClient) => Promise<T>,
      ): Promise<T> => this.withWorkspace(workspaceId, fn),
    };
  }

  /** Executa `fn` com o contexto RLS do workspace fixado na transação. */
  async withWorkspace<T>(
    workspaceId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ctx = setWorkspaceContextSql(workspaceId);
      await client.query(ctx.text, ctx.values);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async countUsers(): Promise<number> { return identityOps.countUsers(this.deps); }
  async createUser(input: { email: string; passwordHash: string; name: string; isOwnerGlobal: boolean; }): Promise<UserRecord> { return identityOps.createUser(this.deps, input); }
  async findUserByEmail(email: string): Promise<UserRecord | null> { return identityOps.findUserByEmail(this.deps, email); }
  async findUserById(id: string): Promise<UserRecord | null> { return identityOps.findUserById(this.deps, id); }
  async createWorkspace(input: { name: string; slug: string }): Promise<WorkspaceRecord> { return identityOps.createWorkspace(this.deps, input); }
  async findWorkspaceById(id: string): Promise<WorkspaceRecord | null> { return identityOps.findWorkspaceById(this.deps, id); }
  async findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> { return identityOps.findWorkspaceBySlug(this.deps, slug); }
  async listWorkspaces(): Promise<WorkspaceRecord[]> { return identityOps.listWorkspaces(this.deps); }
  async addMember(input: { workspaceId: string; userId: string; role: MembershipRecord["role"]; }): Promise<MembershipRecord> { return identityOps.addMember(this.deps, input); }
  async findMembership(workspaceId: string, userId: string,): Promise<MembershipRecord | null> { return identityOps.findMembership(this.deps, workspaceId, userId); }
  async listMembers(workspaceId: string): Promise<MemberWithUser[]> { return identityOps.listMembers(this.deps, workspaceId); }
  async listMembershipsByUser(userId: string): Promise<MembershipRecord[]> { return identityOps.listMembershipsByUser(this.deps, userId); }
  async createInvite(input: { workspaceId: string; email: string; role: InviteRecord["role"]; tokenHash: string; expiresAt: string; createdBy: string; }): Promise<InviteRecord> { return identityOps.createInvite(this.deps, input); }
  async findInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null> { return identityOps.findInviteByTokenHash(this.deps, tokenHash); }
  async markInviteAccepted(id: string, workspaceId: string): Promise<void> { return identityOps.markInviteAccepted(this.deps, id, workspaceId); }
  async createContact(input: { workspaceId: string; name: string; phone?: string | null; email?: string | null; }): Promise<ContactRecord> { return contactsOps.createContact(this.deps, input); }
  async listContacts(workspaceId: string, query?: { q?: string },): Promise<ContactRecord[]> { return contactsOps.listContacts(this.deps, workspaceId, query); }
  async findContactById(workspaceId: string, id: string,): Promise<ContactRecord | null> { return contactsOps.findContactById(this.deps, workspaceId, id); }
  async addContactChannel(input: { workspaceId: string; contactId: string; channel: string; value: string; }): Promise<ContactChannelRecord> { return contactsOps.addContactChannel(this.deps, input); }
  async listContactChannels(workspaceId: string, contactId: string,): Promise<ContactChannelRecord[]> { return contactsOps.listContactChannels(this.deps, workspaceId, contactId); }
  async mergeContacts(workspaceId: string, sourceId: string, targetId: string,): Promise<ContactRecord> { return contactsOps.mergeContacts(this.deps, workspaceId, sourceId, targetId); }
  async contactTimeline(workspaceId: string, contactId: string,): Promise<ContactEventRecord[]> { return contactsOps.contactTimeline(this.deps, workspaceId, contactId); }
  async addContactEvent(input: { workspaceId: string; contactId: string; conversationId?: string | null; kind: string; actorId?: string | null; description: string; }): Promise<ContactEventRecord> { return contactsOps.addContactEvent(this.deps, input); }
  async createTag(input: { workspaceId: string; name: string; color?: string | null; }): Promise<TagRecord> { return inboxOps.createTag(this.deps, input); }
  async listTags(workspaceId: string): Promise<TagRecord[]> { return inboxOps.listTags(this.deps, workspaceId); }
  async tagConversation(workspaceId: string, conversationId: string, tagId: string,): Promise<void> { return inboxOps.tagConversation(this.deps, workspaceId, conversationId, tagId); }
  async untagConversation(workspaceId: string, conversationId: string, tagId: string,): Promise<void> { return inboxOps.untagConversation(this.deps, workspaceId, conversationId, tagId); }
  async listConversationTags(workspaceId: string, conversationId: string,): Promise<TagRecord[]> { return inboxOps.listConversationTags(this.deps, workspaceId, conversationId); }
  async createConversation(input: { workspaceId: string; contactId: string; channel: string; subject?: string | null; }): Promise<ConversationRecord> { return inboxOps.createConversation(this.deps, input); }
  async findConversationById(workspaceId: string, id: string,): Promise<ConversationRecord | null> { return inboxOps.findConversationById(this.deps, workspaceId, id); }
  async listConversations(workspaceId: string, filter?: { status?: ConversationStatus; assigneeId?: string; tagId?: string; q?: string; },): Promise<ConversationRecord[]> { return inboxOps.listConversations(this.deps, workspaceId, filter); }
  async setConversationStatus(workspaceId: string, id: string, status: ConversationStatus,): Promise<ConversationRecord | null> { return inboxOps.setConversationStatus(this.deps, workspaceId, id, status); }
  async assignConversation(workspaceId: string, id: string, assigneeId: string | null,): Promise<ConversationRecord | null> { return inboxOps.assignConversation(this.deps, workspaceId, id, assigneeId); }
  async addMessage(input: { workspaceId: string; conversationId: string; direction: MessageRecord["direction"]; authorId?: string | null; kind?: MessageRecord["kind"]; text?: string | null; mediaUrl?: string | null; }): Promise<MessageRecord> { return inboxOps.addMessage(this.deps, input); }
  async listMessages(workspaceId: string, conversationId: string, options?: { since?: string },): Promise<MessageRecord[]> { return inboxOps.listMessages(this.deps, workspaceId, conversationId, options); }
  async addNote(input: { workspaceId: string; conversationId: string; authorId: string; content: string; }): Promise<NoteRecord> { return inboxOps.addNote(this.deps, input); }
  async listNotes(workspaceId: string, conversationId: string,): Promise<NoteRecord[]> { return inboxOps.listNotes(this.deps, workspaceId, conversationId); }
  async listUpdates(workspaceId: string, since: string): Promise<WorkspaceUpdates> { return inboxOps.listUpdates(this.deps, workspaceId, since); }
  async createWidgetToken(input: { workspaceId: string; name: string; tokenHash: string; }): Promise<WidgetTokenRecord> { return widgetOps.createWidgetToken(this.deps, input); }
  async listWidgetTokens(workspaceId: string): Promise<WidgetTokenRecord[]> { return widgetOps.listWidgetTokens(this.deps, workspaceId); }
  async findWidgetTokenByHash(tokenHash: string): Promise<WidgetTokenRecord | null> { return widgetOps.findWidgetTokenByHash(this.deps, tokenHash); }
  async revokeWidgetToken(workspaceId: string, id: string): Promise<boolean> { return widgetOps.revokeWidgetToken(this.deps, workspaceId, id); }
  async createWahaSession(input: { workspaceId: string; name: string; engine?: string; }): Promise<WahaSessionRecord> { return wahaOps.createWahaSession(this.deps, input); }
  async listWahaSessions(workspaceId: string): Promise<WahaSessionRecord[]> { return wahaOps.listWahaSessions(this.deps, workspaceId); }
  async findWahaSessionById(workspaceId: string, id: string,): Promise<WahaSessionRecord | null> { return wahaOps.findWahaSessionById(this.deps, workspaceId, id); }
  async findWahaSessionByName(name: string): Promise<WahaSessionRecord | null> { return wahaOps.findWahaSessionByName(this.deps, name); }
  async updateWahaSession(workspaceId: string, id: string, patch: { status?: string; phone?: string | null },): Promise<WahaSessionRecord | null> { return wahaOps.updateWahaSession(this.deps, workspaceId, id, patch); }
  async claimIntakeEvent(input: { workspaceId: string; source: string; externalId: string; }): Promise<boolean> { return intakeOps.claimIntakeEvent(this.deps, input); }
  async linkIntakeEvent(input: { workspaceId: string; source: string; externalId: string; conversationId: string; messageId: string; }): Promise<void> { return intakeOps.linkIntakeEvent(this.deps, input); }
  async findContactByChannel(workspaceId: string, channel: string, value: string,): Promise<ContactRecord | null> { return intakeOps.findContactByChannel(this.deps, workspaceId, channel, value); }
  async findContactByAnyChannelValue(workspaceId: string, value: string,): Promise<ContactRecord | null> { return intakeOps.findContactByAnyChannelValue(this.deps, workspaceId, value); }
  async findActiveConversation(workspaceId: string, contactId: string, channel: string,): Promise<ConversationRecord | null> { return intakeOps.findActiveConversation(this.deps, workspaceId, contactId, channel); }
  async saveMetaConnection(input: { workspaceId: string; pageId: string; pageName?: string | null; igUserId?: string | null; accessTokenEnc: string; tokenExpiresAt?: string | null; status?: string; }): Promise<MetaConnectionRecord> { return metaOps.saveMetaConnection(this.deps, input); }
  async getMetaConnection(workspaceId: string): Promise<MetaConnectionRecord | null> { return metaOps.getMetaConnection(this.deps, workspaceId); }
  async deleteMetaConnection(workspaceId: string): Promise<boolean> { return metaOps.deleteMetaConnection(this.deps, workspaceId); }
  async findWorkspaceIdByMetaPage(pageId: string): Promise<string | null> { return metaOps.findWorkspaceIdByMetaPage(this.deps, pageId); }
  async createMailbox(input: { workspaceId: string; name: string; fromEmail: string; fromName?: string | null; smtpHost: string; smtpPort?: number; smtpUser: string; smtpPassEnc: string; imapHost: string; imapPort?: number; imapUser: string; imapPassEnc: string; }): Promise<MailboxRecord> { return mailOps.createMailbox(this.deps, input); }
  async listMailboxes(workspaceId: string): Promise<MailboxRecord[]> { return mailOps.listMailboxes(this.deps, workspaceId); }
  async findMailboxById(workspaceId: string, id: string): Promise<MailboxRecord | null> { return mailOps.findMailboxById(this.deps, workspaceId, id); }
  async updateMailbox(workspaceId: string, id: string, patch: { name?: string; fromName?: string | null; status?: string; lastUid?: string | null; smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPassEnc?: string; imapHost?: string; imapPort?: number; imapUser?: string; imapPassEnc?: string; },): Promise<MailboxRecord | null> { return mailOps.updateMailbox(this.deps, workspaceId, id, patch); }
  async deleteMailbox(workspaceId: string, id: string): Promise<boolean> { return mailOps.deleteMailbox(this.deps, workspaceId, id); }
  async enqueueOutbound(input: { workspaceId: string; channel: string; conversationId?: string | null; messageId?: string | null; mailboxId?: string | null; toValue: string; subject?: string | null; text?: string | null; }): Promise<OutboundRecord> { return outboundOps.enqueueOutbound(this.deps, input); }
  async listOutboundDue(workspaceId: string, nowIso: string, limit = 25,): Promise<OutboundRecord[]> { return outboundOps.listOutboundDue(this.deps, workspaceId, nowIso, limit); }
  async listOutbound(workspaceId: string, filter?: { status?: string },): Promise<OutboundRecord[]> { return outboundOps.listOutbound(this.deps, workspaceId, filter); }
  async markOutboundSent(workspaceId: string, id: string, providerMessageId: string | null,): Promise<OutboundRecord | null> { return outboundOps.markOutboundSent(this.deps, workspaceId, id, providerMessageId); }
  async markOutboundRetry(workspaceId: string, id: string, nextAttemptIso: string, error: string,): Promise<OutboundRecord | null> { return outboundOps.markOutboundRetry(this.deps, { workspaceId, id, nextAttemptIso, error }); }
  async markOutboundFailed(workspaceId: string, id: string, error: string,): Promise<OutboundRecord | null> { return outboundOps.markOutboundFailed(this.deps, workspaceId, id, error); }
  async createQueue(input: { workspaceId: string; name: string; channel?: string | null; isDefault?: boolean; }): Promise<QueueRecord> { return queuesOps.createQueue(this.deps, input); }
  async listQueues(workspaceId: string): Promise<QueueRecord[]> { return queuesOps.listQueues(this.deps, workspaceId); }
  async findQueueById(workspaceId: string, id: string): Promise<QueueRecord | null> { return queuesOps.findQueueById(this.deps, workspaceId, id); }
  async deleteQueue(workspaceId: string, id: string): Promise<boolean> { return queuesOps.deleteQueue(this.deps, workspaceId, id); }
  async addQueueMember(input: { workspaceId: string; queueId: string; userId: string }): Promise<void> { return queuesOps.addQueueMember(this.deps, input); }
  async removeQueueMember(workspaceId: string, queueId: string, userId: string): Promise<boolean> { return queuesOps.removeQueueMember(this.deps, workspaceId, queueId, userId); }
  async listQueueMembers(workspaceId: string, queueId: string): Promise<string[]> { return queuesOps.listQueueMembers(this.deps, workspaceId, queueId); }
  async enqueueTicket(input: { workspaceId: string; queueId: string; conversationId: string; channel: string; }): Promise<QueueTicketRecord> { return queuesOps.enqueueTicket(this.deps, input); }
  async listTickets(workspaceId: string, filter?: { queueId?: string; status?: string; assignedUserId?: string },): Promise<QueueTicketRecord[]> { return queuesOps.listTickets(this.deps, workspaceId, filter); }
  async findTicketById(workspaceId: string, id: string): Promise<QueueTicketRecord | null> { return queuesOps.findTicketById(this.deps, workspaceId, id); }
  async findOpenTicketByConversation(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> { return queuesOps.findOpenTicketByConversation(this.deps, workspaceId, conversationId); }
  async updateTicket(workspaceId: string, id: string, patch: { status?: TicketStatus; assignedUserId?: string | null; firstResponseAt?: string | null; resolvedAt?: string | null; },): Promise<QueueTicketRecord | null> { return queuesOps.updateTicket(this.deps, workspaceId, id, patch); }
  async markTicketFirstResponse(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> { return queuesOps.markTicketFirstResponse(this.deps, workspaceId, conversationId); }
  async resolveOpenTicketForConversation(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> { return queuesOps.resolveOpenTicketForConversation(this.deps, workspaceId, conversationId); }
  async getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettingsRecord | null> { return botOps.getWorkspaceSettings(this.deps, workspaceId); }
  async upsertWorkspaceSettings(input: { workspaceId: string; timezone?: string; absenceMessage?: string; businessHours?: BusinessHours; }): Promise<WorkspaceSettingsRecord> { return botOps.upsertWorkspaceSettings(this.deps, input); }
  async createBotRule(input: { workspaceId: string; name: string; kind: BotRuleKind; priority?: number; active?: boolean; terms?: string[]; reply?: string | null; options?: BotMenuOption[]; queueId?: string | null; }): Promise<BotRuleRecord> { return botOps.createBotRule(this.deps, input); }
  async listBotRules(workspaceId: string): Promise<BotRuleRecord[]> { return botOps.listBotRules(this.deps, workspaceId); }
  async updateBotRule(workspaceId: string, id: string, patch: Partial<{ name: string; priority: number; active: boolean; terms: string[]; reply: string | null; options: BotMenuOption[]; queueId: string | null; }>,): Promise<BotRuleRecord | null> { return botOps.updateBotRule(this.deps, workspaceId, id, patch); }
  async deleteBotRule(workspaceId: string, id: string): Promise<boolean> { return botOps.deleteBotRule(this.deps, workspaceId, id); }
  async getBotSession(workspaceId: string, conversationId: string): Promise<BotSessionRecord | null> { return botOps.getBotSession(this.deps, workspaceId, conversationId); }
  async setBotSession(input: { workspaceId: string; conversationId: string; state: BotSessionState; }): Promise<BotSessionRecord> { return botOps.setBotSession(this.deps, input); }

}

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

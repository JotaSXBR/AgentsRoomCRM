import { Pool, type PoolClient } from "pg";
import { setWorkspaceContextSql } from "@agentsroom/db";
import type {
  ApiKeyScope,
  BotMenuOption,
  BotRuleKind,
  BotRuleRecord,
  BotSessionRecord,
  BotSessionState,
  BusinessHours,
  ConsentKind,
  ContactChannelRecord,
  ContactEventRecord,
  ContactRecord,
  ConversationRecord,
  ConversationStatus,
  InviteRecord,
  MailboxRecord,
  MembershipRecord,
  FlowAction,
  MemberWithUser,
  MessageRecord,
  MetaConnectionRecord,
  NoteRecord,
  OutboundRecord,
  QueueRecord,
  QueueTicketRecord,
  RatingSource,
  Store,
  TagRecord,
  TicketStatus,
  UserRecord,
  WahaSessionRecord,
  WebhookDeliveryStatus,
  WidgetTokenRecord,
  WorkspaceRecord,
  WorkspaceSettingsRecord,
  WorkspaceUpdates,
} from "./store.js";
import * as botOps from "./postgres/bot.js";
import * as aiOps from "./postgres/ai.js";
import * as f5Ops from "./postgres/f5.js";
import * as f5LgpdOps from "./postgres/f5lgpd.js";
import * as f5FlowsOps from "./postgres/f5flows.js";
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
  async getAiSettings(workspaceId: string) { return aiOps.getAiSettings(this.deps, workspaceId); }
  async upsertAiSettings(input: { workspaceId: string; enabled?: boolean; systemPrompt?: string; fallbackMessage?: string; maxChunks?: number }) { return aiOps.upsertAiSettings(this.deps, input); }
  async getAiProvider(workspaceId: string) { return aiOps.getAiProvider(this.deps, workspaceId); }
  async upsertAiProvider(input: { workspaceId: string; kind: import("./store.js").AiProviderKind; baseUrl: string; model: string; apiKeyEnc?: string | null; priceInputPerMtok?: number | null; priceOutputPerMtok?: number | null }) { return aiOps.upsertAiProvider(this.deps, input); }
  async deleteAiProvider(workspaceId: string) { return aiOps.deleteAiProvider(this.deps, workspaceId); }
  async createKnowledgeSource(input: { workspaceId: string; kind: import("./store.js").AiKnowledgeKind; title: string; content?: string | null; url?: string | null; status?: import("./store.js").AiKnowledgeStatus; error?: string | null }) { return aiOps.createKnowledgeSource(this.deps, input); }
  async listKnowledgeSources(workspaceId: string) { return aiOps.listKnowledgeSources(this.deps, workspaceId); }
  async findKnowledgeSource(workspaceId: string, id: string) { return aiOps.findKnowledgeSource(this.deps, workspaceId, id); }
  async updateKnowledgeSource(workspaceId: string, id: string, patch: Parameters<typeof aiOps.updateKnowledgeSource>[3]) { return aiOps.updateKnowledgeSource(this.deps, workspaceId, id, patch); }
  async deleteKnowledgeSource(workspaceId: string, id: string) { return aiOps.deleteKnowledgeSource(this.deps, workspaceId, id); }
  async replaceKnowledgeChunks(workspaceId: string, sourceId: string, chunks: string[]) { return aiOps.replaceKnowledgeChunks(this.deps, workspaceId, sourceId, chunks); }
  async listKnowledgeChunks(workspaceId: string) { return aiOps.listKnowledgeChunks(this.deps, workspaceId); }
  async addAiLog(input: Parameters<typeof aiOps.addAiLog>[1]) { return aiOps.addAiLog(this.deps, input); }
  async listAiLogs(workspaceId: string, limit?: number) { return aiOps.listAiLogs(this.deps, workspaceId, limit); }
  // ---- F5: API pública, webhooks, CSAT, LGPD, fluxos e módulos ----
  async createApiKey(input: { workspaceId: string; name: string; prefix: string; keyHash: string; scopes?: ApiKeyScope[]; createdBy?: string | null }) { return f5Ops.createApiKey(this.deps, input); }
  async listApiKeys(workspaceId: string) { return f5Ops.listApiKeys(this.deps, workspaceId); }
  async findApiKeyByHash(keyHash: string) { return f5Ops.findApiKeyByHash(this.deps, keyHash); }
  async touchApiKey(workspaceId: string, id: string) { return f5Ops.touchApiKey(this.deps, workspaceId, id); }
  async revokeApiKey(workspaceId: string, id: string) { return f5Ops.revokeApiKey(this.deps, workspaceId, id); }
  async createWebhookEndpoint(input: { workspaceId: string; name: string; url: string; secret: string; events?: string[] }) { return f5Ops.createWebhookEndpoint(this.deps, input); }
  async listWebhookEndpoints(workspaceId: string) { return f5Ops.listWebhookEndpoints(this.deps, workspaceId); }
  async findWebhookEndpoint(workspaceId: string, id: string) { return f5Ops.findWebhookEndpoint(this.deps, workspaceId, id); }
  async deleteWebhookEndpoint(workspaceId: string, id: string) { return f5Ops.deleteWebhookEndpoint(this.deps, workspaceId, id); }
  async enqueueWebhookDelivery(input: { workspaceId: string; endpointId: string; event: string; payload: Record<string, unknown>; nextAttemptAt?: string }) { return f5Ops.enqueueWebhookDelivery(this.deps, input); }
  async listWebhookDeliveries(workspaceId: string, filter?: { endpointId?: string; status?: WebhookDeliveryStatus }) { return f5Ops.listWebhookDeliveries(this.deps, workspaceId, filter); }
  async markWebhookDelivery(workspaceId: string, id: string, patch: { status?: WebhookDeliveryStatus; attempts?: number; nextAttemptAt?: string; responseCode?: number | null; lastError?: string | null }) { return f5Ops.markWebhookDelivery(this.deps, workspaceId, id, patch); }
  async rateConversation(input: { workspaceId: string; conversationId: string; score: number; comment?: string | null; source?: RatingSource; ratedBy?: string | null }) { return f5LgpdOps.rateConversation(this.deps, input); }
  async findRating(workspaceId: string, conversationId: string) { return f5LgpdOps.findRating(this.deps, workspaceId, conversationId); }
  async listRatings(workspaceId: string, options?: { conversationIds?: string[] }) { return f5LgpdOps.listRatings(this.deps, workspaceId, options); }
  async setConsent(input: { workspaceId: string; contactId: string; kind: ConsentKind; granted: boolean; source?: string; note?: string | null }) { return f5LgpdOps.setConsent(this.deps, input); }
  async listConsents(workspaceId: string, filter?: { contactId?: string; kind?: ConsentKind }) { return f5LgpdOps.listConsents(this.deps, workspaceId, filter); }
  async addLgpdRequest(input: { workspaceId: string; contactId?: string | null; scope: "contato" | "workspace"; action: "acesso" | "exclusao"; status?: "concluido" | "parcial"; summary: Record<string, unknown>; requestedBy?: string | null }) { return f5LgpdOps.addLgpdRequest(this.deps, input); }
  async listLgpdRequests(workspaceId: string) { return f5LgpdOps.listLgpdRequests(this.deps, workspaceId); }
  async purgeContactData(workspaceId: string, contactId: string) { return f5LgpdOps.purgeContactData(this.deps, workspaceId, contactId); }
  async purgeWorkspaceContacts(workspaceId: string) { return f5LgpdOps.purgeWorkspaceContacts(this.deps, workspaceId); }
  async createFlow(input: { workspaceId: string; name: string; terms?: string[]; active?: boolean; steps: Array<{ action: FlowAction; payload: Record<string, unknown> }> }) { return f5FlowsOps.createFlow(this.deps, input); }
  async listFlows(workspaceId: string) { return f5FlowsOps.listFlows(this.deps, workspaceId); }
  async findFlowById(workspaceId: string, id: string) { return f5FlowsOps.findFlowById(this.deps, workspaceId, id); }
  async setFlowActive(workspaceId: string, id: string, active: boolean) { return f5FlowsOps.setFlowActive(this.deps, workspaceId, id, active); }
  async deleteFlow(workspaceId: string, id: string) { return f5FlowsOps.deleteFlow(this.deps, workspaceId, id); }
  async listWorkspaceModules(workspaceId: string) { return f5FlowsOps.listWorkspaceModules(this.deps, workspaceId); }
  async setWorkspaceModule(input: { workspaceId: string; moduleKey: string; enabled?: boolean; config?: Record<string, unknown> }) { return f5FlowsOps.setWorkspaceModule(this.deps, input); }
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

import { randomUUID } from "node:crypto";
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

function now(): string {
  return new Date().toISOString();
}

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
  readonly conversationTags = new Map<string, { conversationId: string; tagId: string }>();
  readonly conversations = new Map<string, ConversationRecord>();
  readonly messages = new Map<string, MessageRecord>();
  readonly notes = new Map<string, NoteRecord>();
  readonly widgetTokens = new Map<string, WidgetTokenRecord>();
  readonly wahaSessions = new Map<string, WahaSessionRecord>();
  readonly intakeEvents = new Map<string, {
    workspaceId: string;
    source: string;
    externalId: string;
    conversationId: string | null;
    messageId: string | null;
  }>();
  readonly metaConnections = new Map<string, MetaConnectionRecord>();
  readonly metaPageIndex = new Map<string, string>();
  readonly mailboxes = new Map<string, MailboxRecord>();
  readonly outboundQueue = new Map<string, OutboundRecord>();

  private membershipKey(workspaceId: string, userId: string): string {
    return `${workspaceId}:${userId}`;
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async createUser(input: {
    email: string;
    passwordHash: string;
    name: string;
    isOwnerGlobal: boolean;
  }): Promise<UserRecord> {
    const email = input.email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === email) throw new Error("email_em_uso");
    }
    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: input.passwordHash,
      name: input.name,
      isOwnerGlobal: input.isOwnerGlobal,
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const target = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === target) return user;
    }
    return null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createWorkspace(input: {
    name: string;
    slug: string;
  }): Promise<WorkspaceRecord> {
    for (const ws of this.workspaces.values()) {
      if (ws.slug === input.slug) throw new Error("slug_em_uso");
    }
    const ws: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      createdAt: now(),
    };
    this.workspaces.set(ws.id, ws);
    return ws;
  }

  async findWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(id) ?? null;
  }

  async findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> {
    for (const ws of this.workspaces.values()) {
      if (ws.slug === slug) return ws;
    }
    return null;
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return [...this.workspaces.values()];
  }

  async addMember(input: {
    workspaceId: string;
    userId: string;
    role: MembershipRecord["role"];
  }): Promise<MembershipRecord> {
    const existing = await this.findMembership(input.workspaceId, input.userId);
    if (existing) {
      const updated = { ...existing, role: input.role };
      this.memberships.set(
        this.membershipKey(input.workspaceId, input.userId),
        updated,
      );
      return updated;
    }
    const record: MembershipRecord = { ...input, createdAt: now() };
    this.memberships.set(
      this.membershipKey(input.workspaceId, input.userId),
      record,
    );
    return record;
  }

  async findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipRecord | null> {
    return this.memberships.get(this.membershipKey(workspaceId, userId)) ?? null;
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    const out: MemberWithUser[] = [];
    for (const m of this.memberships.values()) {
      if (m.workspaceId !== workspaceId) continue;
      const user = this.users.get(m.userId);
      if (!user) continue;
      out.push({ ...m, email: user.email, name: user.name });
    }
    return out;
  }

  async listMembershipsByUser(userId: string): Promise<MembershipRecord[]> {
    return [...this.memberships.values()].filter((m) => m.userId === userId);
  }

  async createInvite(input: {
    workspaceId: string;
    email: string;
    role: InviteRecord["role"];
    tokenHash: string;
    expiresAt: string;
    createdBy: string;
  }): Promise<InviteRecord> {
    const invite: InviteRecord = {
      id: randomUUID(),
      ...input,
      email: input.email.toLowerCase(),
      acceptedAt: null,
      createdAt: now(),
    };
    this.invites.set(invite.id, invite);
    return invite;
  }

  async findInviteByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    for (const invite of this.invites.values()) {
      if (invite.tokenHash === tokenHash) return invite;
    }
    return null;
  }

  async markInviteAccepted(id: string, _workspaceId: string): Promise<void> {
    const invite = this.invites.get(id);
    if (invite) this.invites.set(id, { ...invite, acceptedAt: now() });
  }

  async createContact(input: {
    workspaceId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  }): Promise<ContactRecord> {
    const contact: ContactRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      mergedIntoId: null,
      createdAt: now(),
    };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async listContacts(
    workspaceId: string,
    query?: { q?: string },
  ): Promise<ContactRecord[]> {
    const q = query?.q?.trim().toLowerCase();
    return [...this.contacts.values()].filter((c) => {
      if (c.workspaceId !== workspaceId || c.mergedIntoId !== null) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
      );
    });
  }

  async findContactById(
    workspaceId: string,
    id: string,
  ): Promise<ContactRecord | null> {
    const c = this.contacts.get(id);
    return c && c.workspaceId === workspaceId ? c : null;
  }

  async addContactChannel(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    value: string;
  }): Promise<ContactChannelRecord> {
    const record: ContactChannelRecord = {
      id: randomUUID(),
      ...input,
      createdAt: now(),
    };
    this.contactChannels.set(record.id, record);
    return record;
  }

  async listContactChannels(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactChannelRecord[]> {
    return [...this.contactChannels.values()].filter(
      (c) => c.workspaceId === workspaceId && c.contactId === contactId,
    );
  }

  private assertMergeable(
    workspaceId: string,
    sourceId: string,
    targetId: string,
  ): { source: ContactRecord; target: ContactRecord } {
    const source = this.contacts.get(sourceId);
    const target = this.contacts.get(targetId);
    if (
      !source ||
      !target ||
      source.workspaceId !== workspaceId ||
      target.workspaceId !== workspaceId ||
      source.id === target.id
    ) {
      throw new Error("merge_invalido");
    }
    return { source, target };
  }

  private reassignMergeRefs(workspaceId: string, sourceId: string, targetId: string): void {
    for (const ch of this.contactChannels.values()) {
      if (ch.workspaceId === workspaceId && ch.contactId === sourceId) {
        this.contactChannels.set(ch.id, { ...ch, contactId: targetId });
      }
    }
    for (const conv of this.conversations.values()) {
      if (conv.workspaceId === workspaceId && conv.contactId === sourceId) {
        this.conversations.set(conv.id, { ...conv, contactId: targetId, updatedAt: now() });
      }
    }
    for (const ev of this.contactEvents.values()) {
      if (ev.workspaceId === workspaceId && ev.contactId === sourceId) {
        this.contactEvents.set(ev.id, { ...ev, contactId: targetId });
      }
    }
  }

  async mergeContacts(
    workspaceId: string,
    sourceId: string,
    targetId: string,
  ): Promise<ContactRecord> {
    const { source, target } = this.assertMergeable(workspaceId, sourceId, targetId);
    this.reassignMergeRefs(workspaceId, sourceId, targetId);
    this.contacts.set(sourceId, { ...source, mergedIntoId: targetId });
    await this.addContactEvent({
      workspaceId,
      contactId: targetId,
      kind: "merge",
      description: `Contato ${source.name} unificado em ${target.name}.`,
    });
    return target;
  }

  async contactTimeline(
    workspaceId: string,
    contactId: string,
  ): Promise<ContactEventRecord[]> {
    return [...this.contactEvents.values()]
      .filter((e) => e.workspaceId === workspaceId && e.contactId === contactId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addContactEvent(input: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    kind: string;
    actorId?: string | null;
    description: string;
  }): Promise<ContactEventRecord> {
    const record: ContactEventRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      kind: input.kind,
      actorId: input.actorId ?? null,
      description: input.description,
      createdAt: now(),
    };
    this.contactEvents.set(record.id, record);
    return record;
  }

  async createTag(input: {
    workspaceId: string;
    name: string;
    color?: string | null;
  }): Promise<TagRecord> {
    const tag: TagRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      color: input.color ?? null,
      createdAt: now(),
    };
    this.tags.set(tag.id, tag);
    return tag;
  }

  async listTags(workspaceId: string): Promise<TagRecord[]> {
    return [...this.tags.values()].filter((t) => t.workspaceId === workspaceId);
  }

  async tagConversation(
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    const conv = this.conversations.get(conversationId);
    const tag = this.tags.get(tagId);
    if (!conv || conv.workspaceId !== workspaceId || !tag || tag.workspaceId !== workspaceId) {
      throw new Error("tag_invalida");
    }
    this.conversationTags.set(`${conversationId}:${tagId}`, { conversationId, tagId });
  }

  async untagConversation(
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    this.conversationTags.delete(`${conversationId}:${tagId}`);
  }

  async listConversationTags(
    workspaceId: string,
    conversationId: string,
  ): Promise<TagRecord[]> {
    const out: TagRecord[] = [];
    for (const link of this.conversationTags.values()) {
      if (link.conversationId !== conversationId) continue;
      const tag = this.tags.get(link.tagId);
      if (tag && tag.workspaceId === workspaceId) out.push(tag);
    }
    return out;
  }

  async createConversation(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    subject?: string | null;
  }): Promise<ConversationRecord> {
    const contact = this.contacts.get(input.contactId);
    if (!contact || contact.workspaceId !== input.workspaceId) {
      throw new Error("contato_invalido");
    }
    const conv: ConversationRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      channel: input.channel,
      status: "aberto",
      assigneeId: null,
      subject: input.subject ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.conversations.set(conv.id, conv);
    return conv;
  }

  async findConversationById(
    workspaceId: string,
    id: string,
  ): Promise<ConversationRecord | null> {
    const c = this.conversations.get(id);
    return c && c.workspaceId === workspaceId ? c : null;
  }

  private matchesFacets(
    c: ConversationRecord,
    filter: { status?: ConversationStatus; assigneeId?: string; tagId?: string } | undefined,
    taggedIds: Set<string>,
  ): boolean {
    if (filter?.status && c.status !== filter.status) return false;
    if (filter?.assigneeId && c.assigneeId !== filter.assigneeId) return false;
    if (filter?.tagId && !taggedIds.has(c.id)) return false;
    return true;
  }

  private matchesQuery(c: ConversationRecord, q: string | undefined): boolean {
    if (!q) return true;
    const contact = this.contacts.get(c.contactId);
    const hay = `${c.subject ?? ""} ${contact?.name ?? ""}`.toLowerCase();
    return hay.includes(q);
  }

  async listConversations(
    workspaceId: string,
    filter?: {
      status?: ConversationStatus;
      assigneeId?: string;
      tagId?: string;
      q?: string;
    },
  ): Promise<ConversationRecord[]> {
    const q = filter?.q?.trim().toLowerCase();
    const taggedIds = new Set<string>();
    if (filter?.tagId) {
      for (const link of this.conversationTags.values()) {
        if (link.tagId === filter.tagId) taggedIds.add(link.conversationId);
      }
    }
    return [...this.conversations.values()]
      .filter((c) => {
        if (c.workspaceId !== workspaceId) return false;
        if (!this.matchesFacets(c, filter, taggedIds)) return false;
        return this.matchesQuery(c, q);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async setConversationStatus(
    workspaceId: string,
    id: string,
    status: ConversationStatus,
  ): Promise<ConversationRecord | null> {
    const conv = this.conversations.get(id);
    if (!conv || conv.workspaceId !== workspaceId) return null;
    const updated = { ...conv, status, updatedAt: now() };
    this.conversations.set(id, updated);
    return updated;
  }

  async assignConversation(
    workspaceId: string,
    id: string,
    assigneeId: string | null,
  ): Promise<ConversationRecord | null> {
    const conv = this.conversations.get(id);
    if (!conv || conv.workspaceId !== workspaceId) return null;
    if (assigneeId !== null) {
      const membership = await this.findMembership(workspaceId, assigneeId);
      if (!membership) throw new Error("assignee_invalido");
    }
    const updated = { ...conv, assigneeId, updatedAt: now() };
    this.conversations.set(id, updated);
    return updated;
  }

  async addMessage(input: {
    workspaceId: string;
    conversationId: string;
    direction: MessageRecord["direction"];
    authorId?: string | null;
    kind?: MessageRecord["kind"];
    text?: string | null;
    mediaUrl?: string | null;
  }): Promise<MessageRecord> {
    const conv = this.conversations.get(input.conversationId);
    if (!conv || conv.workspaceId !== input.workspaceId) {
      throw new Error("conversa_invalida");
    }
    const msg: MessageRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      direction: input.direction,
      authorId: input.authorId ?? null,
      kind: input.kind ?? "texto",
      text: input.text ?? null,
      mediaUrl: input.mediaUrl ?? null,
      createdAt: now(),
    };
    this.messages.set(msg.id, msg);
    this.conversations.set(conv.id, { ...conv, updatedAt: now() });
    return msg;
  }

  async listMessages(
    workspaceId: string,
    conversationId: string,
    options?: { since?: string },
  ): Promise<MessageRecord[]> {
    return [...this.messages.values()]
      .filter(
        (m) =>
          m.workspaceId === workspaceId &&
          m.conversationId === conversationId &&
          (!options?.since || m.createdAt > options.since),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addNote(input: {
    workspaceId: string;
    conversationId: string;
    authorId: string;
    content: string;
  }): Promise<NoteRecord> {
    const conv = this.conversations.get(input.conversationId);
    if (!conv || conv.workspaceId !== input.workspaceId) {
      throw new Error("conversa_invalida");
    }
    const note: NoteRecord = { id: randomUUID(), ...input, createdAt: now() };
    this.notes.set(note.id, note);
    return note;
  }

  async listNotes(
    workspaceId: string,
    conversationId: string,
  ): Promise<NoteRecord[]> {
    return [...this.notes.values()]
      .filter((n) => n.workspaceId === workspaceId && n.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listUpdates(workspaceId: string, since: string): Promise<WorkspaceUpdates> {
    const conversations = [...this.conversations.values()].filter(
      (c) => c.workspaceId === workspaceId && c.updatedAt > since,
    );
    const messages = [...this.messages.values()].filter(
      (m) => m.workspaceId === workspaceId && m.createdAt > since,
    );
    const notes = [...this.notes.values()].filter(
      (n) => n.workspaceId === workspaceId && n.createdAt > since,
    );
    return { conversations, messages, notes };
  }

  async createWidgetToken(input: {
    workspaceId: string;
    name: string;
    tokenHash: string;
  }): Promise<WidgetTokenRecord> {
    const record: WidgetTokenRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      tokenHash: input.tokenHash,
      revokedAt: null,
      createdAt: now(),
    };
    this.widgetTokens.set(record.id, record);
    return record;
  }

  async listWidgetTokens(workspaceId: string): Promise<WidgetTokenRecord[]> {
    return [...this.widgetTokens.values()].filter(
      (t) => t.workspaceId === workspaceId,
    );
  }

  async findWidgetTokenByHash(tokenHash: string): Promise<WidgetTokenRecord | null> {
    for (const t of this.widgetTokens.values()) {
      if (t.tokenHash === tokenHash) return t;
    }
    return null;
  }

  async revokeWidgetToken(workspaceId: string, id: string): Promise<boolean> {
    const t = this.widgetTokens.get(id);
    if (!t || t.workspaceId !== workspaceId || t.revokedAt) return false;
    this.widgetTokens.set(id, { ...t, revokedAt: now() });
    return true;
  }

  async createWahaSession(input: {
    workspaceId: string;
    name: string;
    engine?: string;
  }): Promise<WahaSessionRecord> {
    for (const s of this.wahaSessions.values()) {
      if (s.name === input.name) throw new Error("session_nome_em_uso");
    }
    const record: WahaSessionRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      engine: input.engine ?? "GOWS",
      status: "criada",
      phone: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.wahaSessions.set(record.id, record);
    return record;
  }

  async listWahaSessions(workspaceId: string): Promise<WahaSessionRecord[]> {
    return [...this.wahaSessions.values()].filter(
      (s) => s.workspaceId === workspaceId,
    );
  }

  async findWahaSessionById(
    workspaceId: string,
    id: string,
  ): Promise<WahaSessionRecord | null> {
    const s = this.wahaSessions.get(id);
    return s && s.workspaceId === workspaceId ? s : null;
  }

  async findWahaSessionByName(name: string): Promise<WahaSessionRecord | null> {
    for (const s of this.wahaSessions.values()) {
      if (s.name === name) return s;
    }
    return null;
  }

  async updateWahaSession(
    workspaceId: string,
    id: string,
    patch: { status?: string; phone?: string | null },
  ): Promise<WahaSessionRecord | null> {
    const s = this.wahaSessions.get(id);
    if (!s || s.workspaceId !== workspaceId) return null;
    const updated = {
      ...s,
      status: patch.status ?? s.status,
      phone: patch.phone !== undefined ? patch.phone : s.phone,
      updatedAt: now(),
    };
    this.wahaSessions.set(id, updated);
    return updated;
  }

  async claimIntakeEvent(input: {
    workspaceId: string;
    source: string;
    externalId: string;
  }): Promise<boolean> {
    const key = `${input.workspaceId}:${input.source}:${input.externalId}`;
    if (this.intakeEvents.has(key)) return false;
    this.intakeEvents.set(key, {
      workspaceId: input.workspaceId,
      source: input.source,
      externalId: input.externalId,
      conversationId: null,
      messageId: null,
    });
    return true;
  }

  async linkIntakeEvent(input: {
    workspaceId: string;
    source: string;
    externalId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void> {
    const key = `${input.workspaceId}:${input.source}:${input.externalId}`;
    const event = this.intakeEvents.get(key);
    if (event) {
      this.intakeEvents.set(key, {
        ...event,
        conversationId: input.conversationId,
        messageId: input.messageId,
      });
    }
  }

  async findContactByChannel(
    workspaceId: string,
    channel: string,
    value: string,
  ): Promise<ContactRecord | null> {
    for (const ch of this.contactChannels.values()) {
      if (ch.workspaceId !== workspaceId || ch.channel !== channel || ch.value !== value) {
        continue;
      }
      const contact = this.contacts.get(ch.contactId);
      if (contact && contact.workspaceId === workspaceId && !contact.mergedIntoId) {
        return contact;
      }
    }
    return null;
  }

  async findContactByAnyChannelValue(
    workspaceId: string,
    value: string,
  ): Promise<ContactRecord | null> {
    for (const ch of this.contactChannels.values()) {
      if (ch.workspaceId !== workspaceId || ch.value !== value) continue;
      const contact = this.contacts.get(ch.contactId);
      if (contact && contact.workspaceId === workspaceId && !contact.mergedIntoId) {
        return contact;
      }
    }
    return null;
  }

  async findActiveConversation(
    workspaceId: string,
    contactId: string,
    channel: string,
  ): Promise<ConversationRecord | null> {
    const candidates = [...this.conversations.values()]
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

  // ---- F2b: Meta oficial ----

  private assertPageFree(pageId: string, workspaceId: string): void {
    const owner = this.metaPageIndex.get(pageId);
    if (owner && owner !== workspaceId) {
      throw new Error("pagina_em_uso");
    }
  }

  private releaseOldPages(workspaceId: string, pageId: string): void {
    // Página trocada? Remove o mapeamento antigo do workspace.
    for (const [oldPageId, wsId] of this.metaPageIndex) {
      if (wsId === workspaceId && oldPageId !== pageId) {
        this.metaPageIndex.delete(oldPageId);
      }
    }
  }

  private pick<T>(primary: T | null | undefined, secondary: T | null | undefined, fallback: T): T {
    return primary ?? secondary ?? fallback;
  }

  private buildMetaRecord(
    existing: MetaConnectionRecord | undefined,
    input: {
      workspaceId: string;
      pageId: string;
      pageName?: string | null;
      igUserId?: string | null;
      accessTokenEnc: string;
      tokenExpiresAt?: string | null;
      status?: string;
    },
  ): MetaConnectionRecord {
    return {
      id: existing?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      pageName: this.pick(input.pageName, existing?.pageName, null),
      igUserId: this.pick(input.igUserId, existing?.igUserId, null),
      accessTokenEnc: input.accessTokenEnc,
      tokenExpiresAt: this.pick(input.tokenExpiresAt, existing?.tokenExpiresAt, null),
      status: this.pick(input.status, existing?.status, "conectada"),
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
  }

  async saveMetaConnection(input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  }): Promise<MetaConnectionRecord> {
    this.assertPageFree(input.pageId, input.workspaceId);
    this.releaseOldPages(input.workspaceId, input.pageId);
    this.metaPageIndex.set(input.pageId, input.workspaceId);
    const record = this.buildMetaRecord(this.metaConnections.get(input.workspaceId), input);
    this.metaConnections.set(input.workspaceId, record);
    return record;
  }

  async getMetaConnection(workspaceId: string): Promise<MetaConnectionRecord | null> {
    return this.metaConnections.get(workspaceId) ?? null;
  }

  async deleteMetaConnection(workspaceId: string): Promise<boolean> {
    const existing = this.metaConnections.get(workspaceId);
    if (!existing) return false;
    this.metaConnections.delete(workspaceId);
    for (const [pageId, wsId] of this.metaPageIndex) {
      if (wsId === workspaceId) this.metaPageIndex.delete(pageId);
    }
    return true;
  }

  async findWorkspaceIdByMetaPage(pageId: string): Promise<string | null> {
    return this.metaPageIndex.get(pageId) ?? null;
  }

  // ---- F2b: mailboxes ----

  async createMailbox(input: {
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
  }): Promise<MailboxRecord> {
    const record: MailboxRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      fromEmail: input.fromEmail.toLowerCase(),
      fromName: input.fromName ?? null,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort ?? 587,
      smtpUser: input.smtpUser,
      smtpPassEnc: input.smtpPassEnc,
      imapHost: input.imapHost,
      imapPort: input.imapPort ?? 993,
      imapUser: input.imapUser,
      imapPassEnc: input.imapPassEnc,
      lastUid: null,
      status: "ativa",
      createdAt: now(),
      updatedAt: now(),
    };
    this.mailboxes.set(record.id, record);
    return record;
  }

  async listMailboxes(workspaceId: string): Promise<MailboxRecord[]> {
    return [...this.mailboxes.values()]
      .filter((m) => m.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findMailboxById(workspaceId: string, id: string): Promise<MailboxRecord | null> {
    const m = this.mailboxes.get(id);
    return m && m.workspaceId === workspaceId ? m : null;
  }

  private applyMailboxPatch(
    m: MailboxRecord,
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
  ): MailboxRecord {
    return {
      ...m,
      name: this.pick(patch.name, m.name, m.name),
      fromName: patch.fromName !== undefined ? patch.fromName : m.fromName,
      status: this.pick(patch.status, m.status, m.status),
      lastUid: patch.lastUid !== undefined ? patch.lastUid : m.lastUid,
      smtpHost: this.pick(patch.smtpHost, m.smtpHost, m.smtpHost),
      smtpPort: this.pick(patch.smtpPort, m.smtpPort, m.smtpPort),
      smtpUser: this.pick(patch.smtpUser, m.smtpUser, m.smtpUser),
      smtpPassEnc: this.pick(patch.smtpPassEnc, m.smtpPassEnc, m.smtpPassEnc),
      imapHost: this.pick(patch.imapHost, m.imapHost, m.imapHost),
      imapPort: this.pick(patch.imapPort, m.imapPort, m.imapPort),
      imapUser: this.pick(patch.imapUser, m.imapUser, m.imapUser),
      imapPassEnc: this.pick(patch.imapPassEnc, m.imapPassEnc, m.imapPassEnc),
      updatedAt: now(),
    };
  }

  async updateMailbox(
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
  ): Promise<MailboxRecord | null> {
    const m = this.mailboxes.get(id);
    if (!m || m.workspaceId !== workspaceId) return null;
    const updated = this.applyMailboxPatch(m, patch);
    this.mailboxes.set(id, updated);
    return updated;
  }

  async deleteMailbox(workspaceId: string, id: string): Promise<boolean> {
    const m = this.mailboxes.get(id);
    if (!m || m.workspaceId !== workspaceId) return false;
    this.mailboxes.delete(id);
    return true;
  }

  // ---- F2b: fila de saída ----

  async enqueueOutbound(input: {
    workspaceId: string;
    channel: string;
    conversationId?: string | null;
    messageId?: string | null;
    mailboxId?: string | null;
    toValue: string;
    subject?: string | null;
    text?: string | null;
  }): Promise<OutboundRecord> {
    const record: OutboundRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      channel: input.channel,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      mailboxId: input.mailboxId ?? null,
      toValue: input.toValue,
      subject: input.subject ?? null,
      text: input.text ?? null,
      status: "pendente",
      attempts: 0,
      nextAttemptAt: now(),
      lastError: null,
      providerMessageId: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.outboundQueue.set(record.id, record);
    return record;
  }

  async listOutboundDue(
    workspaceId: string,
    nowIso: string,
    limit = 25,
  ): Promise<OutboundRecord[]> {
    return [...this.outboundQueue.values()]
      .filter(
        (o) =>
          o.workspaceId === workspaceId &&
          o.status === "pendente" &&
          o.nextAttemptAt <= nowIso,
      )
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, limit);
  }

  async listOutbound(
    workspaceId: string,
    filter?: { status?: string },
  ): Promise<OutboundRecord[]> {
    return [...this.outboundQueue.values()]
      .filter(
        (o) =>
          o.workspaceId === workspaceId &&
          (!filter?.status || o.status === filter.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }

  async markOutboundSent(
    workspaceId: string,
    id: string,
    providerMessageId: string | null,
  ): Promise<OutboundRecord | null> {
    const o = this.outboundQueue.get(id);
    if (!o || o.workspaceId !== workspaceId) return null;
    const updated: OutboundRecord = {
      ...o,
      status: "enviado",
      providerMessageId,
      lastError: null,
      updatedAt: now(),
    };
    this.outboundQueue.set(id, updated);
    return updated;
  }

  async markOutboundRetry(
    workspaceId: string,
    id: string,
    nextAttemptIso: string,
    error: string,
  ): Promise<OutboundRecord | null> {
    const o = this.outboundQueue.get(id);
    if (!o || o.workspaceId !== workspaceId) return null;
    const updated: OutboundRecord = {
      ...o,
      status: "pendente",
      attempts: o.attempts + 1,
      nextAttemptAt: nextAttemptIso,
      lastError: error.slice(0, 500),
      updatedAt: now(),
    };
    this.outboundQueue.set(id, updated);
    return updated;
  }

  async markOutboundFailed(
    workspaceId: string,
    id: string,
    error: string,
  ): Promise<OutboundRecord | null> {
    const o = this.outboundQueue.get(id);
    if (!o || o.workspaceId !== workspaceId) return null;
    const updated: OutboundRecord = {
      ...o,
      status: "falhou",
      attempts: o.attempts + 1,
      lastError: error.slice(0, 500),
      updatedAt: now(),
    };
    this.outboundQueue.set(id, updated);
    return updated;
  }

  // ---- F3: settings ----
  readonly workspaceSettings = new Map<string, WorkspaceSettingsRecord>();
  readonly queues = new Map<string, QueueRecord>();
  readonly queueMembers = new Map<string, { workspaceId: string; queueId: string; userId: string; createdAt: string }>();
  readonly tickets = new Map<string, QueueTicketRecord>();
  readonly botRules = new Map<string, BotRuleRecord>();
  readonly botSessions = new Map<string, BotSessionRecord>();

  async getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettingsRecord | null> {
    return this.workspaceSettings.get(workspaceId) ?? null;
  }

  async upsertWorkspaceSettings(input: {
    workspaceId: string;
    timezone?: string;
    absenceMessage?: string;
    businessHours?: BusinessHours;
  }): Promise<WorkspaceSettingsRecord> {
    const current = this.workspaceSettings.get(input.workspaceId);
    const record: WorkspaceSettingsRecord = {
      workspaceId: input.workspaceId,
      timezone: input.timezone ?? current?.timezone ?? "America/Sao_Paulo",
      absenceMessage:
        input.absenceMessage ??
        current?.absenceMessage ??
        "Olá! Estamos fora do horário de atendimento no momento. Deixe sua mensagem que retornaremos em breve.",
      businessHours: input.businessHours ?? current?.businessHours ?? {},
      updatedAt: now(),
    };
    this.workspaceSettings.set(input.workspaceId, record);
    return record;
  }

  // ---- F3: filas ----
  async createQueue(input: {
    workspaceId: string;
    name: string;
    channel?: string | null;
    isDefault?: boolean;
  }): Promise<QueueRecord> {
    for (const q of this.queues.values()) {
      if (q.workspaceId === input.workspaceId && q.name === input.name) {
        throw new Error("fila_nome_em_uso");
      }
    }
    if (input.isDefault) {
      for (const q of this.queues.values()) {
        if (q.workspaceId === input.workspaceId) this.queues.set(q.id, { ...q, isDefault: false });
      }
    }
    const queue: QueueRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      channel: input.channel ?? null,
      isDefault: input.isDefault ?? false,
      createdAt: now(),
    };
    this.queues.set(queue.id, queue);
    return queue;
  }

  async listQueues(workspaceId: string): Promise<QueueRecord[]> {
    return [...this.queues.values()]
      .filter((q) => q.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findQueueById(workspaceId: string, id: string): Promise<QueueRecord | null> {
    const q = this.queues.get(id);
    return q && q.workspaceId === workspaceId ? q : null;
  }

  async deleteQueue(workspaceId: string, id: string): Promise<boolean> {
    const q = this.queues.get(id);
    if (!q || q.workspaceId !== workspaceId) return false;
    this.queues.delete(id);
    for (const [key, m] of this.queueMembers) if (m.queueId === id) this.queueMembers.delete(key);
    return true;
  }

  async addQueueMember(input: { workspaceId: string; queueId: string; userId: string }): Promise<void> {
    const key = `${input.queueId}:${input.userId}`;
    if (!this.queueMembers.has(key)) {
      this.queueMembers.set(key, { ...input, createdAt: now() });
    }
  }

  async removeQueueMember(workspaceId: string, queueId: string, userId: string): Promise<boolean> {
    const key = `${queueId}:${userId}`;
    const m = this.queueMembers.get(key);
    if (!m || m.workspaceId !== workspaceId) return false;
    return this.queueMembers.delete(key);
  }

  async listQueueMembers(workspaceId: string, queueId: string): Promise<string[]> {
    return [...this.queueMembers.values()]
      .filter((m) => m.workspaceId === workspaceId && m.queueId === queueId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => m.userId);
  }

  // ---- F3: tickets ----
  async enqueueTicket(input: {
    workspaceId: string;
    queueId: string;
    conversationId: string;
    channel: string;
  }): Promise<QueueTicketRecord> {
    const queue = this.queues.get(input.queueId);
    if (!queue || queue.workspaceId !== input.workspaceId) throw new Error("fila_invalida");
    const conv = this.conversations.get(input.conversationId);
    if (!conv || conv.workspaceId !== input.workspaceId) throw new Error("conversa_invalida");
    const ticket: QueueTicketRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      queueId: input.queueId,
      conversationId: input.conversationId,
      channel: input.channel,
      status: "aguardando",
      assignedUserId: null,
      enqueuedAt: now(),
      firstResponseAt: null,
      resolvedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  async listTickets(
    workspaceId: string,
    filter?: { queueId?: string; status?: string; assignedUserId?: string },
  ): Promise<QueueTicketRecord[]> {
    return [...this.tickets.values()]
      .filter(
        (t) =>
          t.workspaceId === workspaceId &&
          (!filter?.queueId || t.queueId === filter.queueId) &&
          (!filter?.status || t.status === filter.status) &&
          (!filter?.assignedUserId || t.assignedUserId === filter.assignedUserId),
      )
      .sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt));
  }

  async findTicketById(workspaceId: string, id: string): Promise<QueueTicketRecord | null> {
    const t = this.tickets.get(id);
    return t && t.workspaceId === workspaceId ? t : null;
  }

  async findOpenTicketByConversation(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    for (const t of this.tickets.values()) {
      if (
        t.workspaceId === workspaceId &&
        t.conversationId === conversationId &&
        t.status !== "resolvido" &&
        t.status !== "cancelado"
      ) {
        return t;
      }
    }
    return null;
  }

  async updateTicket(
    workspaceId: string,
    id: string,
    patch: {
      status?: TicketStatus;
      assignedUserId?: string | null;
      firstResponseAt?: string | null;
      resolvedAt?: string | null;
    },
  ): Promise<QueueTicketRecord | null> {
    const t = this.tickets.get(id);
    if (!t || t.workspaceId !== workspaceId) return null;
    const updated: QueueTicketRecord = {
      ...t,
      status: patch.status ?? t.status,
      assignedUserId: patch.assignedUserId !== undefined ? patch.assignedUserId : t.assignedUserId,
      firstResponseAt: patch.firstResponseAt !== undefined ? patch.firstResponseAt : t.firstResponseAt,
      resolvedAt: patch.resolvedAt !== undefined ? patch.resolvedAt : t.resolvedAt,
      updatedAt: now(),
    };
    this.tickets.set(id, updated);
    return updated;
  }

  async markTicketFirstResponse(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    const ticket = await this.findOpenTicketByConversation(workspaceId, conversationId);
    if (!ticket || ticket.firstResponseAt) return ticket;
    return this.updateTicket(workspaceId, ticket.id, {
      firstResponseAt: now(),
      status: ticket.status === "aguardando" ? "em_atendimento" : ticket.status,
    });
  }

  async resolveOpenTicketForConversation(workspaceId: string, conversationId: string): Promise<QueueTicketRecord | null> {
    const ticket = await this.findOpenTicketByConversation(workspaceId, conversationId);
    if (!ticket) return null;
    return this.updateTicket(workspaceId, ticket.id, { status: "resolvido", resolvedAt: now() });
  }

  // ---- F3: bot ----
  async createBotRule(input: {
    workspaceId: string;
    name: string;
    kind: BotRuleKind;
    priority?: number;
    active?: boolean;
    terms?: string[];
    reply?: string | null;
    options?: BotMenuOption[];
    queueId?: string | null;
  }): Promise<BotRuleRecord> {
    const rule: BotRuleRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      kind: input.kind,
      priority: input.priority ?? 100,
      active: input.active ?? true,
      terms: input.terms ?? [],
      reply: input.reply ?? null,
      options: input.options ?? [],
      queueId: input.queueId ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.botRules.set(rule.id, rule);
    return rule;
  }

  async listBotRules(workspaceId: string): Promise<BotRuleRecord[]> {
    return [...this.botRules.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  }

  async updateBotRule(
    workspaceId: string,
    id: string,
    patch: Partial<{
      name: string;
      priority: number;
      active: boolean;
      terms: string[];
      reply: string | null;
      options: BotMenuOption[];
      queueId: string | null;
    }>,
  ): Promise<BotRuleRecord | null> {
    const rule = this.botRules.get(id);
    if (!rule || rule.workspaceId !== workspaceId) return null;
    const updated: BotRuleRecord = { ...rule, ...patch, updatedAt: now() };
    this.botRules.set(id, updated);
    return updated;
  }

  async deleteBotRule(workspaceId: string, id: string): Promise<boolean> {
    const rule = this.botRules.get(id);
    if (!rule || rule.workspaceId !== workspaceId) return false;
    return this.botRules.delete(id);
  }

  async getBotSession(workspaceId: string, conversationId: string): Promise<BotSessionRecord | null> {
    const s = this.botSessions.get(conversationId);
    return s && s.workspaceId === workspaceId ? s : null;
  }

  async setBotSession(input: {
    workspaceId: string;
    conversationId: string;
    state: BotSessionState;
  }): Promise<BotSessionRecord> {
    const record: BotSessionRecord = { ...input, updatedAt: now() };
    this.botSessions.set(input.conversationId, record);
    return record;
  }
}

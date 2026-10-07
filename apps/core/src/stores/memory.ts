import { randomUUID } from "node:crypto";
import type {
  ContactRecord,
  InviteRecord,
  MembershipRecord,
  MemberWithUser,
  Store,
  UserRecord,
  WorkspaceRecord,
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
      createdAt: now(),
    };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async listContacts(workspaceId: string): Promise<ContactRecord[]> {
    return [...this.contacts.values()].filter(
      (c) => c.workspaceId === workspaceId,
    );
  }
}

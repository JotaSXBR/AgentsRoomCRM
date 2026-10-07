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
  createdAt: string;
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
  listContacts(workspaceId: string): Promise<ContactRecord[]>;
}

export type { WorkspaceMemberRole, WorkspaceRole };

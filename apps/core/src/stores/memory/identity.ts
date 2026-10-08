import { randomUUID } from "node:crypto";
import type {
  InviteRecord,
  MembershipRecord,
  MemberWithUser,
  UserRecord,
  WorkspaceRecord,
} from "../types/identity.js";
import type { MemoryState } from "./shared.js";
import { now } from "./shared.js";

export type IdentityState = Pick<
  MemoryState,
  "users" | "workspaces" | "memberships" | "invites"
>;

export function membershipKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

export async function countUsers(state: IdentityState): Promise<number> {
  return state.users.size;
}

export async function createUser(
  state: IdentityState,
  input: {
    email: string;
    passwordHash: string;
    name: string;
    isOwnerGlobal: boolean;
  },
): Promise<UserRecord> {
  const email = input.email.toLowerCase();
  for (const user of state.users.values()) {
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
  state.users.set(user.id, user);
  return user;
}

export async function findUserByEmail(
  state: IdentityState,
  email: string,
): Promise<UserRecord | null> {
  const target = email.toLowerCase();
  for (const user of state.users.values()) {
    if (user.email === target) return user;
  }
  return null;
}

export async function findUserById(
  state: IdentityState,
  id: string,
): Promise<UserRecord | null> {
  return state.users.get(id) ?? null;
}

export async function createWorkspace(
  state: IdentityState,
  input: {
    name: string;
    slug: string;
  },
): Promise<WorkspaceRecord> {
  for (const ws of state.workspaces.values()) {
    if (ws.slug === input.slug) throw new Error("slug_em_uso");
  }
  const ws: WorkspaceRecord = {
    id: randomUUID(),
    name: input.name,
    slug: input.slug,
    createdAt: now(),
  };
  state.workspaces.set(ws.id, ws);
  return ws;
}

export async function findWorkspaceById(
  state: IdentityState,
  id: string,
): Promise<WorkspaceRecord | null> {
  return state.workspaces.get(id) ?? null;
}

export async function findWorkspaceBySlug(
  state: IdentityState,
  slug: string,
): Promise<WorkspaceRecord | null> {
  for (const ws of state.workspaces.values()) {
    if (ws.slug === slug) return ws;
  }
  return null;
}

export async function listWorkspaces(state: IdentityState): Promise<WorkspaceRecord[]> {
  return [...state.workspaces.values()];
}

export async function addMember(
  state: IdentityState,
  input: {
    workspaceId: string;
    userId: string;
    role: MembershipRecord["role"];
  },
): Promise<MembershipRecord> {
  const existing = await findMembership(state, input.workspaceId, input.userId);
  if (existing) {
    const updated = { ...existing, role: input.role };
    state.memberships.set(
      membershipKey(input.workspaceId, input.userId),
      updated,
    );
    return updated;
  }
  const record: MembershipRecord = { ...input, createdAt: now() };
  state.memberships.set(
    membershipKey(input.workspaceId, input.userId),
    record,
  );
  return record;
}

export async function findMembership(
  state: IdentityState,
  workspaceId: string,
  userId: string,
): Promise<MembershipRecord | null> {
  return state.memberships.get(membershipKey(workspaceId, userId)) ?? null;
}

export async function listMembers(
  state: IdentityState,
  workspaceId: string,
): Promise<MemberWithUser[]> {
  const out: MemberWithUser[] = [];
  for (const m of state.memberships.values()) {
    if (m.workspaceId !== workspaceId) continue;
    const user = state.users.get(m.userId);
    if (!user) continue;
    out.push({ ...m, email: user.email, name: user.name });
  }
  return out;
}

export async function listMembershipsByUser(
  state: IdentityState,
  userId: string,
): Promise<MembershipRecord[]> {
  return [...state.memberships.values()].filter((m) => m.userId === userId);
}

export async function createInvite(
  state: IdentityState,
  input: {
    workspaceId: string;
    email: string;
    role: InviteRecord["role"];
    tokenHash: string;
    expiresAt: string;
    createdBy: string;
  },
): Promise<InviteRecord> {
  const invite: InviteRecord = {
    id: randomUUID(),
    ...input,
    email: input.email.toLowerCase(),
    acceptedAt: null,
    createdAt: now(),
  };
  state.invites.set(invite.id, invite);
  return invite;
}

export async function findInviteByTokenHash(
  state: IdentityState,
  tokenHash: string,
): Promise<InviteRecord | null> {
  for (const invite of state.invites.values()) {
    if (invite.tokenHash === tokenHash) return invite;
  }
  return null;
}

export async function markInviteAccepted(
  state: IdentityState,
  id: string,
): Promise<void> {
  const invite = state.invites.get(id);
  if (invite) state.invites.set(id, { ...invite, acceptedAt: now() });
}

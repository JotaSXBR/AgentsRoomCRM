/**
 * Papéis do sistema (F0).
 *
 * - `owner_global`: dono da instalação. Visão transversal (todos os workspaces).
 *   Não pertence a nenhum workspace; o isolamento por `workspace_id` não se aplica.
 * - `admin_ws`: administra UM workspace (membros, convites, recursos).
 * - `supervisor`: opera e supervisiona (lê/gere recursos, não gere membros).
 * - `atendente`: operação básica no workspace.
 */

export const WORKSPACE_ROLES = [
  "owner_global",
  "admin_ws",
  "supervisor",
  "atendente",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Papéis que podem existir como membro de um workspace (owner_global não é membro). */
export const WORKSPACE_MEMBER_ROLES = [
  "admin_ws",
  "supervisor",
  "atendente",
] as const;

export type WorkspaceMemberRole =
  (typeof WORKSPACE_MEMBER_ROLES)[number];

/** Hierarquia (maior = mais poder dentro do workspace). */
export const ROLE_RANK: Record<WorkspaceMemberRole, number> = {
  atendente: 1,
  supervisor: 2,
  admin_ws: 3,
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_ROLES as readonly string[]).includes(value)
  );
}

export function isMemberRole(value: unknown): value is WorkspaceMemberRole {
  return (
    typeof value === "string" &&
    (WORKSPACE_MEMBER_ROLES as readonly string[]).includes(value)
  );
}

/** `actor` tem poder >= `required` dentro do workspace? */
export function hasRank(
  actor: WorkspaceMemberRole,
  required: WorkspaceMemberRole,
): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[required];
}

/**
 * Quem pode convidar quem? Regra F0:
 * - `admin_ws` convida qualquer papel de membro.
 * - `supervisor`/`atendente` não convidam.
 * - `owner_global` (transversal) pode convidar para qualquer papel.
 */
export function canInvite(
  actor: WorkspaceRole,
  invited: WorkspaceMemberRole,
): boolean {
  if (actor === "owner_global") return isMemberRole(invited);
  if (actor === "admin_ws") return isMemberRole(invited);
  return false;
}

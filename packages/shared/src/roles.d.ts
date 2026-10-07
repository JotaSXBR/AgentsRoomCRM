/**
 * Papéis do sistema (F0).
 *
 * - `owner_global`: dono da instalação. Visão transversal (todos os workspaces).
 *   Não pertence a nenhum workspace; o isolamento por `workspace_id` não se aplica.
 * - `admin_ws`: administra UM workspace (membros, convites, recursos).
 * - `supervisor`: opera e supervisiona (lê/gere recursos, não gere membros).
 * - `atendente`: operação básica no workspace.
 */
export declare const WORKSPACE_ROLES: readonly ["owner_global", "admin_ws", "supervisor", "atendente"];
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
/** Papéis que podem existir como membro de um workspace (owner_global não é membro). */
export declare const WORKSPACE_MEMBER_ROLES: readonly ["admin_ws", "supervisor", "atendente"];
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number];
/** Hierarquia (maior = mais poder dentro do workspace). */
export declare const ROLE_RANK: Record<WorkspaceMemberRole, number>;
export declare function isWorkspaceRole(value: unknown): value is WorkspaceRole;
export declare function isMemberRole(value: unknown): value is WorkspaceMemberRole;
/** `actor` tem poder >= `required` dentro do workspace? */
export declare function hasRank(actor: WorkspaceMemberRole, required: WorkspaceMemberRole): boolean;
/**
 * Quem pode convidar quem? Regra F0:
 * - `admin_ws` convida qualquer papel de membro.
 * - `supervisor`/`atendente` não convidam.
 * - `owner_global` (transversal) pode convidar para qualquer papel.
 */
export declare function canInvite(actor: WorkspaceRole, invited: WorkspaceMemberRole): boolean;
//# sourceMappingURL=roles.d.ts.map
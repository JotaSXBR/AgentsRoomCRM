"use strict";
/**
 * Papéis do sistema (F0).
 *
 * - `owner_global`: dono da instalação. Visão transversal (todos os workspaces).
 *   Não pertence a nenhum workspace; o isolamento por `workspace_id` não se aplica.
 * - `admin_ws`: administra UM workspace (membros, convites, recursos).
 * - `supervisor`: opera e supervisiona (lê/gere recursos, não gere membros).
 * - `atendente`: operação básica no workspace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_RANK = exports.WORKSPACE_MEMBER_ROLES = exports.WORKSPACE_ROLES = void 0;
exports.isWorkspaceRole = isWorkspaceRole;
exports.isMemberRole = isMemberRole;
exports.hasRank = hasRank;
exports.canInvite = canInvite;
exports.WORKSPACE_ROLES = [
    "owner_global",
    "admin_ws",
    "supervisor",
    "atendente",
];
/** Papéis que podem existir como membro de um workspace (owner_global não é membro). */
exports.WORKSPACE_MEMBER_ROLES = [
    "admin_ws",
    "supervisor",
    "atendente",
];
/** Hierarquia (maior = mais poder dentro do workspace). */
exports.ROLE_RANK = {
    atendente: 1,
    supervisor: 2,
    admin_ws: 3,
};
function isWorkspaceRole(value) {
    return (typeof value === "string" &&
        exports.WORKSPACE_ROLES.includes(value));
}
function isMemberRole(value) {
    return (typeof value === "string" &&
        exports.WORKSPACE_MEMBER_ROLES.includes(value));
}
/** `actor` tem poder >= `required` dentro do workspace? */
function hasRank(actor, required) {
    return exports.ROLE_RANK[actor] >= exports.ROLE_RANK[required];
}
/**
 * Quem pode convidar quem? Regra F0:
 * - `admin_ws` convida qualquer papel de membro.
 * - `supervisor`/`atendente` não convidam.
 * - `owner_global` (transversal) pode convidar para qualquer papel.
 */
function canInvite(actor, invited) {
    if (actor === "owner_global")
        return isMemberRole(invited);
    if (actor === "admin_ws")
        return isMemberRole(invited);
    return false;
}
//# sourceMappingURL=roles.js.map
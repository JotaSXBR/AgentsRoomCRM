"use strict";
/**
 * Helpers de isolamento multi-tenant (F0).
 *
 * Contrato de isolamento total por `workspace_id`, em duas camadas:
 *
 * 1. Aplicação: toda query de tabela tenant recebe `WHERE workspace_id = $n`.
 *    `scopeWhere()` gera o predicado; `assertWorkspace()` valida entrada.
 * 2. Banco (defesa em profundidade): RLS ativado em TODAS as tabelas
 *    (`apps/core/migrations/*.sql`), com `SET LOCAL app.current_workspace_id`.
 *    `setWorkspaceContext()` emite o comando que a transação do request deve rodar.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RLS_USER_SETTING = exports.RLS_SETTING = void 0;
exports.assertWorkspace = assertWorkspace;
exports.scopeWhere = scopeWhere;
exports.setWorkspaceContextSql = setWorkspaceContextSql;
exports.setUserContextSql = setUserContextSql;
exports.isUuid = isUuid;
exports.RLS_SETTING = "app.current_workspace_id";
exports.RLS_USER_SETTING = "app.current_user_id";
/** Valida um `workspace_id` vindo da borda (param/query/header). */
function assertWorkspace(workspaceId) {
    if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
        throw new Error("workspace_id ausente ou inválido.");
    }
    return workspaceId;
}
/**
 * Predicado de escopo para queries parametrizadas.
 * Retorna `{ clause, params }` para compor: `SELECT ... WHERE ${clause}`.
 */
function scopeWhere(workspaceId, column = "workspace_id", startAt = 1) {
    assertWorkspace(workspaceId);
    return { clause: `${column} = $${startAt}`, params: [workspaceId] };
}
/** SQL que fixa o contexto RLS da transação (executar logo após BEGIN). */
function setWorkspaceContextSql(workspaceId) {
    assertWorkspace(workspaceId);
    return {
        text: `SELECT set_config('${exports.RLS_SETTING}', $1, true)`,
        values: [workspaceId],
    };
}
/** SQL que fixa o contexto RLS de usuário da transação (listagens "minhas"). */
function setUserContextSql(userId) {
    if (typeof userId !== "string" || userId.trim() === "") {
        throw new Error("user_id ausente ou inválido.");
    }
    return {
        text: `SELECT set_config('${exports.RLS_USER_SETTING}', $1, true)`,
        values: [userId],
    };
}
/** UUID v4 simples para validação (o banco gera ids via gen_random_uuid()). */
function isUuid(value) {
    return (typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}
//# sourceMappingURL=tenant.js.map
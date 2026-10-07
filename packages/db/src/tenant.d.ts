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
export declare const RLS_SETTING = "app.current_workspace_id";
export declare const RLS_USER_SETTING = "app.current_user_id";
/** Valida um `workspace_id` vindo da borda (param/query/header). */
export declare function assertWorkspace(workspaceId: unknown): string;
/**
 * Predicado de escopo para queries parametrizadas.
 * Retorna `{ clause, params }` para compor: `SELECT ... WHERE ${clause}`.
 */
export declare function scopeWhere(workspaceId: string, column?: string, startAt?: number): {
    clause: string;
    params: [string];
};
/** SQL que fixa o contexto RLS da transação (executar logo após BEGIN). */
export declare function setWorkspaceContextSql(workspaceId: string): {
    text: string;
    values: [string];
};
/** SQL que fixa o contexto RLS de usuário da transação (listagens "minhas"). */
export declare function setUserContextSql(userId: string): {
    text: string;
    values: [string];
};
/** UUID v4 simples para validação (o banco gera ids via gen_random_uuid()). */
export declare function isUuid(value: unknown): boolean;
//# sourceMappingURL=tenant.d.ts.map
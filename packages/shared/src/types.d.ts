import type { WorkspaceMemberRole, WorkspaceRole } from "./roles.js";
export interface UserClaims {
    sub: string;
    email: string;
    isOwnerGlobal: boolean;
}
export interface WorkspaceMembership {
    workspaceId: string;
    role: WorkspaceMemberRole;
}
/** Papel efetivo do usuário num workspace: owner_global vence qualquer membership. */
export declare function effectiveRole(claims: Pick<UserClaims, "isOwnerGlobal">, membership: WorkspaceMembership | null): WorkspaceRole | null;
export interface PageQuery {
    limit: number;
    offset: number;
}
export declare function parsePage(input: {
    limit?: unknown;
    offset?: unknown;
}, defaults?: {
    limit: number;
    offset: number;
}): PageQuery;
export declare class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
    static badRequest(code: string, message: string): HttpError;
    static unauthorized(message?: string): HttpError;
    static forbidden(message?: string): HttpError;
    static notFound(message?: string): HttpError;
    static conflict(code: string, message: string): HttpError;
}
//# sourceMappingURL=types.d.ts.map
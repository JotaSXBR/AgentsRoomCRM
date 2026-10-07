"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.effectiveRole = effectiveRole;
exports.parsePage = parsePage;
/** Papel efetivo do usuário num workspace: owner_global vence qualquer membership. */
function effectiveRole(claims, membership) {
    if (claims.isOwnerGlobal)
        return "owner_global";
    return membership ? membership.role : null;
}
function parsePage(input, defaults = { limit: 20, offset: 0 }) {
    const limit = Number(input.limit ?? defaults.limit);
    const offset = Number(input.offset ?? defaults.offset);
    return {
        limit: Number.isFinite(limit)
            ? Math.min(Math.max(Math.trunc(limit), 1), 100)
            : defaults.limit,
        offset: Number.isFinite(offset) && offset >= 0
            ? Math.trunc(offset)
            : defaults.offset,
    };
}
class HttpError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
    static badRequest(code, message) {
        return new HttpError(400, code, message);
    }
    static unauthorized(message = "Não autenticado.") {
        return new HttpError(401, "unauthorized", message);
    }
    static forbidden(message = "Sem acesso a este workspace.") {
        return new HttpError(403, "forbidden", message);
    }
    static notFound(message = "Recurso não encontrado.") {
        return new HttpError(404, "not_found", message);
    }
    static conflict(code, message) {
        return new HttpError(409, code, message);
    }
}
exports.HttpError = HttpError;
//# sourceMappingURL=types.js.map
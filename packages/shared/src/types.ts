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
export function effectiveRole(
  claims: Pick<UserClaims, "isOwnerGlobal">,
  membership: WorkspaceMembership | null,
): WorkspaceRole | null {
  if (claims.isOwnerGlobal) return "owner_global";
  return membership ? membership.role : null;
}

export interface PageQuery {
  limit: number;
  offset: number;
}

export function parsePage(
  input: { limit?: unknown; offset?: unknown },
  defaults = { limit: 20, offset: 0 },
): PageQuery {
  const limit = Number(input.limit ?? defaults.limit);
  const offset = Number(input.offset ?? defaults.offset);
  return {
    limit: Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 100)
      : defaults.limit,
    offset:
      Number.isFinite(offset) && offset >= 0
        ? Math.trunc(offset)
        : defaults.offset,
  };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  static badRequest(code: string, message: string): HttpError {
    return new HttpError(400, code, message);
  }

  static unauthorized(message = "Não autenticado."): HttpError {
    return new HttpError(401, "unauthorized", message);
  }

  static forbidden(message = "Sem acesso a este workspace."): HttpError {
    return new HttpError(403, "forbidden", message);
  }

  static notFound(message = "Recurso não encontrado."): HttpError {
    return new HttpError(404, "not_found", message);
  }

  static badGateway(code: string, message: string): HttpError {
    return new HttpError(502, code, message);
  }

  static conflict(code: string, message: string): HttpError {
    return new HttpError(409, code, message);
  }
}

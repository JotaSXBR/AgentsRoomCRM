import type { FastifyRequest } from "fastify";
import { HttpError, type WorkspaceRole } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";

/**
 * Autorização por workspace (F0).
 * - `owner_global`: acesso transversal, sem precisar de membership.
 * - demais papéis: membership no `workspaceId` é obrigatória; sem ela → 403.
 * Retorna o papel efetivo para checagens de RBAC (ex.: só admin convida).
 */
export async function requireWorkspace(
  store: Store,
  request: FastifyRequest,
  workspaceId: unknown,
): Promise<WorkspaceRole> {
  const user = request.authUser;
  if (!user) throw HttpError.unauthorized();
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw HttpError.badRequest("workspace_invalido", "workspace_id ausente ou inválido.");
  }
  if (user.isOwnerGlobal) return "owner_global";
  const membership = await store.findMembership(workspaceId, user.id);
  if (!membership) {
    // 403 (não 404): o workspace pode existir — o usuário só não tem acesso.
    throw HttpError.forbidden();
  }
  return membership.role;
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  HttpError,
  canInvite,
  isMemberRole,
} from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import { hashToken, inviteExpiresAt, isExpired, newInviteToken } from "../lib/tokens.js";

const inviteSchema = z.object({
  email: z.string().email("E-mail inválido."),
  role: z.string().refine(isMemberRole, "Papel inválido."),
});

const acceptSchema = z.object({
  token: z.string().min(16, "Token inválido."),
});

export async function inviteRoutes(
  app: FastifyInstance,
  store: Store,
  inviteTtlHours: number,
): Promise<void> {
  // Só admin_ws do workspace (ou owner_global) convida. Retorna o token UMA vez.
  app.post(
    "/workspaces/:workspaceId/invites",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const role = await requireWorkspace(store, request, workspaceId);
      if (role !== "owner_global" && role !== "admin_ws") {
        throw HttpError.forbidden("Só administradores do workspace convidam.");
      }
      const body = inviteSchema.parse(await request.body);
      if (!canInvite(role, body.role)) {
        throw HttpError.forbidden("Papel não permitido para convite.");
      }
      const ws = await store.findWorkspaceById(workspaceId);
      if (!ws) throw HttpError.notFound("Workspace não encontrado.");
      const { token, tokenHash } = newInviteToken();
      await store.createInvite({
        workspaceId,
        email: body.email,
        role: body.role,
        tokenHash,
        expiresAt: inviteExpiresAt(inviteTtlHours),
        createdBy: request.authUser.id,
      });
      return reply.code(201).send({ token });
    },
  );

  // Aceite: usuário autenticado cujo e-mail == e-mail do convite.
  app.post(
    "/invites/accept",
    { onRequest: [app.authenticate] },
    async (request) => {
      const body = acceptSchema.parse(await request.body);
      const invite = await store.findInviteByTokenHash(hashToken(body.token));
      if (!invite) throw HttpError.notFound("Convite inválido.");
      if (invite.acceptedAt) {
        throw HttpError.conflict("convite_usado", "Convite já utilizado.");
      }
      if (isExpired(invite.expiresAt)) {
        throw HttpError.badRequest("convite_expirado", "Convite expirado.");
      }
      if (invite.email !== request.authUser.email.toLowerCase()) {
        throw HttpError.forbidden("Convite destinado a outro e-mail.");
      }
      await store.addMember({
        workspaceId: invite.workspaceId,
        userId: request.authUser.id,
        role: invite.role,
      });
      await store.markInviteAccepted(invite.id, invite.workspaceId);
      return { workspaceId: invite.workspaceId, role: invite.role };
    },
  );
}

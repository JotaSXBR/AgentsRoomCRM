import type { FastifyInstance } from "fastify";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../../stores/store.js";
import { requireWorkspace } from "../../plugins/tenant.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { messageSchema } from "./schemas.js";

export async function registerMessageRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  app.post(
    "/workspaces/:workspaceId/inbox/conversations/:id/messages",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const body = messageSchema.parse(await request.body);
      if (!body.text && !body.mediaUrl) {
        throw HttpError.badRequest("mensagem_vazia", "Informe texto ou mídia.");
      }
      try {
        const msg = await store.addMessage({
          workspaceId,
          conversationId: id,
          direction: body.direction,
          authorId: body.direction === "saida" ? request.authUser.id : null,
          kind: body.mediaUrl ? "midia" : body.kind,
          text: body.text ?? null,
          mediaUrl: body.mediaUrl ?? null,
        });
        hub.publish(workspaceId, { kind: "mensagem.criada", data: msg });
        return await reply.code(201).send(msg);
      } catch (error) {
        if ((error as Error).message === "conversa_invalida") {
          throw HttpError.notFound("Conversa não encontrada.");
        }
        throw error;
      }
    },
  );
}

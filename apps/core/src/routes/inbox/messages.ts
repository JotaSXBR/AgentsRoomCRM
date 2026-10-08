import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../../stores/store.js";
import { requireWorkspace } from "../../plugins/tenant.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { messageSchema } from "./schemas.js";

type MessageBody = z.infer<typeof messageSchema>;
type NewMessageInput = Parameters<Store["addMessage"]>[0];

function isEmptyMessage(body: MessageBody): boolean {
  return !body.text && !body.mediaUrl;
}

function buildMessageInput(args: {
  workspaceId: string;
  conversationId: string;
  authUserId: string;
  body: MessageBody;
}): NewMessageInput {
  const { workspaceId, conversationId, authUserId, body } = args;
  return {
    workspaceId,
    conversationId,
    direction: body.direction,
    authorId: body.direction === "saida" ? authUserId : null,
    kind: body.mediaUrl ? "midia" : body.kind,
    text: body.text ?? null,
    mediaUrl: body.mediaUrl ?? null,
  };
}

function shouldMarkFirstResponse(body: MessageBody, authUser: unknown): boolean {
  if (body.direction !== "saida") return false;
  if (body.kind === "sistema") return false;
  return Boolean(authUser);
}

function isInvalidConversationError(error: unknown): boolean {
  return error instanceof Error && error.message === "conversa_invalida";
}

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
      if (isEmptyMessage(body)) {
        throw HttpError.badRequest("mensagem_vazia", "Informe texto ou mídia.");
      }
      try {
        const msg = await store.addMessage(
          buildMessageInput({ workspaceId, conversationId: id, authUserId: request.authUser.id, body }),
        );
        hub.publish(workspaceId, { kind: "mensagem.criada", data: msg });
        if (shouldMarkFirstResponse(body, request.authUser)) {
          const ticket = await store.markTicketFirstResponse(workspaceId, id);
          if (ticket) hub.publish(workspaceId, { kind: "fila.ticket", data: { ...ticket, event: "primeira_resposta" } });
        }
        return await reply.code(201).send(msg);
      } catch (error) {
        if (isInvalidConversationError(error)) {
          throw HttpError.notFound("Conversa não encontrada.");
        }
        throw error;
      }
    },
  );
}

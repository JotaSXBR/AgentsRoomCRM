import type { FastifyInstance } from "fastify";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../../stores/store.js";
import { requireWorkspace } from "../../plugins/tenant.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { noteSchema } from "./schemas.js";

export async function registerNoteRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/inbox/conversations/:id/notes",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listNotes(workspaceId, id) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/inbox/conversations/:id/notes",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const body = noteSchema.parse(await request.body);
      try {
        const note = await store.addNote({
          workspaceId,
          conversationId: id,
          authorId: request.authUser.id,
          content: body.content,
        });
        hub.publish(workspaceId, { kind: "nota.criada", data: note });
        return await reply.code(201).send(note);
      } catch (error) {
        if ((error as Error).message === "conversa_invalida") {
          throw HttpError.notFound("Conversa não encontrada.");
        }
        throw error;
      }
    },
  );
}

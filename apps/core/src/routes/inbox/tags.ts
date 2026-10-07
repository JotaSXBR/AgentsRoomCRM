import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../../stores/store.js";
import { requireWorkspace } from "../../plugins/tenant.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { tagSchema } from "./schemas.js";

export async function registerTagRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/tags",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listTags(workspaceId) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/tags",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = tagSchema.parse(await request.body);
      const tag = await store.createTag({
        workspaceId,
        name: body.name,
        color: body.color ?? null,
      });
      return reply.code(201).send(tag);
    },
  );

  app.post(
    "/workspaces/:workspaceId/inbox/conversations/:id/tags",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const { tagId } = z.object({ tagId: z.string().uuid() }).parse(await request.body);
      try {
        await store.tagConversation(workspaceId, id, tagId);
        hub.publish(workspaceId, { kind: "tag.adicionada", data: { conversationId: id, tagId } });
        return await reply.code(204).send();
      } catch {
        throw HttpError.badRequest("tag_invalida", "Tag ou conversa inválida.");
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/inbox/conversations/:id/tags/:tagId",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id, tagId } = request.params as {
        workspaceId: string;
        id: string;
        tagId: string;
      };
      await requireWorkspace(store, request, workspaceId);
      await store.untagConversation(workspaceId, id, tagId);
      hub.publish(workspaceId, { kind: "tag.removida", data: { conversationId: id, tagId } });
      return reply.code(204).send();
    },
  );
}

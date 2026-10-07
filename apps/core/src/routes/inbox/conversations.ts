import type { FastifyInstance } from "fastify";
import { HttpError, parsePage } from "@agentsroom/shared";
import type { Store } from "../../stores/store.js";
import { requireWorkspace } from "../../plugins/tenant.js";
import type { RealtimeHub } from "../../realtime/hub.js";
import { STATUS, createConversationSchema, patchConversationSchema } from "./schemas.js";

export async function registerConversationRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/inbox/conversations",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const query = (request.query ?? {}) as {
        status?: string;
        assigneeId?: string;
        tagId?: string;
        q?: string;
        limit?: unknown;
        offset?: unknown;
      };
      const { limit, offset } = parsePage(query);
      const status = query.status ? STATUS.parse(query.status) : undefined;
      const all = await store.listConversations(workspaceId, {
        status,
        assigneeId: query.assigneeId,
        tagId: query.tagId,
        q: query.q,
      });
      return { data: all.slice(offset, offset + limit), total: all.length };
    },
  );

  app.post(
    "/workspaces/:workspaceId/inbox/conversations",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = createConversationSchema.parse(await request.body);
      try {
        const conv = await store.createConversation({
          workspaceId,
          contactId: body.contactId,
          channel: body.channel,
          subject: body.subject ?? null,
        });
        hub.publish(workspaceId, { kind: "conversa.criada", data: conv });
        return await reply.code(201).send(conv);
      } catch (error) {
        if ((error as Error).message === "contato_invalido") {
          throw HttpError.badRequest("contato_invalido", "Contato não existe neste workspace.");
        }
        throw error;
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/inbox/conversations/:id",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const conv = await store.findConversationById(workspaceId, id);
      if (!conv) throw HttpError.notFound("Conversa não encontrada.");
      const [tags, messages, notes] = await Promise.all([
        store.listConversationTags(workspaceId, id),
        store.listMessages(workspaceId, id),
        store.listNotes(workspaceId, id),
      ]);
      return { ...conv, tags, messages, notes };
    },
  );

  app.patch(
    "/workspaces/:workspaceId/inbox/conversations/:id",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const body = patchConversationSchema.parse(await request.body);
      const conv = await applyConversationPatch(store, workspaceId, id, body);
      if (!conv) throw HttpError.notFound("Conversa não encontrada.");
      hub.publish(workspaceId, { kind: "conversa.atualizada", data: conv });
      return conv;
    },
  );
}

async function applyConversationPatch(
  store: Store,
  workspaceId: string,
  id: string,
  body: { status?: "aberto" | "pendente" | "resolvido"; assigneeId?: string | null },
): Promise<unknown> {
  let conv = null;
  if (body.status !== undefined) {
    conv = await store.setConversationStatus(workspaceId, id, body.status);
  }
  if (body.assigneeId !== undefined) {
    conv = await assignWithValidation(store, workspaceId, id, body.assigneeId ?? null);
  }
  return conv;
}

async function assignWithValidation(
  store: Store,
  workspaceId: string,
  id: string,
  assigneeId: string | null,
): Promise<unknown> {
  try {
    return await store.assignConversation(workspaceId, id, assigneeId);
  } catch (error) {
    if ((error as Error).message === "assignee_invalido") {
      throw HttpError.badRequest("assignee_invalido", "Atribuído não é membro do workspace.");
    }
    throw error;
  }
}

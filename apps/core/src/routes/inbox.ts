import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import { HttpError, parsePage } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import { RealtimeHub } from "../realtime/hub.js";

const STATUS = z.enum(["aberto", "pendente", "resolvido"]);

const createConversationSchema = z.object({
  contactId: z.string().uuid(),
  channel: z.string().min(1).max(40),
  subject: z.string().max(200).nullish(),
});

const messageSchema = z.object({
  direction: z.enum(["entrada", "saida"]).default("saida"),
  text: z.string().max(8000).nullish(),
  mediaUrl: z.string().url().nullish(),
  kind: z.enum(["texto", "midia", "sistema"]).default("texto"),
});

const noteSchema = z.object({
  content: z.string().min(1).max(4000),
});

const patchConversationSchema = z
  .object({
    status: STATUS.optional(),
    assigneeId: z.string().uuid().nullish(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: "Nada para atualizar.",
  });

const tagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).nullish(),
});

export async function inboxRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  await app.register(websocket);

  // ------------------------------------------------- conversas
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
        return reply.code(201).send(conv);
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
      let conv = null;
      if (body.status !== undefined) {
        conv = await store.setConversationStatus(workspaceId, id, body.status);
      }
      if (body.assigneeId !== undefined) {
        try {
          conv = await store.assignConversation(workspaceId, id, body.assigneeId ?? null);
        } catch (error) {
          if ((error as Error).message === "assignee_invalido") {
            throw HttpError.badRequest("assignee_invalido", "Atribuído não é membro do workspace.");
          }
          throw error;
        }
      }
      if (!conv) throw HttpError.notFound("Conversa não encontrada.");
      hub.publish(workspaceId, { kind: "conversa.atualizada", data: conv });
      return conv;
    },
  );

  // ------------------------------------------------- mensagens
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
        return reply.code(201).send(msg);
      } catch (error) {
        if ((error as Error).message === "conversa_invalida") {
          throw HttpError.notFound("Conversa não encontrada.");
        }
        throw error;
      }
    },
  );

  // ------------------------------------------------- notas internas
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
        return reply.code(201).send(note);
      } catch (error) {
        if ((error as Error).message === "conversa_invalida") {
          throw HttpError.notFound("Conversa não encontrada.");
        }
        throw error;
      }
    },
  );

  // ------------------------------------------------- tags
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
        return reply.code(204).send();
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

  // ------------------------------------------------- polling fallback
  app.get(
    "/workspaces/:workspaceId/inbox/updates",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const { since } = (request.query ?? {}) as { since?: string };
      const sinceIso = since && !Number.isNaN(Date.parse(since))
        ? new Date(since).toISOString()
        : new Date(0).toISOString();
      return store.listUpdates(workspaceId, sinceIso);
    },
  );

  // ------------------------------------------------- websocket room ws:{id}
  app.get(
    "/workspaces/:workspaceId/ws",
    { websocket: true },
    async (socket, request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const token = (request.query as { token?: string })?.token;
      if (!token) {
        socket.close(4401, "token ausente");
        return;
      }
      let userId: string;
      let isOwnerGlobal: boolean;
      try {
        const decoded = app.jwt.verify<{ sub: string }>(token);
        const user = await store.findUserById(decoded.sub);
        if (!user) throw new Error("usuario");
        userId = user.id;
        isOwnerGlobal = user.isOwnerGlobal;
      } catch {
        socket.close(4401, "token inválido");
        return;
      }
      if (!isOwnerGlobal) {
        const membership = await store.findMembership(workspaceId, userId);
        if (!membership) {
          socket.close(4403, "sem acesso ao workspace");
          return;
        }
      }
      const unsubscribe = hub.subscribe(workspaceId, (event) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
      });
      socket.on("close", unsubscribe);
      socket.send(
        JSON.stringify({
          kind: "conectado",
          workspaceId,
          data: { room: RealtimeHub.room(workspaceId) },
          at: new Date().toISOString(),
        }),
      );
    },
  );
}

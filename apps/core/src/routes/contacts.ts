import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, parsePage } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";

const createSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório.").max(160),
  phone: z.string().max(40).nullish(),
  email: z.string().email("E-mail inválido.").nullish(),
});

/**
 * Entidade tenant de exemplo. Prova o isolamento: 100% das queries passam por
 * `requireWorkspace` + `workspaceId` — sem acesso, 403, nunca vazamento.
 */
export async function contactRoutes(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/contacts",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const { limit, offset } = parsePage(
        (request.query ?? {}) as { limit?: unknown; offset?: unknown; q?: unknown },
      );
      const q = ((request.query ?? {}) as { q?: unknown }).q;
      const all = await store.listContacts(workspaceId, {
        q: typeof q === "string" ? q : undefined,
      });
      return { data: all.slice(offset, offset + limit), total: all.length };
    },
  );

  app.post(
    "/workspaces/:workspaceId/contacts",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = createSchema.parse(await request.body);
      const contact = await store.createContact({
        workspaceId,
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
      });
      return reply.code(201).send(contact);
    },
  );

  // Contato unificado multicanal: detalhe com canais e timeline.
  app.get(
    "/workspaces/:workspaceId/contacts/:id",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const contact = await store.findContactById(workspaceId, id);
      if (!contact) throw HttpError.notFound("Contato não encontrado.");
      const [channels, timeline] = await Promise.all([
        store.listContactChannels(workspaceId, id),
        store.contactTimeline(workspaceId, id),
      ]);
      return { ...contact, channels, timeline };
    },
  );

  app.post(
    "/workspaces/:workspaceId/contacts/:id/channels",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const contact = await store.findContactById(workspaceId, id);
      if (!contact) throw HttpError.notFound("Contato não encontrado.");
      const body = z
        .object({ channel: z.string().min(1).max(40), value: z.string().min(1).max(200) })
        .parse(await request.body);
      const channel = await store.addContactChannel({
        workspaceId,
        contactId: id,
        channel: body.channel,
        value: body.value,
      });
      return reply.code(201).send(channel);
    },
  );

  app.post(
    "/workspaces/:workspaceId/contacts/:id/merge",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const body = z
        .object({ targetId: z.string().uuid() })
        .parse(await request.body);
      try {
        const survivor = await store.mergeContacts(workspaceId, id, body.targetId);
        return { merged: true, contact: survivor };
      } catch {
        throw HttpError.badRequest("merge_invalido", "Merge inválido (ids/workspace).");
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/contacts/:id/timeline",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const contact = await store.findContactById(workspaceId, id);
      if (!contact) throw HttpError.notFound("Contato não encontrado.");
      return { data: await store.contactTimeline(workspaceId, id) };
    },
  );
}

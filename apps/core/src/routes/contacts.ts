import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parsePage } from "@agentsroom/shared";
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
        (request.query ?? {}) as { limit?: unknown; offset?: unknown },
      );
      const all = await store.listContacts(workspaceId);
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
}

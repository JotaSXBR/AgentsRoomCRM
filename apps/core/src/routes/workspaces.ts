import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, parsePage } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";

const createSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório.").max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug: apenas minúsculas, números e hífen."),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function workspaceRoutes(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  // Cria workspace; criador vira admin_ws. owner_global também pode criar.
  app.post(
    "/workspaces",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const raw = (await request.body) as { name?: unknown; slug?: unknown };
      const name = z.string().min(1).max(120).parse(raw.name);
      const slug = raw.slug === undefined ? slugify(name) : createSchema.shape.slug.parse(raw.slug);
      const existing = await store.findWorkspaceBySlug(slug);
      if (existing) throw HttpError.conflict("slug_em_uso", "slug já existe.");
      const ws = await store.createWorkspace({ name, slug });
      await store.addMember({
        workspaceId: ws.id,
        userId: request.authUser.id,
        role: "admin_ws",
      });
      return reply.code(201).send(ws);
    },
  );

  // Lista: owner_global vê todos; demais, só onde são membros.
  app.get(
    "/workspaces",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { limit, offset } = parsePage(
        (request.query ?? {}) as { limit?: unknown; offset?: unknown },
      );
      const user = request.authUser;
      if (user.isOwnerGlobal) {
        const all = await store.listWorkspaces();
        return { data: all.slice(offset, offset + limit), total: all.length };
      }
      const memberships = await store.listMembershipsByUser(user.id);
      const mine = (
        await Promise.all(memberships.map((m) => store.findWorkspaceById(m.workspaceId)))
      ).filter((ws): ws is NonNullable<typeof ws> => ws !== null);
      return { data: mine.slice(offset, offset + limit), total: mine.length };
    },
  );

  app.get(
    "/workspaces/:workspaceId",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const ws = await store.findWorkspaceById(workspaceId);
      if (!ws) throw HttpError.notFound("Workspace não encontrado.");
      return ws;
    },
  );

  app.get(
    "/workspaces/:workspaceId/members",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listMembers(workspaceId) };
    },
  );
}

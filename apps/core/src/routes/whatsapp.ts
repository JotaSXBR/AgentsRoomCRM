import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { WhatsAppAdapter } from "../waha/adapter.js";

const createSessionSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "Nome: letras minúsculas, números, - e _")
    .optional(),
});

/** Sessões WhatsApp por workspace (WAHA GOWS via adapter isolado). */
export async function whatsappRoutes(
  app: FastifyInstance,
  store: Store,
  adapter: WhatsAppAdapter | null,
): Promise<void> {
  const requireAdapter = (): WhatsAppAdapter => {
    if (!adapter) {
      throw new HttpError(
        503,
        "gateway_indisponivel",
        "WAHA_API_URL não configurada neste ambiente.",
      );
    }
    return adapter;
  };

  app.get(
    "/workspaces/:workspaceId/whatsapp/sessions",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listWahaSessions(workspaceId) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/whatsapp/sessions",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = createSessionSchema.parse(await request.body ?? {});
      const name = body.name ?? `ws_${workspaceId.slice(0, 8)}_${Date.now().toString(36)}`;
      const gw = requireAdapter();
      let info;
      try {
        info = await gw.createSession(name);
      } catch (error) {
        throw HttpError.badGateway("waha_falhou", (error as Error).message);
      }
      try {
        const record = await store.createWahaSession({ workspaceId, name, engine: "GOWS" });
        const updated = await store.updateWahaSession(workspaceId, record.id, {
          status: info.status,
          phone: info.phone ?? null,
        });
        return await reply.code(201).send(updated ?? record);
      } catch (error) {
        if ((error as Error).message === "session_nome_em_uso") {
          throw HttpError.conflict("session_nome_em_uso", "Nome de sessão já usado.");
        }
        throw error;
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/whatsapp/sessions/:id/qr",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const session = await store.findWahaSessionById(workspaceId, id);
      if (!session) throw HttpError.notFound("Sessão não encontrada.");
      try {
        return await requireAdapter().getQr(session.name);
      } catch (error) {
        throw HttpError.badGateway("waha_falhou", (error as Error).message);
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/whatsapp/sessions/:id/status",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const session = await store.findWahaSessionById(workspaceId, id);
      if (!session) throw HttpError.notFound("Sessão não encontrada.");
      try {
        const info = await requireAdapter().getStatus(session.name);
        return (
          (await store.updateWahaSession(workspaceId, id, {
            status: info.status,
            phone: info.phone ?? undefined,
          })) ?? session
        );
      } catch (error) {
        throw HttpError.badGateway("waha_falhou", (error as Error).message);
      }
    },
  );

  app.post(
    "/workspaces/:workspaceId/whatsapp/sessions/:id/reconnect",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const session = await store.findWahaSessionById(workspaceId, id);
      if (!session) throw HttpError.notFound("Sessão não encontrada.");
      try {
        const info = await requireAdapter().reconnect(session.name);
        return (
          (await store.updateWahaSession(workspaceId, id, { status: info.status })) ?? session
        );
      } catch (error) {
        throw HttpError.badGateway("waha_falhou", (error as Error).message);
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/whatsapp/sessions/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const session = await store.findWahaSessionById(workspaceId, id);
      if (!session) throw HttpError.notFound("Sessão não encontrada.");
      try {
        await requireAdapter().logout(session.name);
      } catch (error) {
        throw HttpError.badGateway("waha_falhou", (error as Error).message);
      }
      await store.updateWahaSession(workspaceId, id, { status: "encerrada" });
      return reply.code(204).send();
    },
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "../stores/store.js";
import { HttpError } from "@agentsroom/shared";
import { requireWorkspace } from "../plugins/tenant.js";

const businessHoursSchema = z.record(
  z.string(),
  z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])).nullable(),
);

const putSettingsSchema = z
  .object({
    timezone: z.string().min(1).max(60).optional(),
    absenceMessage: z.string().min(1).max(2000).optional(),
    businessHours: businessHoursSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para atualizar." });

export async function settingsRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/settings",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const settings = await store.getWorkspaceSettings(workspaceId);
      return (
        settings ?? {
          workspaceId,
          timezone: "America/Sao_Paulo",
          absenceMessage:
            "Olá! Estamos fora do horário de atendimento no momento. Deixe sua mensagem que retornaremos em breve.",
          businessHours: {},
          updatedAt: null,
        }
      );
    },
  );

  app.put(
    "/workspaces/:workspaceId/settings",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const role = await requireWorkspace(store, request, workspaceId);
      if (role !== "owner_global" && role !== "admin_ws" && role !== "supervisor") {
        throw HttpError.forbidden();
      }
      const body = putSettingsSchema.parse(await request.body);
      return store.upsertWorkspaceSettings({ workspaceId, ...body });
    },
  );
}

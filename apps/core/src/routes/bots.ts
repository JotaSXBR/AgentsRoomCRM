import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";

function assertSupervisor(role: string): void {
  if (role !== "owner_global" && role !== "admin_ws" && role !== "supervisor") {
    throw HttpError.forbidden();
  }
}

const menuOptionSchema = z.object({
  key: z.string().min(1).max(20),
  label: z.string().min(1).max(120),
  reply: z.string().min(1).max(4000),
  queueId: z.string().uuid().nullish().transform((v) => v ?? null),
});

const createRuleSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["palavra_chave", "menu", "triagem"]),
  priority: z.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
  terms: z.array(z.string().min(1).max(80)).max(20).optional(),
  reply: z.string().max(4000).nullish(),
  options: z.array(menuOptionSchema).max(20).optional(),
  queueId: z.string().uuid().nullish(),
});

const patchRuleSchema = createRuleSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "Nada para atualizar.",
});

export async function botRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/bots",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listBotRules(workspaceId) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/bots",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const body = createRuleSchema.parse(await request.body);
      if (body.kind === "menu" && (!body.options || body.options.length === 0)) {
        throw HttpError.badRequest("menu_sem_opcoes", "Regra de menu exige options.");
      }
      const rule = await store.createBotRule({ workspaceId, ...body });
      return reply.code(201).send(rule);
    },
  );

  app.patch(
    "/workspaces/:workspaceId/bots/:ruleId",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, ruleId } = request.params as { workspaceId: string; ruleId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const body = patchRuleSchema.parse(await request.body);
      const rule = await store.updateBotRule(workspaceId, ruleId, body);
      if (!rule) throw HttpError.notFound("Regra não encontrada.");
      return rule;
    },
  );

  app.delete(
    "/workspaces/:workspaceId/bots/:ruleId",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, ruleId } = request.params as { workspaceId: string; ruleId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const ok = await store.deleteBotRule(workspaceId, ruleId);
      if (!ok) throw HttpError.notFound("Regra não encontrada.");
      return reply.code(204).send();
    },
  );
}

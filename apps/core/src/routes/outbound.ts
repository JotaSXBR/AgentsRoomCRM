import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MailSender } from "../mail/transport.js";
import type { MetaAdapter } from "../meta/adapter.js";
import { processWorkspaceOutbound } from "../outbound/queue.js";
import { buildWorkspaceSender } from "../outbound/sender.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { Store } from "../stores/store.js";

export interface OutboundRouteOptions {
  metaAdapter: MetaAdapter | null;
  mailSender: MailSender | null;
  secretsKey: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const processSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
});

const listQuerySchema = z.object({
  status: z.enum(["pendente", "enviado", "falhou"]).nullish(),
});

/**
 * Fila de saída (F2b): observabilidade + disparo manual.
 * O servidor também gira o processador em intervalo (`OUTBOUND_TICK_MS`);
 * este endpoint existe para staging/testes e reenvio forçado pelo UI.
 */
export async function outboundRoutes(
  app: FastifyInstance,
  store: Store,
  options: OutboundRouteOptions,
): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/outbound",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const query = listQuerySchema.parse(request.query ?? {});
      return {
        data: await store.listOutbound(workspaceId, {
          status: query.status ?? undefined,
        }),
      };
    },
  );

  app.post(
    "/workspaces/:workspaceId/outbound/process",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = processSchema.parse((await request.body) ?? {});
      const sender = buildWorkspaceSender({
        store,
        workspaceId,
        metaAdapter: options.metaAdapter,
        mailSender: options.mailSender,
        secretsKey: options.secretsKey,
      });
      return processWorkspaceOutbound(store, workspaceId, sender, {
        limit: body.limit,
        maxAttempts: options.maxAttempts,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
      });
    },
  );
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { ApiKeyScope, Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import { generateWebhookSecret } from "../lib/apiKeys.js";
import { createKeyRecord } from "../mcp/helpers.js";

const SCOPES = ["mcp", "api:leitura", "api:escrita"] as const;

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1).default(["mcp"]),
});

const createHookSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1).default(["*"]),
});

type Params = { workspaceId: string; id?: string };

function assertSupervisor(role: string): void {
  if (role !== "owner_global" && role !== "admin_ws" && role !== "supervisor") {
    throw HttpError.forbidden("Operação restrita a supervisor ou admin.");
  }
}

/** Endpoint sem segredo — o segredo HMAC só volta na criação. */
function publicHook(endpoint: {
  id: string; name: string; url: string; events: string[]; active: boolean; createdAt: string;
}): Record<string, unknown> {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    events: endpoint.events,
    active: endpoint.active,
    createdAt: endpoint.createdAt,
  };
}

/**
 * Integrações da F5: chaves de API pública e webhooks de saída, por workspace.
 * Escrever (criar/revogar) exige supervisor+; listar é de qualquer membro.
 */
export async function registerIntegrationsRoutes(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.get("/workspaces/:workspaceId/api-keys", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as Params;
    await requireWorkspace(store, request, workspaceId);
    const keys = await store.listApiKeys(workspaceId);
    // O hash nunca sai do servidor, nem para o dono do workspace.
    return { data: keys.map(({ keyHash: _hash, ...safe }) => safe) };
  });

  app.post("/workspaces/:workspaceId/api-keys", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as Params;
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const body = createKeySchema.parse(await request.body);
    const created = await createKeyRecord({
      store,
      workspaceId,
      name: body.name,
      scopes: body.scopes as ApiKeyScope[],
    });
    return reply.code(201).send(created);
  });

  app.delete(
    "/workspaces/:workspaceId/api-keys/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as Params;
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const ok = await store.revokeApiKey(workspaceId, String(id));
      if (!ok) throw HttpError.notFound("Chave não encontrada ou já revogada.");
      return reply.code(204).send();
    },
  );

  await registerWebhookRoutes(app, store);
}

async function registerWebhookRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get("/workspaces/:workspaceId/webhooks", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as Params;
    await requireWorkspace(store, request, workspaceId);
    return { data: (await store.listWebhookEndpoints(workspaceId)).map(publicHook) };
  });

  app.post("/workspaces/:workspaceId/webhooks", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as Params;
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const body = createHookSchema.parse(await request.body);
    const endpoint = await store.createWebhookEndpoint({
      workspaceId,
      name: body.name,
      url: body.url,
      secret: generateWebhookSecret(),
      events: body.events,
    });
    return reply.code(201).send({
      ...publicHook(endpoint),
      secret: endpoint.secret,
      aviso: "Guarde o segredo HMAC: ele não é exibido de novo.",
    });
  });

  app.delete(
    "/workspaces/:workspaceId/webhooks/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as Params;
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const ok = await store.deleteWebhookEndpoint(workspaceId, String(id));
      if (!ok) throw HttpError.notFound("Endpoint não encontrado.");
      return reply.code(204).send();
    },
  );

  app.get(
    "/workspaces/:workspaceId/webhooks/deliveries",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as Params;
      await requireWorkspace(store, request, workspaceId);
      const query = (request.query ?? {}) as { endpointId?: string; status?: string };
      return {
        data: await store.listWebhookDeliveries(workspaceId, {
          endpointId: query.endpointId,
          status: query.status as never,
        }),
      };
    },
  );
}

/** Descoberta da API pública para quem integra com chave (sem JWT). */
export async function publicCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/public/catalog", { onRequest: [app.authenticateApiKey] }, async (request) => {
    return {
      workspaceId: request.apiKey.workspaceId,
      scopes: request.apiKey.scopes,
      auth: "Authorization: Bearer ark_live_…",
      endpoints: [
        { method: "POST", path: "/mcp", description: "Servidor MCP (JSON-RPC 2.0)." },
        { method: "GET", path: "/api/public/catalog", description: "Este catálogo." },
      ],
    };
  });
}

export type { FastifyRequest };
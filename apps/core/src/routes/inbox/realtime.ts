import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../../stores/store.js";
import { requireWorkspace } from "../../plugins/tenant.js";
import { RealtimeHub } from "../../realtime/hub.js";

function parseSince(query: unknown): string {
  const { since } = (query ?? {}) as { since?: string };
  return since && !Number.isNaN(Date.parse(since))
    ? new Date(since).toISOString()
    : new Date(0).toISOString();
}

interface WsAuth {
  userId: string;
  isOwnerGlobal: boolean;
}

async function authenticateWs(
  app: FastifyInstance,
  store: Store,
  token: string | undefined,
): Promise<WsAuth> {
  if (!token) throw HttpError.unauthorized("token ausente");
  try {
    const decoded = app.jwt.verify<{ sub: string }>(token);
    const user = await store.findUserById(decoded.sub);
    if (!user) throw new Error("usuario");
    return { userId: user.id, isOwnerGlobal: user.isOwnerGlobal };
  } catch {
    throw HttpError.unauthorized("token inválido");
  }
}

export async function registerRealtimeRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  await app.register(websocket);

  // ------------------------------------------------- polling fallback
  app.get(
    "/workspaces/:workspaceId/inbox/updates",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return store.listUpdates(workspaceId, parseSince(request.query));
    },
  );

  // ------------------------------------------------- websocket room ws:{id}
  app.get(
    "/workspaces/:workspaceId/ws",
    { websocket: true },
    async (socket, request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const token = (request.query as { token?: string })?.token;
      let auth: WsAuth;
      try {
        auth = await authenticateWs(app, store, token);
      } catch (error) {
        socket.close(4401, (error as Error).message);
        return;
      }
      if (!auth.isOwnerGlobal) {
        const membership = await store.findMembership(workspaceId, auth.userId);
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

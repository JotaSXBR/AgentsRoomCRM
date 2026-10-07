import type { FastifyInstance } from "fastify";
import type { Store } from "../stores/store.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { registerConversationRoutes } from "./inbox/conversations.js";
import { registerMessageRoutes } from "./inbox/messages.js";
import { registerNoteRoutes } from "./inbox/notes.js";
import { registerTagRoutes } from "./inbox/tags.js";
import { registerRealtimeRoutes } from "./inbox/realtime.js";

export async function inboxRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  await registerConversationRoutes(app, store, hub);
  await registerMessageRoutes(app, store, hub);
  await registerNoteRoutes(app, store, hub);
  await registerTagRoutes(app, store, hub);
  await registerRealtimeRoutes(app, store, hub);
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { normalizeWahaEvent, type NormalizedWahaEvent } from "../waha/adapter.js";
import { ingestIncoming } from "../intake.js";
import { runBotOnIncoming } from "../bot/engine.js";
import type { Store } from "../stores/store.js";
import type { RealtimeHub } from "../realtime/hub.js";

interface WahaSession {
  id: string;
  workspaceId: string;
}

function checkWebhookSecret(
  request: FastifyRequest,
  options: { webhookSecret?: string | null },
): boolean {
  if (!options.webhookSecret) return true;
  const header = request.headers["x-webhook-secret"];
  const query = (request.query ?? {}) as { secret?: string };
  return header === options.webhookSecret || query.secret === options.webhookSecret;
}

interface WahaRouteCtx {
  app: FastifyInstance;
  store: Store;
  hub: RealtimeHub;
  session: WahaSession;
  sessionName: string;
  reply: FastifyReply;
  ai?: import("../ai/orchestrate.js").AiDeps;
}

async function handleSessionStatus(
  ctx: WahaRouteCtx,
  event: Extract<NormalizedWahaEvent, { type: "session.status" }>,
): Promise<void> {
  const { app, store, session, sessionName, reply } = ctx;
  await store.updateWahaSession(session.workspaceId, session.id, {
    status: event.status,
    phone: event.phone ?? undefined,
  });
  app.log.info(
    { workspaceId: session.workspaceId, session: sessionName, status: event.status },
    "sessão WAHA atualizada",
  );
  return reply.code(200).send({ ok: true });
}

async function handleIncomingMessage(
  ctx: WahaRouteCtx,
  event: Extract<NormalizedWahaEvent, { type: "message" }>,
): Promise<void> {
  const { app, store, hub, session, sessionName, reply, ai } = ctx;
  if (event.fromMe) {
    return reply.code(200).send({ ok: true, ignored: "fromMe" });
  }
  if (!event.from) {
    return reply.code(200).send({ ok: true, ignored: "sem_remetente" });
  }
  const result = await ingestIncoming(store, {
    workspaceId: session.workspaceId,
    channel: "whatsapp",
    source: "waha",
    externalId: event.messageId,
    contactName: event.from,
    contactValue: event.from,
    text: event.text,
    mediaUrl: event.mediaUrl,
  });
  if (result.duplicate) {
    app.log.info(
      { workspaceId: session.workspaceId, session: sessionName, source: "waha" },
      "mensagem duplicada descartada",
    );
    return reply.code(200).send({ ok: true, duplicate: true });
  }
  app.log.info(
    {
      workspaceId: session.workspaceId,
      session: sessionName,
      conversationId: result.conversation.id,
      contactId: result.contact.id,
    },
    "mensagem whatsapp ingerida",
  );
  hub.publish(session.workspaceId, { kind: "mensagem.criada", data: result.message });
  hub.publish(session.workspaceId, { kind: "conversa.atualizada", data: result.conversation });
  await runBotOnIncoming(store, hub, {
    workspaceId: session.workspaceId,
    conversationId: result.conversation.id,
    channel: "whatsapp",
    text: event.text ?? null,
  }, ai);
  return reply.code(200).send({ ok: true, conversationId: result.conversation.id });
}

/**
 * Webhook do WAHA → intake unificado. Idempotente por (source, externalId).
 * Segredo compartilhado via header `x-webhook-secret` ou `?secret=`.
 * Logs por workspace: cada evento gera linha com workspaceId+sessão+tipo.
 */
export async function webhookRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
  options: { webhookSecret?: string | null; ai?: import("../ai/orchestrate.js").AiDeps },
): Promise<void> {
  app.post("/webhooks/waha", async (request, reply) => {
    if (!checkWebhookSecret(request, options)) {
      return reply
        .code(401)
        .send({ code: "nao_autorizado", message: "Segredo de webhook inválido." });
    }
    const body = (await request.body ?? {}) as Record<string, unknown>;
    const event = normalizeWahaEvent(body);
    const sessionName = event.session;
    if (!sessionName) {
      app.log.info({ source: "waha", event: event.type }, "webhook sem sessão");
      return reply.code(200).send({ ok: true, ignored: "sem_sessao" });
    }
    const session = await store.findWahaSessionByName(sessionName);
    if (!session) {
      app.log.warn({ source: "waha", session: sessionName }, "webhook de sessão desconhecida");
      return reply.code(200).send({ ok: true, ignored: "sessao_desconhecida" });
    }
    if (event.type === "session.status") {
      return handleSessionStatus({ app, store, hub, session, sessionName, reply, ai: options.ai }, event);
    }
    if (event.type === "message") {
      return handleIncomingMessage({ app, store, hub, session, sessionName, reply, ai: options.ai }, event);
    }
    app.log.info({ workspaceId: session.workspaceId, session: sessionName }, "evento waha ignorado");
    return reply.code(200).send({ ok: true, ignored: "tipo_desconhecido" });
  });
}

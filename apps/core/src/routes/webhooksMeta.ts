import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ingestIncoming } from "../intake.js";
import { runBotOnIncoming } from "../bot/engine.js";
import {
  normalizeMetaWebhook,
  verifyMetaSignature,
  verifyMetaSubscribe,
} from "../meta/adapter.js";
import type { Store } from "../stores/store.js";
import type { RealtimeHub } from "../realtime/hub.js";

export interface MetaWebhookOptions {
  /** Segredo do app Meta (prova `X-Hub-Signature-256`). Sem ele, pula (dev). */
  appSecret?: string | null;
  /** Token de verificação da assinatura do webhook. */
  verifyToken?: string | null;
  ai?: import("../ai/orchestrate.js").AiDeps;
}

function rawBodyOf(request: FastifyRequest): string {
  const raw = (request as unknown as { rawBody?: unknown }).rawBody;
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(request.body ?? {});
  } catch {
    return "";
  }
}

interface MetaEventCtx {
  app: FastifyInstance;
  store: Store;
  hub: RealtimeHub;
  ai?: import("../ai/orchestrate.js").AiDeps;
}

async function ingestMetaEvent(
  ctx: MetaEventCtx,
  event: {
    pageId: string;
    channel: string;
    senderId: string;
    mid: string;
    text: string | null;
    isEcho: boolean;
  },
): Promise<"ingerida" | "duplicada" | "ignorada"> {
  const { app, store, hub } = ctx;
  if (event.isEcho) return "ignorada";
  const workspaceId = await store.findWorkspaceIdByMetaPage(event.pageId);
  if (!workspaceId) {
    app.log.warn({ source: "meta", pageId: event.pageId }, "webhook de página desconhecida");
    return "ignorada";
  }
  const result = await ingestIncoming(store, {
    workspaceId,
    channel: event.channel,
    source: "meta",
    externalId: event.mid,
    contactName: event.senderId,
    contactValue: event.senderId,
    text: event.text,
  });
  if (result.duplicate) {
    app.log.info({ workspaceId, source: "meta", mid: event.mid }, "mensagem duplicada descartada");
    return "duplicada";
  }
  app.log.info(
    {
      workspaceId,
      source: "meta",
      channel: event.channel,
      conversationId: result.conversation.id,
      contactId: result.contact.id,
    },
    "mensagem meta ingerida",
  );
  hub.publish(workspaceId, { kind: "mensagem.criada", data: result.message });
  hub.publish(workspaceId, { kind: "conversa.atualizada", data: result.conversation });
  await runBotOnIncoming(store, hub, {
    workspaceId,
    conversationId: result.conversation.id,
    channel: event.channel,
    text: event.text ?? null,
  }, ctx.ai);
  return "ingerida";
}

function parseBody(raw: string, fallback: unknown): Record<string, unknown> {
  if (raw.trim() !== "") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // cai no fallback abaixo
    }
  }
  return (fallback ?? {}) as Record<string, unknown>;
}

/**
 * Webhook oficial da Meta (Messenger + Instagram).
 * - `GET /webhooks/meta`: verificação da assinatura (hub.challenge).
 * - `POST /webhooks/meta`: eventos `page`/`instagram` com assinatura HMAC
 *   (`X-Hub-Signature-256`). O workspace é resolvido pela Página
 *   (`meta_page_index`); Página desconhecida é ignorada com 200 (a Meta
 *   reenvia — responder 4xx geraria retry inútil). Idempotente por
 *   (source "meta", mid). Ecos (`is_echo`) nunca viram intake.
 */
export async function metaWebhookRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
  options: MetaWebhookOptions,
): Promise<void> {
  // Captura o corpo cru SÓ deste webhook (a assinatura HMAC exige os bytes
  // exatos; as demais rotas continuam com o parser JSON padrão).
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (request.url.split("?")[0] !== "/webhooks/meta" || request.method !== "POST") {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    (request as unknown as { rawBody?: string }).rawBody = raw;
    return Readable.from([raw]);
  });

  app.get("/webhooks/meta", async (request, reply) => {
    const challenge = verifyMetaSubscribe(
      (request.query ?? {}) as Record<string, unknown>,
      options.verifyToken ?? null,
    );
    if (challenge === null) {
      return reply
        .code(403)
        .send({ code: "verificacao_negada", message: "Token de verificação inválido." });
    }
    return reply.header("Content-Type", "text/plain; charset=utf-8").send(challenge);
  });

  app.post("/webhooks/meta", async (request, reply) => {
    const raw = rawBodyOf(request);
    const signature = request.headers["x-hub-signature-256"];
    if (
      !verifyMetaSignature(
        raw,
        typeof signature === "string" ? signature : undefined,
        options.appSecret ?? null,
      )
    ) {
      return reply
        .code(401)
        .send({ code: "nao_autorizado", message: "Assinatura do webhook inválida." });
    }
    const events = normalizeMetaWebhook(parseBody(raw, request.body));
    let received = 0;
    const ctx: MetaEventCtx = { app, store, hub, ai: options.ai };
    for (const event of events) {
      const outcome = await ingestMetaEvent(ctx, event);
      if (outcome === "ingerida") received += 1;
    }
    return reply.code(200).send({ ok: true, received });
  });
}

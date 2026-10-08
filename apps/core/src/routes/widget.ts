import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import { hashToken, newInviteToken } from "../lib/tokens.js";
import { ingestIncoming } from "../intake.js";
import { runBotOnIncoming } from "../bot/engine.js";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { RealtimeHub } from "../realtime/hub.js";

const createTokenSchema = z.object({
  name: z.string().min(1).max(60).default("site"),
});

const intakeSchema = z.object({
  name: z.string().max(160).nullish(),
  email: z.string().email().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  text: z.string().min(1).max(8000),
  visitorId: z.string().max(80).nullish(),
  clientMessageId: z.string().max(80).nullish(),
});

async function authenticateWidgetToken(
  store: Store,
  token: string | null,
): Promise<{ workspaceId: string }> {
  if (!token) throw HttpError.unauthorized("Token do widget ausente.");
  const record = await store.findWidgetTokenByHash(hashToken(token));
  if (!record || record.revokedAt) {
    throw HttpError.unauthorized("Token do widget inválido ou revogado.");
  }
  return record;
}

function publishIntakeResult(
  hub: RealtimeHub,
  workspaceId: string,
  result: { contact: { id: string }; conversation: unknown; message: unknown },
): void {
  hub.publish(workspaceId, { kind: "mensagem.criada", data: result.message });
  hub.publish(workspaceId, {
    kind: "conversa.atualizada",
    data: result.conversation,
  });
}
function bearerToken(request: { headers: Record<string, unknown>; query?: unknown }): string | null {
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const q = request.query as { token?: unknown } | undefined;
  if (q && typeof q.token === "string") return q.token;
  return null;
}

export async function widgetRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  // ---- gestão de tokens (autenticado) ----
  app.get(
    "/workspaces/:workspaceId/widget/tokens",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const tokens = await store.listWidgetTokens(workspaceId);
      return {
        data: tokens.map(({ tokenHash: _hash, ...rest }) => rest),
      };
    },
  );

  app.post(
    "/workspaces/:workspaceId/widget/tokens",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = createTokenSchema.parse(await request.body ?? {});
      const { token, tokenHash } = newInviteToken();
      const record = await store.createWidgetToken({
        workspaceId,
        name: body.name,
        tokenHash,
      });
      return reply.code(201).send({
        id: record.id,
        name: record.name,
        token, // mostrado uma única vez
        createdAt: record.createdAt,
      });
    },
  );

  app.delete(
    "/workspaces/:workspaceId/widget/tokens/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const ok = await store.revokeWidgetToken(workspaceId, id);
      if (!ok) throw HttpError.notFound("Token não encontrado ou já revogado.");
      return reply.code(204).send();
    },
  );

  // ---- intake público do widget ----
  app.post("/public/widget/intake", async (request, reply) => {
    const token = bearerToken(request as unknown as { headers: Record<string, unknown> });
    const record = await authenticateWidgetToken(store, token);
    const body = intakeSchema.parse(await request.body ?? {});
    const contactValue = body.phone ?? body.email ?? body.visitorId ?? "visitante";
    const result = await ingestIncoming(store, {
      workspaceId: record.workspaceId,
      channel: "widget",
      source: "widget",
      externalId: body.clientMessageId ?? null,
      contactName: body.name ?? null,
      contactValue,
      phone: body.phone ?? null,
      email: body.email ?? null,
      text: body.text,
    });
    if (result.duplicate) {
      return reply.code(200).send({ ok: true, duplicate: true });
    }
    app.log.info(
      { workspaceId: record.workspaceId, source: "widget", contactId: result.contact.id },
      "mensagem widget ingerida",
    );
    publishIntakeResult(hub, record.workspaceId, result);
    await runBotOnIncoming(store, hub, {
      workspaceId: record.workspaceId,
      conversationId: result.conversation.id,
      channel: "widget",
      text: body.text ?? null,
    });
    return reply.code(201).send({
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
    });
  });

  // ---- widget.js embutível ----
  app.get("/widget.js", async (_request, reply) => {
    return reply
      .header("Content-Type", "application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(widgetJsSource());
  });
}

function widgetJsSource(): string {
  return `(function () {
  var current = document.currentScript;
  var token = current && current.getAttribute("data-token");
  if (!token) { console.warn("[widget] data-token ausente"); return; }
  var origin = current.src ? new URL(current.src).origin : location.origin;

  var style = document.createElement("style");
  style.textContent =
    "#arw-bubble{position:fixed;bottom:16px;right:16px;width:48px;height:48px;border-radius:50%;background:#111;color:#fff;border:0;font-size:20px;cursor:pointer;z-index:99998}" +
    "#arw-panel{position:fixed;bottom:72px;right:16px;width:300px;max-width:80vw;background:#fff;border:1px solid #ddd;border-radius:10px;padding:10px;display:none;z-index:99999;font-family:sans-serif;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.2)}" +
    "#arw-log{max-height:200px;overflow:auto;margin-bottom:8px;color:#333}" +
    "#arw-input{width:calc(100% - 60px);padding:6px;border:1px solid #ccc;border-radius:6px}" +
    "#arw-send{padding:6px 10px;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer}";
  document.head.appendChild(style);

  var bubble = document.createElement("button");
  bubble.id = "arw-bubble";
  bubble.textContent = "💬";
  var panel = document.createElement("div");
  panel.id = "arw-panel";
  panel.innerHTML = '<div id="arw-log"></div><input id="arw-input" placeholder="Escreva sua mensagem..."/> <button id="arw-send">Enviar</button>';
  document.body.appendChild(bubble);
  document.body.appendChild(panel);
  bubble.onclick = function () { panel.style.display = panel.style.display === "block" ? "none" : "block"; };

  var visitorId = localStorage.getItem("arw_visitor");
  if (!visitorId) {
    visitorId = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("arw_visitor", visitorId);
  }

  function send() {
    var input = document.getElementById("arw-input");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    var log = document.getElementById("arw-log");
    log.innerHTML += "<div><b>Você:</b> " + text.replace(/[<>&]/g, "") + "</div>";
    fetch(origin + "/public/widget/intake", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ text: text, visitorId: visitorId, clientMessageId: "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) })
    }).then(function (r) {
      if (!r.ok) log.innerHTML += "<div><i>Falha ao enviar.</i></div>";
    }).catch(function () { log.innerHTML += "<div><i>Offline.</i></div>"; });
  }
  document.getElementById("arw-send").onclick = send;
  document.getElementById("arw-input").addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
})();`;
}

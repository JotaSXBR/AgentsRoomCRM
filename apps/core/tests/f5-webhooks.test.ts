import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";
import {
  deliverAllWorkspaces,
  emitWebhookEvent,
  processWebhookDeliveries,
} from "../src/webhooks/dispatcher.js";
import { signWebhookPayload } from "../src/lib/apiKeys.js";
const SECRET = "test-secret-f5";

interface Session {
  token: string;
  userId: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function register(
  app: FastifyInstance,
  input: { email: string; password: string; name: string },
): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: input });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}
async function createWorkspace(app: FastifyInstance, token: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers: auth(token),
    payload: { name },
  });
  return (res.json() as { id: string }).id;
}

describe("F5 — webhooks de saída", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let ws: string;

  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp({ store, jwtSecret: SECRET });
    alice = await register(app, {
      email: "dono@exemplo.com",
      password: "senha-forte-1",
      name: "Dono",
    });
    ws = await createWorkspace(app, alice.token, "WS F5");
  });

  afterEach(async () => {
    await app.close();
  });

  describe("webhooks de saída", () => {
    it("entrega assinada com HMAC e registra a tentativa", async () => {
      const hook = await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/webhooks`,
        headers: auth(alice.token),
        payload: { name: "ERP", url: "https://erp.exemplo.com/hook", events: ["ticket.criado"] },
      });
      expect(hook.statusCode).toBe(201);
      const created = hook.json() as { secret: string; id: string };
      expect(created.secret).toHaveLength(48);

      const chamadas: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
      const fetchImpl = (async (url: string, init: RequestInit) => {
        chamadas.push({
          url: String(url),
          headers: init.headers as Record<string, string>,
          body: String(init.body),
        });
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const emit = await emitWebhookEvent(
        { store, fetchImpl },
        ws,
        "ticket.criado",
        { ticketId: "t1" },
      );
      expect(emit.queued).toBe(1);

      const result = await processWebhookDeliveries({ store, fetchImpl }, ws);
      expect(result).toEqual({ attempted: 1, delivered: 1 });
      expect(chamadas).toHaveLength(1);

      const headers = chamadas[0].headers;
      const esperado = signWebhookPayload(created.secret, headers["x-agentsroom-timestamp"], chamadas[0].body);
      expect(headers["x-agentsroom-signature"]).toBe(esperado);
      expect(headers["x-agentsroom-event"]).toBe("ticket.criado");

      const entregas = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/webhooks/deliveries`,
        headers: auth(alice.token),
      });
      const data = (entregas.json() as { data: Array<{ status: string; responseCode: number }> }).data;
      expect(data[0].status).toBe("entregue");
      expect(data[0].responseCode).toBe(200);
    });

    it("evento não assinado não chega no endpoint", async () => {
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/webhooks`,
        headers: auth(alice.token),
        payload: { name: "ERP", url: "https://erp.exemplo.com/hook", events: ["ticket.criado"] },
      });
      const emit = await emitWebhookEvent({ store }, ws, "contato.criado", {});
      expect(emit.queued).toBe(0);
    });

    it("falha reagenda com backoff e estoura em 'falhou'", async () => {
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/webhooks`,
        headers: auth(alice.token),
        payload: { name: "Caido", url: "https://caido.exemplo.com/hook", events: ["*"] },
      });
      const fetchImpl = (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;

      // Uma entrega, cinco rodadas do processador: só ela acumula 5 tentativas
      // e estoura; as nascidas depois ficam pendentes com backoff.
      await emitWebhookEvent({ store }, ws, "ping", { i: 1 });
      for (let i = 1; i <= 5; i += 1) {
        await processWebhookDeliveries(
          {
            store,
            fetchImpl,
            baseDelayMs: 0,
            maxDelayMs: 0,
            now: () => new Date(Date.now() + i * 60_000),
          },
          ws,
        );
      }
      const todas = await store.listWebhookDeliveries(ws);
      const falhou = todas.filter((d) => d.status === "falhou");
      expect(falhou).toHaveLength(1);
      expect(falhou[0].attempts).toBe(5);
      expect(falhou[0].lastError).toMatch(/ECONNREFUSED/);
      expect(todas[0].nextAttemptAt).toBeTruthy();
    });

    it("o ticker entrega para todos os workspaces sem cruzar tenant", async () => {
      const outra = await createWorkspace(app, alice.token, "Outro WS");
      for (const destino of [ws, outra]) {
        await app.inject({
          method: "POST",
          url: `/workspaces/${destino}/webhooks`,
          headers: auth(alice.token),
          payload: { name: "Hook", url: `https://exemplo.com/${destino}`, events: ["*"] },
        });
      }
      await emitWebhookEvent({ store }, ws, "conversa.criada", { id: 1 });
      await emitWebhookEvent({ store }, outra, "conversa.criada", { id: 2 });

      const recebidos: string[] = [];
      const fetchImpl = (async (url: string) => {
        recebidos.push(String(url));
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      // É o que o `server.ts` chama a cada WEBHOOK_TICK_MS.
      const result = await deliverAllWorkspaces(
        { store, fetchImpl },
        { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 },
      );
      expect(result.workspaces).toBe(2);
      expect(result.delivered).toBe(2);
      expect(recebidos.sort()).toEqual([`https://exemplo.com/${ws}`, `https://exemplo.com/${outra}`].sort());
    });

    it("segredo do endpoint não é exposto na listagem", async () => {
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/webhooks`,
        headers: auth(alice.token),
        payload: { name: "ERP", url: "https://erp.exemplo.com/hook" },
      });
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/webhooks`,
        headers: auth(alice.token),
      });
      expect(res.body).not.toMatch(/"secret"/);
    });
  });
});

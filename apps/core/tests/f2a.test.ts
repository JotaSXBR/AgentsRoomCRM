import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";
import type { WhatsAppAdapter, WahaSessionInfo } from "../src/waha/adapter.js";

const SECRET = "test-secret-f2a";

interface Session {
  token: string;
  userId: string;
}

async function register(
  app: FastifyInstance,
  input: { email: string; password: string; name: string },
): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: input });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function fakeAdapter(): WhatsAppAdapter & { calls: string[] } {
  const calls: string[] = [];
  const info = (name: string, status = "WORKING"): WahaSessionInfo => ({
    name,
    status,
  });
  return {
    kind: "fake",
    calls,
    async createSession(name) {
      calls.push(`create:${name}`);
      return info(name, "SCAN_QR_CODE");
    },
    async getStatus(name) {
      calls.push(`status:${name}`);
      return info(name);
    },
    async getQr(name) {
      calls.push(`qr:${name}`);
      return { qr: "data:image/png;base64,AAA", status: "qr" };
    },
    async reconnect(name) {
      calls.push(`reconnect:${name}`);
      return info(name, "WORKING");
    },
    async logout(name) {
      calls.push(`logout:${name}`);
    },
  };
}

describe("F2a widget + waha/gows + intake", () => {
  let app: FastifyInstance;
  let alice: Session;
  let ws1: string;
  let adapter: ReturnType<typeof fakeAdapter>;

  beforeEach(async () => {
    adapter = fakeAdapter();
    app = await buildApp({
      store: new MemoryStore(),
      jwtSecret: SECRET,
      waha: { adapter, webhookSecret: "segredo-webhook" },
    });
    alice = await register(app, {
      email: "dono@exemplo.com",
      password: "senha-forte-1",
      name: "Dono",
    });
    const ws = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers: auth(alice.token),
      payload: { name: "Workspace F2a" },
    });
    ws1 = ws.json().id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("widget token: cria, lista sem hash, revoga, intake rejeita revogado", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/widget/tokens`,
      headers: auth(alice.token),
      payload: { name: "site-principal" },
    });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json();

    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/widget/tokens`,
      headers: auth(alice.token),
    });
    expect(list.json().data[0]).toMatchObject({ name: "site-principal" });
    expect(list.json().data[0].tokenHash).toBeUndefined();

    const intake = await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Oi, vim pelo site", visitorId: "v_123", clientMessageId: "c1" },
    });
    expect(intake.statusCode).toBe(201);
    const conversationId = intake.json().conversationId;

    const revoked = await app.inject({
      method: "DELETE",
      url: `/workspaces/${ws1}/widget/tokens/${id}`,
      headers: auth(alice.token),
    });
    expect(revoked.statusCode).toBe(204);

    const depois = await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "não devia entrar", visitorId: "v_123" },
    });
    expect(depois.statusCode).toBe(401);

    const convo = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/conversations/${conversationId}`,
      headers: auth(alice.token),
    });
    expect(convo.json().channel).toBe("widget");
    expect(convo.json().messages.length).toBe(1);
  });

  it("widget duplica clientMessageId → duplicate, sem mensagem a mais", async () => {
    const token = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws1}/widget/tokens`,
        headers: auth(alice.token),
        payload: {},
      })
    ).json().token;
    const payload = { text: "olá", visitorId: "v_9", clientMessageId: "dup-1" };
    const first = await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: auth(token),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: auth(token),
      payload,
    });
    expect(second.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("sessões WAHA: cria via adapter, QR, status, reconnect, delete encerra", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/whatsapp/sessions`,
      headers: auth(alice.token),
      payload: { name: "vendas" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "vendas", status: "SCAN_QR_CODE" });
    expect(adapter.calls).toContain("create:vendas");

    const qr = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/whatsapp/sessions/${created.json().id}/qr`,
      headers: auth(alice.token),
    });
    expect(qr.statusCode).toBe(200);
    expect(adapter.calls).toContain("qr:vendas");

    const status = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/whatsapp/sessions/${created.json().id}/status`,
      headers: auth(alice.token),
    });
    expect(status.json().status).toBe("WORKING");

    const reconnect = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/whatsapp/sessions/${created.json().id}/reconnect`,
      headers: auth(alice.token),
    });
    expect(reconnect.statusCode).toBe(200);
    expect(adapter.calls).toContain("reconnect:vendas");

    const del = await app.inject({
      method: "DELETE",
      url: `/workspaces/${ws1}/whatsapp/sessions/${created.json().id}`,
      headers: auth(alice.token),
    });
    expect(del.statusCode).toBe(204);
    expect(adapter.calls).toContain("logout:vendas");

    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/whatsapp/sessions`,
      headers: auth(alice.token),
    });
    expect(list.json().data[0].status).toBe("encerrada");
  });

  it("webhook: mensagem whatsapp e widget caem no MESMO contato + idempotente", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/whatsapp/sessions`,
      headers: auth(alice.token),
      payload: { name: "suporte" },
    });
    expect(created.statusCode).toBe(201);

    // WhatsApp entra primeiro
    const hook = (msgId: string, body: string) =>
      app.inject({
        method: "POST",
        url: "/webhooks/waha?secret=segredo-webhook",
        payload: {
          event: "message",
          session: "suporte",
          payload: { id: msgId, from: "5511987654321@c.us", body, fromMe: false },
        },
      });
    expect((await hook("wamid.1", "alo, tem alguém?")).statusCode).toBe(200);

    // Widget depois, com e-mail/telefone que unifica? Aqui: mesmo telefone no contato
    const token = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws1}/widget/tokens`,
        headers: auth(alice.token),
        payload: {},
      })
    ).json().token;
    const widgetMsg = await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: auth(token),
      payload: {
        text: "continuando por aqui",
        phone: "5511987654321",
        clientMessageId: "w1",
      },
    });
    expect(widgetMsg.statusCode).toBe(201);

    // mesmo contato: o que o whatsapp criou e o que o widget usou
    const contacts = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/contacts`,
      headers: auth(alice.token),
    });
    expect(contacts.json().total).toBe(1);
    const contactId = contacts.json().data[0].id;
    const detail = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/contacts/${contactId}`,
      headers: auth(alice.token),
    });
    const channels = detail.json().channels.map((c: { channel: string }) => c.channel).sort();
    expect(channels).toEqual(["whatsapp", "widget"]);

    // ambas as conversas do mesmo contato, visíveis na inbox
    const convos = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/conversations`,
      headers: auth(alice.token),
    });
    expect(convos.json().total).toBe(2);

    // webhook duplicado → duplicate:true e sem mensagem extra
    const dup = await hook("wamid.1", "alo, tem alguém?");
    expect(dup.json()).toMatchObject({ ok: true, duplicate: true });

    // webhook sem segredo → 401
    const noSecret = await app.inject({
      method: "POST",
      url: "/webhooks/waha",
      payload: { event: "message", session: "suporte", payload: {} },
    });
    expect(noSecret.statusCode).toBe(401);
  });

  it("session.status atualiza telefone/status da sessão", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/whatsapp/sessions`,
      headers: auth(alice.token),
      payload: { name: "vendas2" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/waha?secret=segredo-webhook",
      payload: {
        event: "session.status",
        session: "vendas2",
        payload: { status: "WORKING", me: { id: "55110000@c.us" } },
      },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/whatsapp/sessions`,
      headers: auth(alice.token),
    });
    expect(list.json().data[0]).toMatchObject({ status: "WORKING", phone: "55110000" });
  });
});

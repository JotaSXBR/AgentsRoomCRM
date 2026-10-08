import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";

const SECRET = "test-secret-f3";

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

const SEMPRE_ABERTO: Record<string, Array<[string, string]>> = {};
for (let d = 0; d < 7; d += 1) SEMPRE_ABERTO[String(d)] = [["00:00", "23:59"]];
const SEMPRE_FECHADO: Record<string, Array<[string, string]>> = {};
for (let d = 0; d < 7; d += 1) SEMPRE_FECHADO[String(d)] = [];

async function createWidgetToken(app: FastifyInstance, token: string, ws: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/workspaces/${ws}/widget/tokens`,
    headers: auth(token),
    payload: { name: "site" },
  });
  return (res.json() as { token: string }).token;
}

async function sendWidget(
  app: FastifyInstance,
  token: string,
  payload: { text: string; visitorId?: string; clientMessageId?: string },
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/public/widget/intake",
    headers: auth(token),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { conversationId: string }).conversationId;
}

async function messagesOf(
  app: FastifyInstance,
  token: string,
  ws: string,
  conversationId: string,
): Promise<Array<{ direction: string; text: string | null }>> {
  const res = await app.inject({
    method: "GET",
    url: `/workspaces/${ws}/inbox/conversations/${conversationId}`,
    headers: auth(token),
  });
  return (res.json() as { messages: Array<{ direction: string; text: string | null }> }).messages;
}

describe("F3 bot por regras", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let ws: string;
  let widgetToken: string;

  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp({ store, jwtSecret: SECRET });
    alice = await register(app, { email: "dono@exemplo.com", password: "senha-forte-1", name: "Dono" });
    const res = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers: auth(alice.token),
      payload: { name: "WS F3" },
    });
    ws = res.json().id;
    widgetToken = await createWidgetToken(app, alice.token, ws);
  });

  afterEach(async () => {
    await app.close();
  });

  async function addMember(userId: string, role: "admin_ws" | "supervisor" | "atendente"): Promise<void> {
    await store.addMember({ workspaceId: ws, userId, role });
  }

    it("contato fora de horário recebe ausência e entra na fila padrão", async () => {
    await app.inject({
      method: "PUT",
      url: `/workspaces/${ws}/settings`,
      headers: auth(alice.token),
      payload: { businessHours: SEMPRE_FECHADO, absenceMessage: "Estamos fechados agora." },
    });
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "geral", isDefault: true },
      })
    ).json();
    const attendant = await register(app, { email: "a1@exemplo.com", password: "senha-forte-2", name: "A1" });
    await addMember(attendant.userId, "atendente");
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/queues/${queue.id}/members`,
      headers: auth(alice.token),
      payload: { userId: attendant.userId },
    });

    const conversationId = await sendWidget(app, widgetToken, { text: "olá", visitorId: "v1" });

    const messages = await messagesOf(app, alice.token, ws, conversationId);
    expect(messages.some((m) => m.direction === "saida" && m.text === "Estamos fechados agora.")).toBe(true);

    const tickets = (
      await app.inject({
      method: "GET",
      url: `/workspaces/${ws}/queues/tickets?queueId=${queue.id}`,
      headers: auth(alice.token),
    })).json();
    expect(tickets.data).toHaveLength(1);
    expect(tickets.data[0]).toMatchObject({ status: "aguardando", channel: "widget", assignedUserId: attendant.userId });
  });

    it("palavra-chave responde e triagem encaminha para a fila", async () => {
    await app.inject({
      method: "PUT",
      url: `/workspaces/${ws}/settings`,
      headers: auth(alice.token),
      payload: { businessHours: SEMPRE_ABERTO },
    });
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "vendas", isDefault: true },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/bots`,
      headers: auth(alice.token),
      payload: { name: "preço", kind: "palavra_chave", terms: ["preço"], reply: "Nossos preços no site." },
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/bots`,
      headers: auth(alice.token),
      payload: { name: "cancelar", kind: "triagem", terms: ["cancelar"], reply: "Encaminhando ao cancelamento.", queueId: queue.id },
    });

    const conv1 = await sendWidget(app, widgetToken, { text: "qual o preço do plano?", visitorId: "v2" });
    const msgs1 = await messagesOf(app, alice.token, ws, conv1);
    expect(msgs1.some((m) => m.direction === "saida" && m.text === "Nossos preços no site.")).toBe(true);

    const conv2 = await sendWidget(app, widgetToken, { text: "quero cancelar meu plano", visitorId: "v3" });
    const msgs2 = await messagesOf(app, alice.token, ws, conv2);
    expect(msgs2.some((m) => m.direction === "saida" && m.text === "Encaminhando ao cancelamento.")).toBe(true);
    const tickets = (
      await app.inject({
      method: "GET",
      url: `/workspaces/${ws}/queues/tickets?queueId=${queue.id}`,
      headers: auth(alice.token),
    })).json();
    expect(tickets.data).toHaveLength(1);
  });

    it("menu com botão/digito: envia opções e a resposta leva à fila", async () => {
    await app.inject({
      method: "PUT",
      url: `/workspaces/${ws}/settings`,
      headers: auth(alice.token),
      payload: { businessHours: SEMPRE_ABERTO },
    });
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "suporte", isDefault: true },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/bots`,
      headers: auth(alice.token),
      payload: {
        name: "menu principal",
        kind: "menu",
        terms: ["menu"],
        reply: "Escolha: 1-Suporte 2-Comercial",
        options: [
          { key: "1", label: "Suporte", reply: "Abrindo suporte.", queueId: queue.id },
          { key: "2", label: "Comercial", reply: "Abrindo comercial." },
        ],
      },
    });

    const conv = await sendWidget(app, widgetToken, { text: "menu", visitorId: "v4" });
    const msgs1 = await messagesOf(app, alice.token, ws, conv);
    expect(msgs1.some((m) => m.direction === "saida" && m.text?.includes("Escolha:"))).toBe(true);

    // segunda mensagem do MESMO contato/conversa
    await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: auth(widgetToken),
      payload: { text: "1", visitorId: "v4" },
    });
    const msgs2 = await messagesOf(app, alice.token, ws, conv);
    expect(msgs2.some((m) => m.direction === "saida" && m.text === "Abrindo suporte.")).toBe(true);
    const tickets = (
      await app.inject({
      method: "GET",
      url: `/workspaces/${ws}/queues/tickets?queueId=${queue.id}`,
      headers: auth(alice.token),
    })).json();
    expect(tickets.data).toHaveLength(1);
  });

    it("bot fica quieto quando a conversa já tem atendente atribuído", async () => {
    await app.inject({
      method: "PUT",
      url: `/workspaces/${ws}/settings`,
      headers: auth(alice.token),
      payload: { businessHours: SEMPRE_ABERTO },
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/bots`,
      headers: auth(alice.token),
      payload: { name: "preço", kind: "palavra_chave", terms: ["preço"], reply: "Resposta do bot." },
    });
    await store.addMember({ workspaceId: ws, userId: alice.userId, role: "admin_ws" });
    const convId = await sendWidget(app, widgetToken, { text: "oi", visitorId: "v9" });
    await store.assignConversation(ws, convId, alice.userId);
    await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: auth(widgetToken),
      payload: { text: "qual o preço?", visitorId: "v9" },
    });
    const msgs = await store.listMessages(ws, convId);
    const botReplies = msgs.filter((m) => m.direction === "saida" && m.text === "Resposta do bot.");
    expect(botReplies).toHaveLength(0);
  });
});

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";
import { runFlowsOnIncoming } from "../src/modules/flows.js";
import { RealtimeHub } from "../src/realtime/hub.js";
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
/** Cria uma chave de API via REST e devolve o segredo (única vez). */
async function issueApiKey(
  app: FastifyInstance,
  token: string,
  workspaceId: string,
  scopes: string[],
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/workspaces/${workspaceId}/api-keys`,
    headers: auth(token),
    payload: { name: "agente", scopes },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { key: string }).key;
}

describe("F5 — fluxos + módulos", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let ws: string;
  let key: string;

  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp({ store, jwtSecret: SECRET });
    alice = await register(app, {
      email: "dono@exemplo.com",
      password: "senha-forte-1",
      name: "Dono",
    });
    ws = await createWorkspace(app, alice.token, "WS F5");
    key = await issueApiKey(app, alice.token, ws, ["mcp", "api:leitura", "api:escrita"]);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("fluxos no intake", () => {
    it("executa os passos na ordem quando o termo casa", async () => {
      const queue = await store.createQueue({ workspaceId: ws, name: "Geral" });
      const contact = await store.createContact({ workspaceId: ws, name: "Pedro" });
      const conversation = await store.createConversation({
        workspaceId: ws,
        contactId: contact.id,
        channel: "whatsapp",
      });
      await store.createFlow({
        workspaceId: ws,
        name: "Boas-vindas",
        terms: ["oi"],
        steps: [
          { action: "responder", payload: { text: "Olá!" } },
          { action: "enfileirar", payload: { queueId: queue.id } },
          { action: "encerrar", payload: {} },
        ],
      });

      const hub = new RealtimeHub();
      const eventos: string[] = [];
      hub.subscribe(ws, (event) => eventos.push(event.kind));

      const run = await runFlowsOnIncoming(
        { store, hub },
        { workspaceId: ws, conversationId: conversation.id, channel: "whatsapp", text: "oi, tudo bem?" },
      );
      expect(run?.matched).toBe("oi");
      expect(eventos).toContain("fluxo.executado");

      const mensagens = await store.listMessages(ws, conversation.id);
      expect(mensagens.filter((m) => m.direction === "saida")).toHaveLength(1);
      // O passo `encerrar` fecha o ticket, então procuramos pelo histórico.
      const ticket = (await store.listTickets(ws, { queueId: queue.id }))[0];
      expect(ticket?.status).toBe("resolvido");
      const depois = await store.findConversationById(ws, conversation.id);
      expect(depois?.status).toBe("resolvido");
    });

    it("não casa quando o termo não aparece", async () => {
      const contact = await store.createContact({ workspaceId: ws, name: "Pedro" });
      const conversation = await store.createConversation({
        workspaceId: ws,
        contactId: contact.id,
        channel: "whatsapp",
      });
      await store.createFlow({
        workspaceId: ws,
        name: "Spam",
        terms: ["promoção"],
        steps: [{ action: "responder", payload: { text: "não" } }],
      });
      const run = await runFlowsOnIncoming(
        { store, hub: new RealtimeHub() },
        { workspaceId: ws, conversationId: conversation.id, channel: "whatsapp", text: "oi" },
      );
      expect(run).toBeNull();
      expect(await store.listMessages(ws, conversation.id)).toHaveLength(0);
    });

    it("fluxo de outro workspace não executa aqui", async () => {
      const outra = await createWorkspace(app, alice.token, "Outro");
      await store.createFlow({
        workspaceId: outra,
        name: "Alheio",
        terms: ["oi"],
        steps: [{ action: "responder", payload: { text: "vazamento" } }],
      });
      const contact = await store.createContact({ workspaceId: ws, name: "Pedro" });
      const conversation = await store.createConversation({
        workspaceId: ws,
        contactId: contact.id,
        channel: "whatsapp",
      });
      const run = await runFlowsOnIncoming(
        { store, hub: new RealtimeHub() },
        { workspaceId: ws, conversationId: conversation.id, channel: "whatsapp", text: "oi" },
      );
      expect(run).toBeNull();
    });
  });

  describe("módulos extensíveis", () => {
    it("módulo extra registrado traz a rota e a tool", async () => {
      const appExtra = await buildApp({
        store,
        jwtSecret: SECRET,
        modules: [
          {
            key: "sondagem",
            name: "Sondagem",
            description: "Módulo de teste.",
            version: "0.1.0",
            routes: async ({ app: instance, store: s }) => {
              instance.get("/sondagem/ping", { onRequest: [instance.authenticate] }, async () => ({
                ok: true,
                tenant: ws,
                temStore: Boolean(s),
              }));
            },
            mcpTools: [
              {
                name: "sondar",
                description: "Devolve um pong.",
                inputSchema: { type: "object", properties: {} },
                scopes: ["mcp"],
                handler: async (args) => ({ pong: true, workspaceId: args.workspaceId }),
              },
            ],
          },
        ],
      });
      const res = await appExtra.inject({
        method: "GET",
        url: "/sondagem/ping",
        headers: auth(alice.token),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);

      const tools = await appExtra.inject({
        method: "GET",
        url: "/mcp/tools",
        headers: { "x-api-key": key },
      });
      const nomes = (tools.json() as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      expect(nomes).toContain("sondar");
      await appExtra.close();
    });
  });
});

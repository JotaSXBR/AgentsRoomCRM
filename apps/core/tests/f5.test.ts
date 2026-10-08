import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";
import {
  deliverAllWorkspaces,
  emitWebhookEvent,
  processWebhookDeliveries,
} from "../src/webhooks/dispatcher.js";
import { runFlowsOnIncoming } from "../src/modules/flows.js";
import { RealtimeHub } from "../src/realtime/hub.js";
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

function rpc(method: string, params?: unknown, id = 1): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

async function callMcp(
  app: FastifyInstance,
  key: string,
  method: string,
  params?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { "x-api-key": key },
    payload: rpc(method, params),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

/** Texto do primeiro content[0] de um resultado MCP. */
function toolText(body: Record<string, unknown>): string {
  const result = body.result as { content: Array<{ text: string }> };
  return result.content[0].text;
}

function toolJson(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(toolText(body)) as Record<string, unknown>;
}

describe("F5 — API pública + MCP + relatórios + LGPD", () => {
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

  describe("chaves de API", () => {
    it("cria chave, devolve o segredo uma vez e autentica o catálogo", async () => {
      const list = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/api-keys`,
        headers: auth(alice.token),
      });
      expect(list.statusCode).toBe(200);
      const data = (list.json() as { data: Array<Record<string, unknown>> }).data;
      expect(data).toHaveLength(1);
      // O hash jamais sai do servidor, nem para o dono do workspace.
      expect(JSON.stringify(data)).not.toContain("keyHash");
      expect(data[0].prefix).toMatch(/^ark_live_/);

      const catalog = await app.inject({
        method: "GET",
        url: "/api/public/catalog",
        headers: { authorization: `Bearer ${key}` },
      });
      expect(catalog.statusCode).toBe(200);
      expect((catalog.json() as { workspaceId: string }).workspaceId).toBe(ws);
    });

    it("sem chave ou com chave revogada responde 401", async () => {
      const anon = await app.inject({ method: "POST", url: "/mcp", payload: rpc("tools/list") });
      expect(anon.statusCode).toBe(401);

      const keys = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/api-keys`,
        headers: auth(alice.token),
      });
      const id = (keys.json() as { data: Array<{ id: string }> }).data[0].id;
      await app.inject({
        method: "DELETE",
        url: `/workspaces/${ws}/api-keys/${id}`,
        headers: auth(alice.token),
      });
      const revoked = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { "x-api-key": key },
        payload: rpc("tools/list"),
      });
      expect(revoked.statusCode).toBe(401);
    });
  });

  describe("servidor MCP", () => {
    it("initialize e tools/list devolvem o contrato", async () => {
      const init = await callMcp(app, key, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agente", version: "1" },
      });
      const info = init.body.result as { serverInfo: { name: string }; protocolVersion: string };
      expect(info.serverInfo.name).toBe("agentsroom-crm");
      expect(info.protocolVersion).toBe("2025-06-18");

      const list = await callMcp(app, key, "tools/list");
      const tools = (list.body.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.map((t) => t.name)).toContain("criar_fluxo");
    });

    it("agente externo cria o fluxo inteiro: fila, regra e fluxo", async () => {
      const fila = await callMcp(app, key, "tools/call", {
        name: "criar_fila",
        arguments: { workspaceId: ws, name: "Comercial", channel: "whatsapp", isDefault: true },
      });
      const filaJson = toolJson(fila.body);
      expect(filaJson.name).toBe("Comercial");

      await callMcp(app, key, "tools/call", {
        name: "criar_regra_bot",
        arguments: {
          workspaceId: ws,
          name: "Menu inicial",
          kind: "menu",
          reply: "Escolha:",
          options: [
            { label: "Vendas", reply: "Transferindo para vendas", queueName: "Comercial" },
            { label: "Suporte", reply: "Transferindo para suporte", queueName: "Suporte" },
          ],
        },
      });

      const fluxo = await callMcp(app, key, "tools/call", {
        name: "criar_fluxo",
        arguments: {
          workspaceId: ws,
          name: "Boas-vindas",
          terms: ["oi", "olá"],
          steps: [
            { action: "responder", payload: { text: "Olá! Bem-vindo." } },
            { action: "enfileirar", payload: { queueName: "Comercial" } },
          ],
        },
      });
      const flowJson = toolJson(fluxo.body);
      expect(flowJson.name).toBe("Boas-vindas");

      // As filas citadas por nome foram criadas; o passo guardou o id.
      const queues = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
      });
      const names = (queues.json() as { data: Array<{ name: string }> }).data.map((q) => q.name);
      expect(names).toEqual(expect.arrayContaining(["Comercial", "Suporte"]));

      const steps = (flowJson.steps as Array<{ payload: Record<string, unknown> }>).map(
        (s) => s.payload,
      );
      expect(steps[1].queueId).toBeTruthy();
    });

    it("o workspaceId do argumento nunca sobrepõe o da chave", async () => {
      const outra = await createWorkspace(app, alice.token, "Outro WS");
      const lista = await callMcp(app, key, "tools/call", {
        name: "criar_fila",
        arguments: { workspaceId: outra, name: "Invasora" },
      });
      const fila = toolJson(lista.body);
      expect(fila.workspaceId).toBe(ws);

      // A fila foi criada no tenant da chave, não no informado pelo agente.
      const alheio = await app.inject({
        method: "GET",
        url: `/workspaces/${outra}/queues`,
        headers: auth(alice.token),
      });
      expect((alheio.json() as { data: unknown[] }).data).toHaveLength(0);
    });

    it("escopo insuficiente é recusado e tool desconhecida também", async () => {
      const leitura = await issueApiKey(app, alice.token, ws, ["api:leitura"]);
      const negado = await callMcp(app, leitura, "tools/call", {
        name: "criar_fila",
        arguments: { workspaceId: ws, name: "Negada" },
      });
      expect(negado.body.error).toMatchObject({ code: -32603 });

      const inexistente = await callMcp(app, key, "tools/call", {
        name: "nao_existe",
        arguments: {},
      });
      expect(inexistente.body.error).toMatchObject({ code: -32602 });

      // A chave de leitura não enxerga as tools de escrita na listagem.
      const visao = await callMcp(app, leitura, "tools/list");
      const nomes = (visao.body.result as { tools: Array<{ name: string }> }).tools.map(
        (t) => t.name,
      );
      expect(nomes).not.toContain("criar_fila");
      expect(nomes).toContain("metricas_qualidade");
    });

    it("erro de tool volta como isError, sem derrubar a sessão", async () => {
      await callMcp(app, key, "tools/call", {
        name: "criar_fila",
        arguments: { workspaceId: ws, name: "Comercial" },
      });
      const resposta = await callMcp(app, key, "tools/call", {
        name: "criar_fila",
        arguments: { workspaceId: ws, name: "Comercial" },
      });
      const result = resposta.body.result as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Já existe uma fila/);

      // A sessão continua viva: a chamada seguinte funciona normalmente.
      const depois = await callMcp(app, key, "tools/list");
      expect((depois.body.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
    });
  });

  describe("relatórios TME/TMA/CSAT", () => {
    it("confere com a base: um ticket por atendente, com nota", async () => {
      const queue = await store.createQueue({ workspaceId: ws, name: "Geral" });
      const contact = await store.createContact({ workspaceId: ws, name: "Maria" });
      const conversation = await store.createConversation({
        workspaceId: ws,
        contactId: contact.id,
        channel: "whatsapp",
      });
      const ticket = await store.enqueueTicket({
        workspaceId: ws,
        queueId: queue.id,
        conversationId: conversation.id,
        channel: "whatsapp",
      });
      // TME = 60s, TMA = 120s.
      const enq = Date.parse(ticket.enqueuedAt);
      await store.updateTicket(ws, ticket.id, {
        assignedUserId: alice.userId,
        firstResponseAt: new Date(enq + 60_000).toISOString(),
        resolvedAt: new Date(enq + 180_000).toISOString(),
        status: "resolvido",
      });
      await store.rateConversation({
        workspaceId: ws,
        conversationId: conversation.id,
        score: 5,
      });

      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/reports/quality?groupBy=assignee&tmeAlvoSeg=90`,
        headers: auth(alice.token),
      });
      expect(res.statusCode).toBe(200);
      const report = res.json() as {
        totals: Record<string, number | null>;
        data: Array<Record<string, number | null | string>>;
      };
      expect(report.totals.tmeMedioSeg).toBe(60);
      expect(report.totals.tmaMedioSeg).toBe(120);
      expect(report.totals.csatMedio).toBe(5);
      expect(report.totals.csatRespostas).toBe(1);
      expect(report.totals.slaTmePct).toBe(100);
      expect(report.data).toHaveLength(1);
      expect(report.data[0].key).toBe(alice.userId);

      const csv = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/reports/quality.csv?groupBy=channel`,
        headers: auth(alice.token),
      });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toMatch(/text\/csv/);
      expect(csv.body).toMatch(/grupo,tickets,resolvidos/);
      expect(csv.body).toMatch(/whatsapp/);
    });

    it("agrupa por fila e ignora ticket fora da janela", async () => {
      const filaA = await store.createQueue({ workspaceId: ws, name: "A" });
      const filaB = await store.createQueue({ workspaceId: ws, name: "B" });
      const contact = await store.createContact({ workspaceId: ws, name: "João" });
      const hoje = await store.createConversation({ workspaceId: ws, contactId: contact.id, channel: "widget" });
      const antiga = await store.createConversation({ workspaceId: ws, contactId: contact.id, channel: "widget" });
      await store.enqueueTicket({
        workspaceId: ws,
        queueId: filaA.id,
        conversationId: hoje.id,
        channel: "widget",
      });
      const velho = await store.enqueueTicket({
        workspaceId: ws,
        queueId: filaB.id,
        conversationId: antiga.id,
        channel: "widget",
      });
      // Empurra o ticket para 40 dias atrás: a janela do relatório o exclui.
      store.tickets.set(velho.id, {
        ...velho,
        enqueuedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      });

      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/reports/quality?groupBy=queue&from=${new Date(Date.now() - 7 * 86_400_000).toISOString()}`,
        headers: auth(alice.token),
      });
      const report = res.json() as { data: Array<{ key: string }> };
      expect(report.data.map((d) => d.key)).toEqual(["A"]);
    });

    it("CSAT fora da escala é recusado com 400", async () => {
      const contact = await store.createContact({ workspaceId: ws, name: "Ana" });
      const conversation = await store.createConversation({
        workspaceId: ws,
        contactId: contact.id,
        channel: "widget",
      });
      const res = await app.inject({
        method: "PUT",
        url: `/workspaces/${ws}/inbox/conversations/${conversation.id}/rating`,
        headers: auth(alice.token),
        payload: { score: 9 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("LGPD", () => {
    async function contactComDados(): Promise<string> {
      const contact = await store.createContact({
        workspaceId: ws,
        name: "Titular",
        phone: "5511999999999",
        email: "titular@exemplo.com",
      });
      const conversation = await store.createConversation({
        workspaceId: ws,
        contactId: contact.id,
        channel: "whatsapp",
      });
      await store.addMessage({
        workspaceId: ws,
        conversationId: conversation.id,
        direction: "entrada",
        text: "segredo do cliente",
      });
      return contact.id;
    }

    it("consentimento é registrado e revogado com carimbo de data", async () => {
      const contactId = await contactComDados();
      const granted = await app.inject({
        method: "PUT",
        url: `/workspaces/${ws}/contacts/${contactId}/consents`,
        headers: auth(alice.token),
        payload: { kind: "marketing", granted: true },
      });
      expect(granted.statusCode).toBe(200);
      expect((granted.json() as { grantedAt: string | null }).grantedAt).toBeTruthy();

      const revoked = await app.inject({
        method: "PUT",
        url: `/workspaces/${ws}/contacts/${contactId}/consents`,
        headers: auth(alice.token),
        payload: { kind: "marketing", granted: false },
      });
      const body = revoked.json() as { granted: boolean; revokedAt: string | null };
      expect(body.granted).toBe(false);
      expect(body.revokedAt).toBeTruthy();

      const list = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/contacts/${contactId}/consents`,
        headers: auth(alice.token),
      });
      expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
    });

    it("exportação devolve tudo do titular e registra a solicitação", async () => {
      const contactId = await contactComDados();
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/contacts/${contactId}/export`,
        headers: auth(alice.token),
      });
      expect(res.statusCode).toBe(200);
      const data = res.json() as { conversations: Array<{ messages: Array<{ text: string }> }> };
      expect(data.conversations[0].messages[0].text).toBe("segredo do cliente");

      const trilha = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/lgpd/requests`,
        headers: auth(alice.token),
      });
      const reqs = (trilha.json() as { data: Array<{ action: string }> }).data;
      expect(reqs.map((r) => r.action)).toContain("acesso");
    });

    it("exclusão apaga o conteúdo e anonimiza o cadastro", async () => {
      const contactId = await contactComDados();
      const res = await app.inject({
        method: "DELETE",
        url: `/workspaces/${ws}/contacts/${contactId}/data`,
        headers: auth(alice.token),
        payload: { motivo: "Solicitação do titular" },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { summary: Record<string, number> }).summary.mensagens_removidas).toBe(1);

      const contact = await store.findContactById(ws, contactId);
      expect(contact?.name).toBe("Contato eliminado (LGPD)");
      expect(contact?.phone).toBeNull();
      expect(contact?.email).toBeNull();
      expect(await store.listConversations(ws)).toHaveLength(0);

      const trilha = await app.inject({
        method: "GET",
        url: `/workspaces/${ws}/lgpd/requests`,
        headers: auth(alice.token),
      });
      const reqs = (trilha.json() as { data: Array<{ action: string; summary: Record<string, unknown> }> })
        .data;
      expect(reqs[0].summary.motivo).toBe("Solicitação do titular");
    });

    it("exclusão do workspace zera todos os contatos", async () => {
      await contactComDados();
      await contactComDados();
      const res = await app.inject({
        method: "DELETE",
        url: `/workspaces/${ws}/data`,
        headers: auth(alice.token),
        payload: { motivo: "Encerramento de operação" },
      });
      const summary = (res.json() as { summary: Record<string, number> }).summary;
      expect(summary.contatos_anonimizados).toBe(2);
      for (const contact of await store.listContacts(ws)) {
        expect(contact.name).toBe("Contato eliminado (LGPD)");
      }
    });

    it("atendente não exclui dados de terceiros", async () => {
      const contactId = await contactComDados();
      const atendente = await register(app, {
        email: "atendente@exemplo.com",
        password: "senha-forte-2",
        name: "Atendente",
      });
      await store.addMember({
        workspaceId: ws,
        userId: atendente.userId,
        role: "atendente",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/workspaces/${ws}/contacts/${contactId}/data`,
        headers: auth(atendente.token),
        payload: { motivo: "tentativa" },
      });
      expect(res.statusCode).toBe(403);
      // A exclusão não aconteceu: o contato segue intacto.
      const contact = await store.findContactById(ws, contactId);
      expect(contact?.name).toBe("Titular");
    });
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
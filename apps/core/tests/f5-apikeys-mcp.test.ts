import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";
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

describe("F5 — chaves de API + MCP", () => {
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
});

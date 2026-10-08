import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";
import type { AiChatCaller } from "../src/ai/provider.js";

const SECRET = "test-secret-f4";

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
): Promise<Array<{ direction: string; kind: string; text: string | null }>> {
  const res = await app.inject({
    method: "GET",
    url: `/workspaces/${ws}/inbox/conversations/${conversationId}`,
    headers: auth(token),
  });
  return (res.json() as { messages: Array<{ direction: string; kind: string; text: string | null }> }).messages;
}

const fakeCaller: AiChatCaller = async () => ({
  answer: "Atendemos de segunda a sexta, das 9h às 18h.",
  inputTokens: 120,
  outputTokens: 20,
});

describe("F4 IA híbrida BYOK + Ollama + RAG + fallback", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let ws: string;
  let widgetToken: string;

  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp({ store, jwtSecret: SECRET, ai: { chatCaller: fakeCaller } });
    alice = await register(app, { email: "dono@exemplo.com", password: "senha-forte-1", name: "Dono" });
    const res = await app.inject({
      method: "POST",
      url: "/workspaces",
      headers: auth(alice.token),
      payload: { name: "WS F4" },
    });
    ws = res.json().id;
    widgetToken = await createWidgetToken(app, alice.token, ws);
  });

  afterEach(async () => {
    await app.close();
  });

  async function enableAi(): Promise<void> {
    await app.inject({
      method: "PUT",
      url: `/workspaces/${ws}/ai/settings`,
      headers: auth(alice.token),
      payload: { enabled: true },
    });
  }

  async function putProvider(payload: Record<string, unknown>): Promise<unknown> {
    return app.inject({
      method: "PUT",
      url: `/workspaces/${ws}/ai/provider`,
      headers: auth(alice.token),
      payload,
    });
  }

  it("pergunta FAQ responde com fonte e registra log com custo", async () => {
    await enableAi();
    await putProvider({
      kind: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/ai/sources`,
      headers: auth(alice.token),
      payload: {
        kind: "faq",
        title: "Horário de atendimento",
        content: "Horário de atendimento: de segunda a sexta, das 9h às 18h. Sábados e domingos fechado.",
      },
    });
    await putProvider({
      kind: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
      priceInputPerMtok: 0,
      priceOutputPerMtok: 0,
    });

    const conversationId = await sendWidget(app, widgetToken, { text: "qual o horário de atendimento?" });
    const messages = await messagesOf(app, alice.token, ws, conversationId);
    const answers = messages.filter((m) => m.direction === "saida");
    expect(answers.length).toBe(1);
    expect(answers[0].text).toContain("Atendemos de segunda a sexta");
    expect(answers[0].text).toContain("Fonte: Horário de atendimento");

    const logs = (
      await app.inject({ method: "GET", url: `/workspaces/${ws}/ai/logs`, headers: auth(alice.token) })
    ).json() as { data: Array<{ outcome: string; sources: Array<{ title: string }>; inputTokens: number; costUsd: number | null; prompt: string }> };
    expect(logs.data).toHaveLength(1);
    expect(logs.data[0].outcome).toBe("respondido");
    expect(logs.data[0].sources[0].title).toBe("Horário de atendimento");
    expect(logs.data[0].inputTokens).toBe(120);
    expect(logs.data[0].prompt).toContain("qual o horário de atendimento");
  });

  it("sem fonte na base transfere a humano com contexto", async () => {
    await enableAi();
    await putProvider({ kind: "ollama", baseUrl: "http://localhost:11434", model: "llama3.1" });
    // Sem nenhuma fonte cadastrada → sem chunks → fallback imediato.
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/queues`,
      headers: auth(alice.token),
      payload: { name: "geral", isDefault: true },
    });
    const conversationId = await sendWidget(app, widgetToken, { text: "vocês vendem bicicleta?" });
    const messages = await messagesOf(app, alice.token, ws, conversationId);
    const fallback = messages.filter((m) => m.direction === "saida");
    expect(fallback.some((m) => (m.text ?? "").includes("atendente humano"))).toBe(true);
    const tickets = await store.listTickets(ws, {});
    expect(tickets.some((t) => t.conversationId === conversationId)).toBe(true);
    const logs = await store.listAiLogs(ws);
    expect(logs[0].outcome).toBe("fallback");
    expect(logs[0].fallbackReason).toContain("sem_fonte");
  });

  it("provedor fora do ar: fallback humano + log de erro", async () => {
    await app.close();
    store = new MemoryStore();
    const failing: AiChatCaller = async () => {
      throw new Error("conexão recusada");
    };
    app = await buildApp({ store, jwtSecret: SECRET, ai: { chatCaller: failing } });
    alice = await register(app, { email: "dono@exemplo.com", password: "senha-forte-1", name: "Dono" });
    const res = await app.inject({
      method: "POST", url: "/workspaces", headers: auth(alice.token), payload: { name: "WS F4" },
    });
    ws = res.json().id;
    widgetToken = await createWidgetToken(app, alice.token, ws);
    await enableAi();
    await putProvider({ kind: "openai_compatible", baseUrl: "https://api.exemplo.com/v1", model: "gpt-x", apiKey: "sk-teste-123" });
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/ai/sources`,
      headers: auth(alice.token),
      payload: { kind: "faq", title: "Frete", content: "Frete grátis acima de R$ 200 para todo o Brasil." },
    });
    const conversationId = await sendWidget(app, widgetToken, { text: "como funciona o frete?" });
    const messages = await messagesOf(app, alice.token, ws, conversationId);
    expect(messages.some((m) => (m.text ?? "").includes("atendente humano"))).toBe(true);
    const logs = await store.listAiLogs(ws);
    expect(logs[0].outcome).toBe("fallback");
    expect(logs[0].fallbackReason).toContain("erro_na_ia");
  });

  it("chave BYOK é gravada cifrada e nunca exposta pela API", async () => {
    await putProvider({
      kind: "openai_compatible",
      baseUrl: "https://api.exemplo.com/v1",
      model: "gpt-x",
      apiKey: "sk-secreto-xyz",
    });
    const provider = await store.getAiProvider(ws);
    expect(provider?.apiKeyEnc).toMatch(/^v1\./);
    expect(provider?.apiKeyEnc).not.toContain("sk-secreto-xyz");
    const res = await app.inject({ method: "GET", url: `/workspaces/${ws}/ai/provider`, headers: auth(alice.token) });
    const body = res.json() as Record<string, unknown>;
    expect(body.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-secreto-xyz");
    expect(JSON.stringify(body)).not.toContain("apiKeyEnc");
  });

  it("regra de palavra-chave tem prioridade sobre a IA", async () => {
    await enableAi();
    await putProvider({ kind: "ollama", baseUrl: "http://localhost:11434", model: "llama3.1" });
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/ai/sources`,
      headers: auth(alice.token),
      payload: { kind: "faq", title: "Horário", content: "Atendemos das 9h às 18h." },
    });
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/bots`,
      headers: auth(alice.token),
      payload: { name: "oi", kind: "palavra_chave", terms: ["horário"], reply: "Resposta da regra." },
    });
    const conversationId = await sendWidget(app, widgetToken, { text: "qual o horário?" });
    const messages = await messagesOf(app, alice.token, ws, conversationId);
    const answers = messages.filter((m) => m.direction === "saida");
    expect(answers).toHaveLength(1);
    expect(answers[0].text).toBe("Resposta da regra.");
    expect(await store.listAiLogs(ws)).toHaveLength(0);
  });
});

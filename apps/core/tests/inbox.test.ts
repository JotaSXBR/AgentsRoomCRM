import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";

const SECRET = "test-secret-f1";
const S3 = {
  s3Endpoint: "http://rustfs.local:9000",
  s3Region: "us-east-1",
  s3AccessKey: "testkey",
  s3SecretKey: "testsecret",
  s3BucketMidia: "crm-midia",
};

interface Session {
  token: string;
  userId: string;
  email: string;
}

async function register(
  app: FastifyInstance,
  input: { email: string; password: string; name: string },
): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: input });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id, email: input.email };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function createWorkspace(
  app: FastifyInstance,
  token: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers: auth(token),
    payload: { name },
  });
  return res.json().id;
}

describe("F1 inbox + contatos + realtime", () => {
  let app: FastifyInstance;
  let alice: Session;
  let carol: Session;
  let bob: Session;
  let ws1: string;
  let ws2: string;
  let contactId: string;
  let convoId: string;

  beforeEach(async () => {
    app = await buildApp({ store: new MemoryStore(), jwtSecret: SECRET, s3: S3 });
    alice = await register(app, { email: "alice@exemplo.com", password: "senha-forte-1", name: "Alice" });
    carol = await register(app, { email: "carol@exemplo.com", password: "senha-forte-2", name: "Carol" });
    bob = await register(app, { email: "bob@exemplo.com", password: "senha-forte-3", name: "Bob" });
    ws1 = await createWorkspace(app, alice.token, "Wokspace Um");
    ws2 = await createWorkspace(app, bob.token, "Workspace Dois");

    // Carol é atendente no ws1 (convite por Alice).
    const invite = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/invites`,
      headers: auth(alice.token),
      payload: { email: carol.email, role: "atendente" },
    });
    const { token } = invite.json() as { token: string };
    await app.inject({
      method: "POST",
      url: "/invites/accept",
      headers: auth(carol.token),
      payload: { token },
    });

    const contact = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/contacts`,
      headers: auth(alice.token),
      payload: { name: "Cliente WS1", phone: "+5511999" },
    });
    contactId = contact.json().id;
    const convo = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/inbox/conversations`,
      headers: auth(alice.token),
      payload: { contactId, channel: "whatsapp", subject: "Orçamento" },
    });
    convoId = convo.json().id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("caixa unificada: lista, atribuição, status, notas, tags, pesquisa", async () => {
    // atribuição manual + status
    const patched = await app.inject({
      method: "PATCH",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}`,
      headers: auth(alice.token),
      payload: { assigneeId: carol.userId, status: "pendente" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ assigneeId: carol.userId, status: "pendente" });

    // atendente de outro workspace não vê a conversa
    const fora = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}`,
      headers: auth(bob.token),
    });
    expect(fora.statusCode).toBe(403);

    // Carol (atendente do ws1) vê
    const dentro = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}`,
      headers: auth(carol.token),
    });
    expect(dentro.statusCode).toBe(200);

    // nota interna
    const note = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}/notes`,
      headers: auth(carol.token),
      payload: { content: "Cliente pediu retorno até sexta." },
    });
    expect(note.statusCode).toBe(201);

    // tag + pesquisa por tag
    const tag = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/tags`,
      headers: auth(alice.token),
      payload: { name: "vip", color: "#f00" },
    });
    const tagId = tag.json().id;
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}/tags`,
      headers: auth(alice.token),
      payload: { tagId },
    });
    const byTag = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/conversations?tagId=${tagId}`,
      headers: auth(alice.token),
    });
    expect(byTag.json().total).toBe(1);

    // pesquisa por texto (assunto/contato)
    const q = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/conversations?q=orçamento`,
      headers: auth(alice.token),
    });
    expect(q.json().total).toBe(1);

    // mensagem entra e sai
    const msg = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}/messages`,
      headers: auth(carol.token),
      payload: { text: "Olá! Posso ajudar?", direction: "saida" },
    });
    expect(msg.statusCode).toBe(201);
  });

  it("contato unificado multicanal: canais, merge e timeline", async () => {
    const dup = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/contacts`,
      headers: auth(alice.token),
      payload: { name: "Cliente WS1 (insta)", email: "c@x.com" },
    });
    const dupId = dup.json().id;

    await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/contacts/${dupId}/channels`,
      headers: auth(alice.token),
      payload: { channel: "instagram", value: "@cliente" },
    });

    const merged = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/contacts/${dupId}/merge`,
      headers: auth(alice.token),
      payload: { targetId: contactId },
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().contact.id).toBe(contactId);

    const survivor = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/contacts/${contactId}`,
      headers: auth(alice.token),
    });
    expect(survivor.json().channels.length).toBe(1);

    const timeline = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/contacts/${contactId}/timeline`,
      headers: auth(alice.token),
    });
    expect(timeline.json().data.some((e: { kind: string }) => e.kind === "merge")).toBe(true);

    // duplicado absorvido some da lista
    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/contacts`,
      headers: auth(alice.token),
    });
    const ids = list.json().data.map((c: { id: string }) => c.id);
    expect(ids).toContain(contactId);
    expect(ids).not.toContain(dupId);
  });

  it("mídia: presigned URL com prefixo do workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/media/presign`,
      headers: auth(carol.token),
      payload: { filename: "orçamento final.pdf", contentType: "application/pdf", size: 1024 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadUrl).toContain("crm-midia");
    expect(body.key).toContain(`${ws1}/`);

    // cruzar workspace → 403
    const fora = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/media/presign`,
      headers: auth(bob.token),
      payload: { filename: "x", contentType: "image/png", size: 10 },
    });
    expect(fora.statusCode).toBe(403);
  });

  it("polling fallback devolve atualizações depois de `since`", async () => {
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}/messages`,
      headers: auth(carol.token),
      payload: { text: "Ping", direction: "saida" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1}/inbox/updates?since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`,
      headers: auth(carol.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages.length).toBeGreaterThanOrEqual(1);
  });

  it("realtime: 2 atendentes no mesmo workspace, sem vazar para outro", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const urlFor = (wsid: string, token: string) =>
      `ws://127.0.0.1:${port}/workspaces/${wsid}/ws?token=${token}`;

    const a = new WebSocket(urlFor(ws1, alice.token));
    const c = new WebSocket(urlFor(ws1, carol.token));
    const b = new WebSocket(urlFor(ws2, bob.token));

    const eventsA: unknown[] = [];
    const eventsC: unknown[] = [];
    const eventsB: unknown[] = [];
    a.on("message", (d) => eventsA.push(JSON.parse(String(d))));
    c.on("message", (d) => eventsC.push(JSON.parse(String(d))));
    b.on("message", (d) => eventsB.push(JSON.parse(String(d))));

    await Promise.all([
      new Promise((r) => a.on("open", r)),
      new Promise((r) => c.on("open", r)),
      new Promise((r) => b.on("open", r)),
    ]);

    // Alice envia mensagem no ws1 → evento deve ir para alice+carol, NÃO para bob
    await app.inject({
      method: "POST",
      url: `/workspaces/${ws1}/inbox/conversations/${convoId}/messages`,
      headers: auth(alice.token),
      payload: { text: "Oferta enviada", direction: "saida" },
    });

    await new Promise((r) => setTimeout(r, 300));

    const msgA = eventsA.filter((e) => (e as { kind: string }).kind === "mensagem.criada");
    const msgC = eventsC.filter((e) => (e as { kind: string }).kind === "mensagem.criada");
    const msgB = eventsB.filter((e) => (e as { kind: string }).kind === "mensagem.criada");
    expect(msgA.length).toBe(1);
    expect(msgC.length).toBe(1);
    expect(msgB.length).toBe(0);

    a.close();
    c.close();
    b.close();
  });
});

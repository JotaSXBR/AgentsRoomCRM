import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";

const SECRET = "test-secret-f0";

interface Session {
  token: string;
  userId: string;
  email: string;
  isOwnerGlobal: boolean;
}

async function register(
  app: FastifyInstance,
  input: { email: string; password: string; name: string },
): Promise<Session> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: input,
  });
  if (res.statusCode !== 201) throw new Error(`register falhou: ${res.body}`);
  const body = res.json() as {
    token: string;
    user: { id: string; email: string; isOwnerGlobal: boolean };
  };
  return {
    token: body.token,
    userId: body.user.id,
    email: body.user.email,
    isOwnerGlobal: body.user.isOwnerGlobal,
  };
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function createWorkspace(
  app: FastifyInstance,
  token: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers: auth(token),
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("isolamento cross-workspace (critério F0)", () => {
  let app: FastifyInstance;
  let owner: Session;
  let alice: Session;
  let bob: Session;
  let ws1: { id: string };
  let ws2: { id: string };

  beforeEach(async () => {
    app = await buildApp({ store: new MemoryStore(), jwtSecret: SECRET });
    owner = await register(app, {
      email: "dono@exemplo.com",
      password: "senha-forte-1",
      name: "Dono",
    });
    expect(owner.isOwnerGlobal).toBe(true);
    alice = await register(app, {
      email: "alice@exemplo.com",
      password: "senha-forte-2",
      name: "Alice",
    });
    bob = await register(app, {
      email: "bob@exemplo.com",
      password: "senha-forte-3",
      name: "Bob",
    });
    ws1 = await createWorkspace(app, alice.token, "Workspace Um");
    ws2 = await createWorkspace(app, bob.token, "Workspace Dois");

    // Dado de prova: contato criado por Alice dentro do ws1.
    const created = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1.id}/contacts`,
      headers: auth(alice.token),
      payload: { name: "Contato WS1" },
    });
    expect(created.statusCode).toBe(201);
  });

  it("membro de outro workspace recebe 403 (leitura e escrita)", async () => {
    const leitura = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1.id}/contacts`,
      headers: auth(bob.token),
    });
    expect(leitura.statusCode).toBe(403);
    expect(leitura.json()).toMatchObject({ code: "forbidden" });

    const escrita = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1.id}/contacts`,
      headers: auth(bob.token),
      payload: { name: "Invasor" },
    });
    expect(escrita.statusCode).toBe(403);
  });

  it("sem token recebe 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1.id}/contacts`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("owner_global tem acesso transversal", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1.id}/contacts`,
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it("listagem de workspaces não vaza o workspace alheio", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers: auth(bob.token),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((w) => w.id);
    expect(ids).toContain(ws2.id);
    expect(ids).not.toContain(ws1.id);
  });

  it("convite: atendente entra no workspace certo e continua sem acesso ao outro", async () => {
    const carol = await register(app, {
      email: "carol@exemplo.com",
      password: "senha-forte-4",
      name: "Carol",
    });

    const invite = await app.inject({
      method: "POST",
      url: `/workspaces/${ws1.id}/invites`,
      headers: auth(alice.token),
      payload: { email: carol.email, role: "atendente" },
    });
    expect(invite.statusCode).toBe(201);
    const { token } = invite.json() as { token: string };

    const accept = await app.inject({
      method: "POST",
      url: "/invites/accept",
      headers: auth(carol.token),
      payload: { token },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ workspaceId: ws1.id, role: "atendente" });

    const dentro = await app.inject({
      method: "GET",
      url: `/workspaces/${ws1.id}/contacts`,
      headers: auth(carol.token),
    });
    expect(dentro.statusCode).toBe(200);

    const fora = await app.inject({
      method: "GET",
      url: `/workspaces/${ws2.id}/contacts`,
      headers: auth(carol.token),
    });
    expect(fora.statusCode).toBe(403);
  });

  it("atendente e supervisor não podem convidar (só admin_ws)", async () => {
    const dave = await register(app, {
      email: "dave@exemplo.com",
      password: "senha-forte-5",
      name: "Dave",
    });
    const invite = await app.inject({
      method: "POST",
      url: `/workspaces/${ws2.id}/invites`,
      headers: auth(bob.token),
      payload: { email: dave.email, role: "atendente" },
    });
    const { token } = invite.json() as { token: string };
    await app.inject({
      method: "POST",
      url: "/invites/accept",
      headers: auth(dave.token),
      payload: { token },
    });

    const tentativa = await app.inject({
      method: "POST",
      url: `/workspaces/${ws2.id}/invites`,
      headers: auth(dave.token),
      payload: { email: "alguem@exemplo.com", role: "atendente" },
    });
    expect(tentativa.statusCode).toBe(403);
  });
});

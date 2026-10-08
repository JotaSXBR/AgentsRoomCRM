import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { decryptSecret } from "../src/lib/secrets.js";
import type { MetaAdapter } from "../src/meta/adapter.js";
import { MemoryStore } from "../src/stores/memory.js";

const SECRET = "test-secret-f2b";
const APP_SECRET = "meta-app-secret";
const VERIFY_TOKEN = "verify-token-f2b";

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

async function makeWorkspace(app: FastifyInstance, token: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/workspaces",
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  return (res.json() as { id: string }).id;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function fakeMetaAdapter(): MetaAdapter & {
  sent: Array<{ channel: string; recipientId: string; text: string }>;
  failSend: boolean;
} {
  const sent: Array<{ channel: string; recipientId: string; text: string }> = [];
  const fake = {
    kind: "fake-meta",
    sent,
    failSend: false,
    buildOAuthUrl: ({ workspaceId }: { workspaceId: string }) =>
      `https://meta.test/oauth?state=${workspaceId}&client_id=app`,
    async exchangeCode({ code }: { code: string; redirectUri: string }) {
      return { accessToken: `user-token-${code}`, expiresIn: 3600 };
    },
    async listPages() {
      return [{ pageId: "page-1", pageName: "Loja", pageAccessToken: "page-token-1" }];
    },
    async getLinkedInstagram() {
      return "ig-1";
    },
    async sendText(input: {
      channel: "messenger" | "instagram";
      pageAccessToken: string;
      recipientId: string;
      text: string;
    }) {
      if (fake.failSend) throw new Error("meta_temporaria");
      sent.push({ channel: input.channel, recipientId: input.recipientId, text: input.text });
      return { externalId: `mid-out-${sent.length}` };
    },
  };
  return fake as unknown as MetaAdapter & {
    sent: Array<{ channel: string; recipientId: string; text: string }>;
    failSend: boolean;
  };
}

function metaSignature(payload: unknown): string {
  const raw = JSON.stringify(payload);
  return `sha256=${createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex")}`;
}

function metaPost(payload: Record<string, unknown>) {
  return {
    method: "POST" as const,
    url: "/webhooks/meta",
    headers: { "x-hub-signature-256": metaSignature(payload) },
    payload,
  };
}

describe("F2b meta oficial — connect + webhook", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let wsA: string;
  let wsB: string;
  let meta: ReturnType<typeof fakeMetaAdapter>;

  beforeEach(async () => {
    store = new MemoryStore();
    meta = fakeMetaAdapter();
    app = await buildApp({
      store,
      jwtSecret: SECRET,
      meta: {
        adapter: meta,
        appId: "app-123",
        appSecret: APP_SECRET,
        verifyToken: VERIFY_TOKEN,
        redirectUri: "https://core.test/meta/callback",
        secretsKey: SECRET,
      },
      outbound: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000 },
    });
    alice = await register(app, {
      email: "dono@exemplo.com",
      password: "senha-forte-1",
      name: "Dono",
    });
    wsA = await makeWorkspace(app, alice.token, "Workspace A");
    wsB = await makeWorkspace(app, alice.token, "Workspace B");
  });

  afterEach(async () => {
    await app.close();
  });

  async function connectManual(
    ws: string,
    input: { pageId: string; pageName?: string; igUserId?: string; accessToken: string },
  ) {
    return app.inject({
      method: "POST",
      url: `/workspaces/${ws}/meta/connect`,
      headers: auth(alice.token),
      payload: input,
    });
  }

    it("meta connect: manual redigido, oauth-url, conflito de página, delete", async () => {
    const oauth = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/meta/oauth-url`,
      headers: auth(alice.token),
    });
    expect(oauth.statusCode).toBe(200);
    expect(oauth.json().url).toContain(`state=${wsA}`);

    const connected = await connectManual(wsA, {
      pageId: "page-A",
      pageName: "Loja A",
      igUserId: "ig-A",
      accessToken: "token-secreto-A",
    });
    expect(connected.statusCode).toBe(201);
    const body = connected.json() as Record<string, unknown>;
    expect(body).toMatchObject({ pageId: "page-A", igUserId: "ig-A", connected: true });
    expect(body.accessTokenEnc).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("token-secreto-A");

    // token cifrado de verdade no store
    const record = await store.getMetaConnection(wsA);
    expect(record?.accessTokenEnc).not.toBe("token-secreto-A");
    expect(record?.accessTokenEnc).toBeTruthy();
    expect(decryptSecret(record?.accessTokenEnc ?? "", SECRET)).toBe("token-secreto-A");

    // mesma página em outro workspace → 409
    const conflict = await connectManual(wsB, { pageId: "page-A", accessToken: "outro-token-longo" });
    expect(conflict.statusCode).toBe(409);

    // OAuth via code (fake): conecta page-1 + ig-1
    const viaCode = await app.inject({
      method: "POST",
      url: `/workspaces/${wsB}/meta/connect`,
      headers: auth(alice.token),
      payload: { code: "abc" },
    });
    expect(viaCode.statusCode).toBe(201);
    expect(viaCode.json()).toMatchObject({ pageId: "page-1", igUserId: "ig-1" });

    const del = await app.inject({
      method: "DELETE",
      url: `/workspaces/${wsA}/meta/connection`,
      headers: auth(alice.token),
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/meta/connection`,
      headers: auth(alice.token),
    });
    expect(after.json()).toMatchObject({ connected: false });
  });

    it("webhook meta: verifica, ingere messenger+IG sem cruzar workspaces, dedup, 401", async () => {
    await connectManual(wsA, { pageId: "page-A", accessToken: "token-secreto-A" });
    await connectManual(wsB, { pageId: "page-B", accessToken: "token-secreto-B" });

    const verify = await app.inject({
      method: "GET",
      url: `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHAL123`,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.payload).toBe("CHAL123");

    const badVerify = await app.inject({
      method: "GET",
      url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=X",
    });
    expect(badVerify.statusCode).toBe(403);

    const msgA = {
      object: "page",
      entry: [
        {
          id: "page-A",
          messaging: [
            { sender: { id: "psid-1" }, message: { mid: "mid-1", text: "oi loja A" } },
          ],
        },
      ],
    };
    const hookA = await app.inject(metaPost(msgA));
    expect(hookA.json()).toMatchObject({ ok: true, received: 1 });

    const msgIg = {
      object: "instagram",
      entry: [
        {
          id: "page-A",
          messaging: [
            { sender: { id: "igsid-9" }, message: { mid: "mid-ig-1", text: "oi pelo IG" } },
          ],
        },
      ],
    };
    expect((await app.inject(metaPost(msgIg))).json()).toMatchObject({ received: 1 });

    const msgB = {
      object: "page",
      entry: [
        {
          id: "page-B",
          messaging: [
            { sender: { id: "psid-2" }, message: { mid: "mid-2", text: "oi loja B" } },
          ],
        },
      ],
    };
    expect((await app.inject(metaPost(msgB))).json()).toMatchObject({ received: 1 });

    // eco da própria página nunca vira intake
    const echo = {
      object: "page",
      entry: [
        {
          id: "page-A",
          messaging: [
            { sender: { id: "page-A" }, message: { mid: "mid-eco", text: "eco", is_echo: true } },
          ],
        },
      ],
    };
    expect((await app.inject(metaPost(echo))).json()).toMatchObject({ received: 0 });

    // página desconhecida → 200 sem ingestão
    const unknown = {
      object: "page",
      entry: [{ id: "page-X", messaging: [{ sender: { id: "s" }, message: { mid: "m", text: "x" } }] }],
    };
    expect((await app.inject(metaPost(unknown))).json()).toMatchObject({ received: 0 });

    // isolamento: A tem 2 conversas (messenger+instagram), B tem 1
    const convosA = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/inbox/conversations`,
      headers: auth(alice.token),
    });
    expect(convosA.json().total).toBe(2);
    const channelsA = convosA
      .json()
      .data.map((c: { channel: string }) => c.channel)
      .sort();
    expect(channelsA).toEqual(["instagram", "messenger"]);
    const convosB = await app.inject({
      method: "GET",
      url: `/workspaces/${wsB}/inbox/conversations`,
      headers: auth(alice.token),
    });
    expect(convosB.json().total).toBe(1);

    // duplicata do mid → received 0, sem mensagem extra
    const dup = await app.inject(metaPost(msgA));
    expect(dup.json()).toMatchObject({ ok: true, received: 0 });

    // assinatura errada → 401
    const forged = await app.inject({
      method: "POST",
      url: "/webhooks/meta",
      headers: { "x-hub-signature-256": "sha256=0000" },
      payload: msgA,
    });
    expect(forged.statusCode).toBe(401);
  });
});

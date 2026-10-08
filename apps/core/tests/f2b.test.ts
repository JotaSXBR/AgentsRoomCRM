import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { processWorkspaceOutbound, computeBackoffDelayMs } from "../src/outbound/queue.js";
import { buildWorkspaceSender } from "../src/outbound/sender.js";
import { decryptSecret, encryptSecret } from "../src/lib/secrets.js";
import type {
  IncomingMail,
  MailboxCredentials,
  MailReceiver,
  MailSender,
  OutgoingMail,
} from "../src/mail/transport.js";
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

function fakeMailSender(): MailSender & {
  sent: OutgoingMail[];
  fail: boolean;
} {
  const sent: OutgoingMail[] = [];
  const fake = {
    kind: "fake-smtp",
    sent,
    fail: false,
    async send(_mbox: MailboxCredentials, mail: OutgoingMail) {
      if (fake.fail) throw new Error("smtp_550_caixa_cheia");
      sent.push(mail);
      return { externalId: `smtp-msg-${sent.length}` };
    },
  };
  return fake as MailSender & { sent: OutgoingMail[]; fail: boolean };
}

function fakeMailReceiver(getMails: () => IncomingMail[]): MailReceiver & { calls: string[] } {
  const calls: string[] = [];
  const receiver: MailReceiver & { calls: string[] } = {
    kind: "fake-imap",
    calls,
    async listNew(mbox: MailboxCredentials, sinceUid: string | null) {
      calls.push(`${mbox.imapUser}:${sinceUid ?? "none"}`);
      return { mails: getMails(), lastUid: "4242" };
    },
  };
  return receiver;
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

describe("F2b meta oficial + e-mail + fila", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let wsA: string;
  let wsB: string;
  let meta: ReturnType<typeof fakeMetaAdapter>;
  let sender: ReturnType<typeof fakeMailSender>;
  let receiver: ReturnType<typeof fakeMailReceiver>;
  let inboxMails: IncomingMail[];

  beforeEach(async () => {
    store = new MemoryStore();
    meta = fakeMetaAdapter();
    sender = fakeMailSender();
    inboxMails = [];
    receiver = fakeMailReceiver(() => inboxMails);
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
      mail: { sender, receiver, secretsKey: SECRET },
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

  async function createMailbox(ws: string, fromEmail = "suporte@loja.test") {
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/mail/mailboxes`,
      headers: auth(alice.token),
      payload: {
        name: "suporte",
        fromEmail,
        smtpHost: "smtp.test",
        smtpUser: "suporte@loja.test",
        smtpPass: "s1",
        imapHost: "imap.test",
        imapUser: "suporte@loja.test",
        imapPass: "s2",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
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

  it("meta send: cria saída, enfileira e o processador entrega sem cruzar ws", async () => {
    await connectManual(wsA, { pageId: "page-A", accessToken: "token-secreto-A" });
    await app.inject(
      metaPost({
        object: "page",
        entry: [
          {
            id: "page-A",
            messaging: [
              { sender: { id: "psid-7" }, message: { mid: "mid-7", text: "preciso de ajuda" } },
            ],
          },
        ],
      }),
    );
    const convos = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/inbox/conversations`,
      headers: auth(alice.token),
    });
    const conversationId = convos.json().data[0].id as string;

    const send = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/meta/send`,
      headers: auth(alice.token),
      payload: { conversationId, text: "Olá! Como posso ajudar?" },
    });
    expect(send.statusCode).toBe(201);
    expect(meta.sent).toHaveLength(0); // nada enviado ainda: está na fila

    const queued = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/outbound?status=pendente`,
      headers: auth(alice.token),
    });
    expect(queued.json().data).toHaveLength(1);

    const processed = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/outbound/process`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(processed.json()).toMatchObject({ sent: 1 });
    expect(meta.sent[0]).toMatchObject({
      channel: "messenger",
      recipientId: "psid-7",
      text: "Olá! Como posso ajudar?",
    });

    const done = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/outbound?status=enviado`,
      headers: auth(alice.token),
    });
    expect(done.json().data[0]).toMatchObject({ providerMessageId: "mid-out-1" });

    // conversa de outro workspace não é endereçável aqui
    const cross = await app.inject({
      method: "POST",
      url: `/workspaces/${wsB}/meta/send`,
      headers: auth(alice.token),
      payload: { conversationId, text: "invasão" },
    });
    expect(cross.statusCode).toBe(404);
  });

  it("mailbox: CRUD redigido, send novo e resposta, processador entrega", async () => {
    const mailbox = await createMailbox(wsA);
    const list = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/mail/mailboxes`,
      headers: auth(alice.token),
    });
    expect(list.json().data[0]).toMatchObject({ fromEmail: "suporte@loja.test" });
    expect(list.json().data[0].smtpPassEnc).toBeUndefined();
    expect(list.json().data[0].imapPassEnc).toBeUndefined();

    // e-mail novo (sem conversa): cria contato + conversa email
    const send = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/mail/send`,
      headers: auth(alice.token),
      payload: {
        mailboxId: mailbox.id,
        to: "cliente@exemplo.com",
        subject: "Seu pedido",
        text: "Seu pedido saiu para entrega.",
      },
    });
    expect(send.statusCode).toBe(201);
    expect(sender.sent).toHaveLength(0);

    const processed = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/outbound/process`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(processed.json()).toMatchObject({ sent: 1 });
    expect(sender.sent[0]).toMatchObject({
      to: "cliente@exemplo.com",
      subject: "Seu pedido",
    });

    // resposta na mesma conversa
    const conversationId = (send.json() as { queued: { conversationId: string } }).queued
      .conversationId;
    const reply = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/mail/send`,
      headers: auth(alice.token),
      payload: {
        mailboxId: mailbox.id,
        to: "cliente@exemplo.com",
        subject: "Re: Seu pedido",
        text: "Chegou?",
        conversationId,
      },
    });
    expect(reply.statusCode).toBe(201);

    // pausar bloqueia envio
    const paused = await app.inject({
      method: "PATCH",
      url: `/workspaces/${wsA}/mail/mailboxes/${mailbox.id}`,
      headers: auth(alice.token),
      payload: { status: "pausada" },
    });
    expect(paused.json()).toMatchObject({ status: "pausada" });
    const blocked = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/mail/send`,
      headers: auth(alice.token),
      payload: {
        mailboxId: mailbox.id,
        to: "x@exemplo.com",
        subject: "s",
        text: "t",
      },
    });
    expect(blocked.statusCode).toBe(400);

    const del = await app.inject({
      method: "DELETE",
      url: `/workspaces/${wsA}/mail/mailboxes/${mailbox.id}`,
      headers: auth(alice.token),
    });
    expect(del.statusCode).toBe(204);
  });

  it("mail sync: ingere, dedup e unifica com widget no mesmo contato", async () => {
    await createMailbox(wsA);
    inboxMails = [
      {
        messageId: "msg-1@mail.test",
        fromEmail: "Cliente@Exemplo.com",
        fromName: "Cliente",
        subject: "Dúvida",
        text: "Qual o prazo?",
      },
    ];
    const first = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/mail/sync`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(first.json()).toMatchObject({ ok: true, ingested: 1, duplicates: 0, errors: [] });

    const again = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/mail/sync`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(again.json()).toMatchObject({ ingested: 0, duplicates: 1 });

    // widget com o mesmo e-mail cai no MESMO contato
    const token = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${wsA}/widget/tokens`,
        headers: auth(alice.token),
        payload: {},
      })
    ).json().token as string;
    const widgetMsg = await app.inject({
      method: "POST",
      url: "/public/widget/intake",
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "continuando", email: "cliente@exemplo.com", clientMessageId: "w-mail-1" },
    });
    expect(widgetMsg.statusCode).toBe(201);

    const contacts = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/contacts`,
      headers: auth(alice.token),
    });
    expect(contacts.json().total).toBe(1);
    const detail = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/contacts/${contacts.json().data[0].id}`,
      headers: auth(alice.token),
    });
    const channels = detail
      .json()
      .channels.map((c: { channel: string }) => c.channel)
      .sort();
    expect(channels).toEqual(["email", "widget"]);

    // outro workspace continua vazio
    const other = await app.inject({
      method: "GET",
      url: `/workspaces/${wsB}/contacts`,
      headers: auth(alice.token),
    });
    expect(other.json().total).toBe(0);
  });

  it("fila: falha reagenda com backoff e estoura em falhou", async () => {
    await connectManual(wsA, { pageId: "page-A", accessToken: "token-secreto-A" });
    await app.inject(
      metaPost({
        object: "page",
        entry: [
          {
            id: "page-A",
            messaging: [
              { sender: { id: "psid-f" }, message: { mid: "mid-f", text: "oi" } },
            ],
          },
        ],
      }),
    );
    const convos = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/inbox/conversations`,
      headers: auth(alice.token),
    });
    const conversationId = convos.json().data[0].id as string;
    await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/meta/send`,
      headers: auth(alice.token),
      payload: { conversationId, text: "resposta" },
    });

    meta.failSend = true;
    const first = await app.inject({
      method: "POST",
      url: `/workspaces/${wsA}/outbound/process`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(first.json()).toMatchObject({ retried: 1 });
    const pending = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/outbound?status=pendente`,
      headers: auth(alice.token),
    });
    const item = pending.json().data[0] as { attempts: number; nextAttemptAt: string };
    expect(item.attempts).toBe(1);
    expect(new Date(item.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

    // força o vencimento até estourar maxAttempts=3 → falhou
    const senderWired = buildWorkspaceSender({
      store,
      workspaceId: wsA,
      metaAdapter: meta,
      mailSender: sender,
      secretsKey: SECRET,
    });
    const future = new Date(Date.now() + 60_000);
    const second = await processWorkspaceOutbound(store, wsA, senderWired, {
      now: future,
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
    });
    expect(second).toMatchObject({ retried: 1 });
    const third = await processWorkspaceOutbound(store, wsA, senderWired, {
      now: new Date(future.getTime() + 60_000),
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
    });
    expect(third).toMatchObject({ failed: 1 });
    const failed = await app.inject({
      method: "GET",
      url: `/workspaces/${wsA}/outbound?status=falhou`,
      headers: auth(alice.token),
    });
    expect(failed.json().data).toHaveLength(1);

    expect(computeBackoffDelayMs(0, 1000, 5000)).toBe(1000);
    expect(computeBackoffDelayMs(2, 1000, 5000)).toBe(4000);
    expect(computeBackoffDelayMs(10, 1000, 5000)).toBe(5000);
  });

  it("segredos: cifra redonda e chave errada não abre", () => {
    const enc = encryptSecret("super-secreto", SECRET);
    expect(enc).not.toContain("super-secreto");
    expect(decryptSecret(enc, SECRET)).toBe("super-secreto");
    expect(() => decryptSecret(enc, "outra-chave")).toThrow();
  });
});

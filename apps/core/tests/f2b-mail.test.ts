import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type {
  IncomingMail,
  MailboxCredentials,
  MailReceiver,
  MailSender,
  OutgoingMail,
} from "../src/mail/transport.js";
import { MemoryStore } from "../src/stores/memory.js";

const SECRET = "test-secret-f2b";

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

describe("F2b e-mail — mailbox + sync", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let wsA: string;
  let wsB: string;
  let sender: ReturnType<typeof fakeMailSender>;
  let receiver: ReturnType<typeof fakeMailReceiver>;
  let inboxMails: IncomingMail[];

  beforeEach(async () => {
    store = new MemoryStore();
    sender = fakeMailSender();
    inboxMails = [];
    receiver = fakeMailReceiver(() => inboxMails);
    app = await buildApp({
      store,
      jwtSecret: SECRET,
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
});

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/stores/memory.js";

const SECRET = "test-secret-f3";

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

describe("F3 filas + SLA", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let ws: string;
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
  });

  afterEach(async () => {
    await app.close();
  });

  async function addMember(userId: string, role: "admin_ws" | "supervisor" | "atendente"): Promise<void> {
    await store.addMember({ workspaceId: ws, userId, role });
  }

    // Teste pesado: 13 registros com bcrypt. Timeout explícito acima do
  // testTimeout global não é necessário, mas documenta a intenção.
  it("distribuição automática equilibra entre 10+ atendentes", { timeout: 15000 }, async () => {
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "geral", isDefault: true },
      })
    ).json();
    const attendants: Session[] = [];
    for (let i = 0; i < 12; i += 1) {
      const s = await register(app, { email: `atendente${i}@exemplo.com`, password: "senha-forte-2", name: `A${i}` });
      attendants.push(s);
      await addMember(s.userId, "atendente");
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues/${queue.id}/members`,
        headers: auth(alice.token),
        payload: { userId: s.userId },
      });
    }
    const counts = new Map<string, number>();
    for (let i = 0; i < 12; i += 1) {
      const contact = await store.createContact({ workspaceId: ws, name: `Contato ${i}` });
      const conv = await store.createConversation({ workspaceId: ws, contactId: contact.id, channel: "widget" });
      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues/${queue.id}/tickets`,
        headers: auth(alice.token),
        payload: { conversationId: conv.id, channel: "widget" },
      });
      expect(res.statusCode).toBe(201);
      const { assignedUserId } = res.json();
      counts.set(assignedUserId, (counts.get(assignedUserId) ?? 0) + 1);
    }
    expect(counts.size).toBe(12);
    for (const c of counts.values()) expect(c).toBe(1);
  });

    it("supervisor transfere ticket; atendente não pode", async () => {
    const sup = await register(app, { email: "sup@exemplo.com", password: "senha-forte-3", name: "Sup" });
    const a1 = await register(app, { email: "sup-a1@exemplo.com", password: "senha-forte-3", name: "A1" });
    const a2 = await register(app, { email: "sup-a2@exemplo.com", password: "senha-forte-3", name: "A2" });
    await addMember(sup.userId, "supervisor");
    await addMember(a1.userId, "atendente");
    await addMember(a2.userId, "atendente");
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "geral", isDefault: true },
      })
    ).json();
    await app.inject({
      method: "POST", url: `/workspaces/${ws}/queues/${queue.id}/members`,
      headers: auth(alice.token), payload: { userId: a1.userId },
    });
    await app.inject({
      method: "POST", url: `/workspaces/${ws}/queues/${queue.id}/members`,
      headers: auth(alice.token), payload: { userId: a2.userId },
    });
    const contact = await store.createContact({ workspaceId: ws, name: "C" });
    const conv = await store.createConversation({ workspaceId: ws, contactId: contact.id, channel: "whatsapp" });
    const ticket = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues/${queue.id}/tickets`,
        headers: auth(alice.token),
        payload: { conversationId: conv.id, channel: "whatsapp" },
      })
    ).json();

    const proibido = await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/queues/tickets/${ticket.ticketId}/transfer`,
      headers: auth(a1.token),
      payload: { toUserId: a2.userId },
    });
    expect(proibido.statusCode).toBe(403);

    const ok = await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/queues/tickets/${ticket.ticketId}/transfer`,
      headers: auth(sup.token),
      payload: { toUserId: a2.userId },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().assignedUserId).toBe(a2.userId);
  });

    it("SLA: TME/TMA por fila e por canal na métrica", async () => {
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "geral", isDefault: true },
      })
    ).json();
    const contact = await store.createContact({ workspaceId: ws, name: "C" });
    const conv = await store.createConversation({ workspaceId: ws, contactId: contact.id, channel: "widget" });
    const ticket = await store.enqueueTicket({ workspaceId: ws, queueId: queue.id, conversationId: conv.id, channel: "widget" });
    const enq = Date.parse(ticket.enqueuedAt);
    await store.updateTicket(ws, ticket.id, {
      firstResponseAt: new Date(enq + 60_000).toISOString(),
      resolvedAt: new Date(enq + 60_000 + 600_000).toISOString(),
      status: "resolvido",
    });

    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${ws}/metrics/sla?groupBy=queue`,
      headers: auth(alice.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groupBy).toBe("queue");
    const grupo = body.data.find((g: { key: string }) => g.key === "geral");
    expect(grupo).toBeTruthy();
    expect(grupo.total).toBe(1);
    expect(grupo.resolvidos).toBe(1);
    expect(grupo.tmeMedioSeg).toBe(60);
    expect(grupo.tmaMedioSeg).toBe(600);

    const byChannel = await app.inject({
      method: "GET",
      url: `/workspaces/${ws}/metrics/sla?groupBy=channel`,
      headers: auth(alice.token),
    });
    const widget = byChannel.json().data.find((g: { key: string }) => g.key === "widget");
    expect(widget).toBeTruthy();
    expect(widget.tmeMedioSeg).toBe(60);
  });

    it("primeira resposta humana carimba TME; ouvir resolver a conversa fecha o ticket", async () => {
    const queue = (
      await app.inject({
        method: "POST",
        url: `/workspaces/${ws}/queues`,
        headers: auth(alice.token),
        payload: { name: "vpn", isDefault: true },
      })
    ).json();
    const contact = await store.createContact({ workspaceId: ws, name: "C" });
    const conv = await store.createConversation({ workspaceId: ws, contactId: contact.id, channel: "widget" });
    await store.enqueueTicket({ workspaceId: ws, queueId: queue.id, conversationId: conv.id, channel: "widget" });

    await app.inject({
      method: "POST",
      url: `/workspaces/${ws}/inbox/conversations/${conv.id}/messages`,
      headers: auth(alice.token),
      payload: { direction: "saida", text: "Olá, posso ajudar?" },
    });
    let ticket = await store.findOpenTicketByConversation(ws, conv.id);
    expect(ticket?.firstResponseAt).toBeTruthy();
    expect(ticket?.status).toBe("em_atendimento");

    await app.inject({
      method: "PATCH",
      url: `/workspaces/${ws}/inbox/conversations/${conv.id}`,
      headers: auth(alice.token),
      payload: { status: "resolvido" },
    });
    expect(ticket?.id).toBeTruthy();
    ticket = await store.findTicketById(ws, ticket?.id ?? "");
    expect(ticket?.status).toBe("resolvido");
    expect(ticket?.resolvedAt).toBeTruthy();
  });
});

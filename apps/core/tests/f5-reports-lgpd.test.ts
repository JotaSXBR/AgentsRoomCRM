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

describe("F5 — relatórios + LGPD", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let alice: Session;
  let ws: string;

  beforeEach(async () => {
    store = new MemoryStore();
    app = await buildApp({ store, jwtSecret: SECRET });
    alice = await register(app, {
      email: "dono@exemplo.com",
      password: "senha-forte-1",
      name: "Dono",
    });
    ws = await createWorkspace(app, alice.token, "WS F5");
  });

  afterEach(async () => {
    await app.close();
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
});

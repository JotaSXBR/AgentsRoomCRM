import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { QueueTicketRecord, Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { enqueueAndDistribute } from "../queues/assign.js";

function assertSupervisor(role: string): void {
  if (role !== "owner_global" && role !== "admin_ws" && role !== "supervisor") {
    throw HttpError.forbidden();
  }
}

const createQueueSchema = z.object({
  name: z.string().min(1).max(80),
  channel: z.string().max(40).nullish(),
  isDefault: z.boolean().optional(),
});

const memberSchema = z.object({ userId: z.string().uuid() });

const enqueueSchema = z.object({
  conversationId: z.string().uuid(),
  channel: z.string().min(1).max(40),
});

const patchTicketSchema = z
  .object({
    status: z.enum(["aguardando", "em_atendimento", "resolvido", "cancelado"]).optional(),
    assignedUserId: z.string().uuid().nullish(),
  })
  .refine((v) => v.status !== undefined || v.assignedUserId !== undefined, {
    message: "Nada para atualizar.",
  });

const transferSchema = z.object({ toUserId: z.string().uuid() });

const rebalanceSchema = z.object({ fromUserId: z.string().uuid() });

export async function queueRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  await registerQueueCrudRoutes(app, store);
  await registerQueueMemberRoutes(app, store);
  await registerTicketRoutes(app, store, hub);
  await registerDistributionRoutes(app, store, hub);
}

async function registerQueueCrudRoutes(app: FastifyInstance, store: Store): Promise<void> {
  // ---- filas ----
  app.get(
    "/workspaces/:workspaceId/queues",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listQueues(workspaceId) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/queues",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const body = createQueueSchema.parse(await request.body);
      try {
        const queue = await store.createQueue({ workspaceId, ...body });
        return await reply.code(201).send(queue);
      } catch (error) {
        if ((error as Error).message === "fila_nome_em_uso") {
          throw HttpError.badRequest("fila_nome_em_uso", "Já existe fila com esse nome.");
        }
        throw error;
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/queues/:queueId",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, queueId } = request.params as { workspaceId: string; queueId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const ok = await store.deleteQueue(workspaceId, queueId);
      if (!ok) throw HttpError.notFound("Fila não encontrada.");
      return reply.code(204).send();
    },
  );
}

async function registerQueueMemberRoutes(app: FastifyInstance, store: Store): Promise<void> {
  // ---- membros da fila ----
  app.get(
    "/workspaces/:workspaceId/queues/:queueId/members",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, queueId } = request.params as { workspaceId: string; queueId: string };
      await requireWorkspace(store, request, workspaceId);
      const queue = await store.findQueueById(workspaceId, queueId);
      if (!queue) throw HttpError.notFound("Fila não encontrada.");
      return { data: await store.listQueueMembers(workspaceId, queueId) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/queues/:queueId/members",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, queueId } = request.params as { workspaceId: string; queueId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const body = memberSchema.parse(await request.body);
      const queue = await store.findQueueById(workspaceId, queueId);
      if (!queue) throw HttpError.notFound("Fila não encontrada.");
      const member = await store.findMembership(workspaceId, body.userId);
      if (!member) throw HttpError.badRequest("membro_invalido", "Usuário não é membro do workspace.");
      await store.addQueueMember({ workspaceId, queueId, userId: body.userId });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete(
    "/workspaces/:workspaceId/queues/:queueId/members/:userId",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, queueId, userId } = request.params as {
        workspaceId: string;
        queueId: string;
        userId: string;
      };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const ok = await store.removeQueueMember(workspaceId, queueId, userId);
      if (!ok) throw HttpError.notFound("Membro não encontrado na fila.");
      return reply.code(204).send();
    },
  );
}

async function registerTicketRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  // ---- tickets ----
  app.get(
    "/workspaces/:workspaceId/queues/tickets",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const query = (request.query ?? {}) as { queueId?: string; status?: string; assigneeId?: string };
      return {
        data: await store.listTickets(workspaceId, {
          queueId: query.queueId,
          status: query.status,
          assignedUserId: query.assigneeId,
        }),
      };
    },
  );

  app.post(
    "/workspaces/:workspaceId/queues/:queueId/tickets",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId, queueId } = request.params as { workspaceId: string; queueId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = enqueueSchema.parse(await request.body);
      const queue = await store.findQueueById(workspaceId, queueId);
      if (!queue) throw HttpError.notFound("Fila não encontrada.");
      try {
        const { ticketId, assignedUserId } = await enqueueAndDistribute(store, hub, {
          workspaceId,
          queueId,
          conversationId: body.conversationId,
          channel: body.channel,
        });
        return reply.code(201).send({ ticketId, assignedUserId });
      } catch (error) {
        if ((error as Error).message === "conversa_invalida") {
          throw HttpError.badRequest("conversa_invalida", "Conversa não existe neste workspace.");
        }
        if ((error as Error).message === "fila_invalida") {
          throw HttpError.badRequest("fila_invalida", "Fila inválida.");
        }
        throw error;
      }
    },
  );

  app.patch(
    "/workspaces/:workspaceId/queues/tickets/:ticketId",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, ticketId } = request.params as { workspaceId: string; ticketId: string };
      const role = await requireWorkspace(store, request, workspaceId);
      const body = patchTicketSchema.parse(await request.body);
      if (body.assignedUserId !== undefined) assertSupervisor(role);
      const patch: { status?: typeof body.status; assignedUserId?: string | null; resolvedAt?: string | null } = {
        status: body.status,
      };
      if (body.assignedUserId !== undefined) patch.assignedUserId = body.assignedUserId ?? null;
      if (body.status === "resolvido") patch.resolvedAt = new Date().toISOString();
      const ticket = await store.updateTicket(workspaceId, ticketId, patch);
      if (!ticket) throw HttpError.notFound("Ticket não encontrado.");
      hub.publish(workspaceId, { kind: "fila.ticket", data: { ...ticket, event: "atualizado" } });
      return ticket;
    },
  );
}

function countOpenTicketsByMember(
  tickets: QueueTicketRecord[],
  members: string[],
): Map<string, number> {
  const count = new Map<string, number>(members.map((m) => [m, 0]));
  for (const ticket of tickets) {
    if (ticket.status === "resolvido" || ticket.status === "cancelado") continue;
    if (ticket.assignedUserId && count.has(ticket.assignedUserId)) {
      count.set(ticket.assignedUserId, (count.get(ticket.assignedUserId) ?? 0) + 1);
    }
  }
  return count;
}

function pickRebalanceTarget(
  members: string[],
  counts: Map<string, number>,
): string | undefined {
  const first = members[0];
  if (first === undefined) return undefined;
  let target = first;
  for (const member of members) {
    if ((counts.get(member) ?? 0) < (counts.get(target) ?? 0)) target = member;
  }
  return target;
}

async function moveAwaitingTickets(
  store: Store,
  workspaceId: string,
  input: { open: QueueTicketRecord[]; members: string[]; counts: Map<string, number> },
): Promise<string[]> {
  const moved: string[] = [];
  for (const ticket of input.open) {
    const target = pickRebalanceTarget(input.members, input.counts);
    if (target === undefined) break;
    await store.updateTicket(workspaceId, ticket.id, { assignedUserId: target });
    input.counts.set(target, (input.counts.get(target) ?? 0) + 1);
    moved.push(ticket.id);
  }
  return moved;
}

async function registerDistributionRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  // Supervisor redistribui: transfere UM ticket...
  app.post(
    "/workspaces/:workspaceId/queues/tickets/:ticketId/transfer",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, ticketId } = request.params as { workspaceId: string; ticketId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const body = transferSchema.parse(await request.body);
      const ticket = await store.findTicketById(workspaceId, ticketId);
      if (!ticket) throw HttpError.notFound("Ticket não encontrado.");
      const member = await store.findMembership(workspaceId, body.toUserId);
      if (!member) throw HttpError.badRequest("membro_invalido", "Destino não é membro do workspace.");
      const updated = await store.updateTicket(workspaceId, ticketId, { assignedUserId: body.toUserId });
      hub.publish(workspaceId, { kind: "fila.ticket", data: { ...updated, event: "transferido" } });
      return updated;
    },
  );

  // ...ou rebalanceia os tickets "aguardando" de um atendente nos demais membros.
  app.post(
    "/workspaces/:workspaceId/queues/:queueId/rebalance",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, queueId } = request.params as { workspaceId: string; queueId: string };
      assertSupervisor(await requireWorkspace(store, request, workspaceId));
      const body = rebalanceSchema.parse(await request.body);
      const queue = await store.findQueueById(workspaceId, queueId);
      if (!queue) throw HttpError.notFound("Fila não encontrada.");
      const open = await store.listTickets(workspaceId, {
        queueId,
        status: "aguardando",
        assignedUserId: body.fromUserId,
      });
      const members = (await store.listQueueMembers(workspaceId, queueId)).filter(
        (m) => m !== body.fromUserId,
      );
      const allOpen = await store.listTickets(workspaceId, { queueId });
      const counts = countOpenTicketsByMember(allOpen, members);
      const moved = await moveAwaitingTickets(store, workspaceId, { open, members, counts });
      hub.publish(workspaceId, { kind: "fila.rebalance", data: { queueId, fromUserId: body.fromUserId, moved: moved.length } });
      return { moved: moved.length, ticketIds: moved };
    },
  );
}

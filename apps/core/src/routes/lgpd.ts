import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { ConsentKind, Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import { exportContact } from "../mcp/helpers.js";

const consentSchema = z.object({
  kind: z.enum(["dados", "marketing", "ia"]),
  granted: z.boolean(),
  source: z.string().max(60).optional(),
  note: z.string().max(200).nullish(),
});

const eraseSchema = z.object({
  motivo: z.string().min(3, "Informe o motivo da exclusão.").max(200),
});

function assertSupervisor(role: string): void {
  if (role !== "owner_global" && role !== "admin_ws" && role !== "supervisor") {
    throw HttpError.forbidden("Operação LGPD restrita a supervisor ou admin.");
  }
}

/**
 * LGPD básica (F5), três direitos do titular:
 * - consentimento por finalidade (`dados` | `marketing` | `ia`), com carimbo
 *   de revogação;
 * - portabilidade (art. 18, V): exportação completa dos dados do contato;
 * - eliminação (art. 18, VI): apaga conteúdo e anonimiza o cadastro.
 * Toda solicitação fica registrada em `lgpd_requests` — a trilha de auditoria.
 */
export async function registerLgpdRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/contacts/:contactId/consents",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, contactId } = request.params as {
        workspaceId: string;
        contactId: string;
      };
      await requireWorkspace(store, request, workspaceId);
      const query = (request.query ?? {}) as { kind?: string };
      const { data } = {
        data: await store.listConsents(workspaceId, {
          contactId,
          kind: query.kind as ConsentKind | undefined,
        }),
      };
      return { data };
    },
  );

  app.put(
    "/workspaces/:workspaceId/contacts/:contactId/consents",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, contactId } = request.params as {
        workspaceId: string;
        contactId: string;
      };
      await requireWorkspace(store, request, workspaceId);
      const body = consentSchema.parse(await request.body);
      try {
        return await store.setConsent({
          workspaceId,
          contactId,
          kind: body.kind,
          granted: body.granted,
          source: body.source ?? "app",
          note: body.note ?? null,
        });
      } catch (error) {
        if ((error as Error).message === "contato_invalido") {
          throw HttpError.notFound("Contato não encontrado.");
        }
        throw error;
      }
    },
  );

  app.get(
    "/workspaces/:workspaceId/contacts/:contactId/export",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, contactId } = request.params as {
        workspaceId: string;
        contactId: string;
      };
      await requireWorkspace(store, request, workspaceId);
      const data = await exportContact(store, workspaceId, contactId).catch(() => null);
      if (!data) throw HttpError.notFound("Contato não encontrado.");
      await store.addLgpdRequest({
        workspaceId,
        contactId,
        scope: "contato",
        action: "acesso",
        summary: { conversas: data.conversations.length },
        requestedBy: request.authUser?.id ?? null,
      });
      return data;
    },
  );

  app.delete(
    "/workspaces/:workspaceId/contacts/:contactId/data",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, contactId } = request.params as {
        workspaceId: string;
        contactId: string;
      };
      const role = await requireWorkspace(store, request, workspaceId);
      assertSupervisor(role);
      const body = eraseSchema.parse(await request.body ?? {});
      try {
        const summary = await store.purgeContactData(workspaceId, contactId);
        await store.addLgpdRequest({
          workspaceId,
          contactId,
          scope: "contato",
          action: "exclusao",
          summary: { ...summary, motivo: body.motivo },
          requestedBy: request.authUser?.id ?? null,
        });
        return { ok: true, summary };
      } catch (error) {
        if ((error as Error).message === "contato_invalido") {
          throw HttpError.notFound("Contato não encontrado.");
        }
        throw error;
      }
    },
  );

  app.delete(
    "/workspaces/:workspaceId/data",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      const role = await requireWorkspace(store, request, workspaceId);
      assertSupervisor(role);
      const body = eraseSchema.parse(await request.body ?? {});
      const summary = await store.purgeWorkspaceContacts(workspaceId);
      await store.addLgpdRequest({
        workspaceId,
        scope: "workspace",
        action: "exclusao",
        summary: { ...summary, motivo: body.motivo },
        requestedBy: request.authUser?.id ?? null,
      });
      return { ok: true, summary };
    },
  );

  app.get(
    "/workspaces/:workspaceId/lgpd/requests",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      return { data: await store.listLgpdRequests(workspaceId) };
    },
  );
}
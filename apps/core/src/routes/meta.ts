import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import { encryptSecret } from "../lib/secrets.js";
import type { MetaAdapter } from "../meta/adapter.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { MetaConnectionRecord, Store } from "../stores/store.js";

export interface MetaRouteOptions {
  adapter: MetaAdapter | null;
  appId?: string | null;
  redirectUri?: string | null;
  secretsKey: string;
}

const manualConnectSchema = z.object({
  pageId: z.string().min(1).max(80),
  pageName: z.string().max(160).nullish(),
  igUserId: z.string().max(80).nullish(),
  accessToken: z.string().min(10).max(2000),
});

const oauthConnectSchema = z.object({
  code: z.string().min(1).max(2000),
  pageId: z.string().min(1).max(80).nullish(),
  redirectUri: z.string().url().max(500).nullish(),
});

const connectSchema = z.union([manualConnectSchema, oauthConnectSchema]);

const sendSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(8000),
});

function redact(connection: MetaConnectionRecord) {
  const { accessTokenEnc: _enc, ...rest } = connection;
  return { ...rest, connected: true };
}

function tokenExpiresAt(expiresIn: number | null): string | null {
  if (!expiresIn || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

interface ResolvedConnection {
  pageId: string;
  pageName: string | null;
  igUserId: string | null;
  pageAccessToken: string;
  expiresAt: string | null;
}

async function resolveOAuthConnection(
  adapter: MetaAdapter,
  body: z.infer<typeof oauthConnectSchema>,
  redirectFallback: string | null | undefined,
): Promise<ResolvedConnection> {
  const redirectUri = body.redirectUri ?? redirectFallback;
  if (!redirectUri) {
    throw HttpError.badRequest(
      "redirect_ausente",
      "Informe redirectUri ou configure META_REDIRECT_URI.",
    );
  }
  const exchanged = await adapter
    .exchangeCode({ code: body.code, redirectUri })
    .catch((error) => {
      throw HttpError.badGateway("meta_oauth_falhou", (error as Error).message);
    });
  const pages = await adapter
    .listPages({ userAccessToken: exchanged.accessToken })
    .catch((error) => {
      throw HttpError.badGateway("meta_oauth_falhou", (error as Error).message);
    });
  const picked = body.pageId ? pages.find((p) => p.pageId === body.pageId) : pages[0];
  if (!picked) {
    throw HttpError.badRequest(
      "pagina_nao_encontrada",
      "Nenhuma Página acessível com esse código.",
    );
  }
  const igUserId = await adapter
    .getLinkedInstagram({ pageId: picked.pageId, pageAccessToken: picked.pageAccessToken })
    .catch(() => null);
  return {
    pageId: picked.pageId,
    pageName: picked.pageName,
    igUserId,
    pageAccessToken: picked.pageAccessToken,
    expiresAt: tokenExpiresAt(exchanged.expiresIn),
  };
}

interface PersistCtx {
  store: Store;
  workspaceId: string;
  secretsKey: string;
  reply: FastifyReply;
}

async function persistMetaConnection(
  ctx: PersistCtx,
  resolved: ResolvedConnection,
): Promise<void> {
  const { store, workspaceId, secretsKey, reply } = ctx;
  try {
    const record = await store.saveMetaConnection({
      workspaceId,
      pageId: resolved.pageId,
      pageName: resolved.pageName,
      igUserId: resolved.igUserId,
      accessTokenEnc: encryptSecret(resolved.pageAccessToken, secretsKey),
      tokenExpiresAt: resolved.expiresAt,
      status: "conectada",
    });
    await reply.code(201).send(redact(record));
  } catch (error) {
    if ((error as Error).message === "pagina_em_uso") {
      throw HttpError.conflict(
        "pagina_em_uso",
        "Esta Página já está conectada a outro workspace.",
      );
    }
    throw error;
  }
}

async function resolveRecipient(
  store: Store,
  workspaceId: string,
  contactId: string,
  channel: string,
): Promise<string> {
  const channels = await store.listContactChannels(workspaceId, contactId);
  const recipient = channels.find((c) => c.channel === channel);
  if (!recipient) {
    throw HttpError.badRequest(
      "destinatario_ausente",
      "Contato sem identificador do canal.",
    );
  }
  return recipient.value;
}

async function registerConnectionRoutes(
  app: FastifyInstance,
  store: Store,
  options: MetaRouteOptions,
): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/meta/oauth-url",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      if (!options.adapter || !options.appId) {
        throw HttpError.badGateway(
          "meta_nao_configurada",
          "META_APP_ID não configurado neste ambiente.",
        );
      }
      return { url: options.adapter.buildOAuthUrl({ workspaceId }) };
    },
  );

  app.post(
    "/workspaces/:workspaceId/meta/connect",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = connectSchema.parse((await request.body) ?? {});
      let resolved: ResolvedConnection;
      if ("code" in body) {
        if (!options.adapter) {
          throw HttpError.badGateway(
            "meta_nao_configurada",
            "Integração Meta não configurada neste ambiente.",
          );
        }
        resolved = await resolveOAuthConnection(options.adapter, body, options.redirectUri);
      } else {
        resolved = {
          pageId: body.pageId,
          pageName: body.pageName ?? null,
          igUserId: body.igUserId ?? null,
          pageAccessToken: body.accessToken,
          expiresAt: null,
        };
      }
      await persistMetaConnection({ store, workspaceId, secretsKey: options.secretsKey, reply }, resolved);
    },
  );

  app.get(
    "/workspaces/:workspaceId/meta/connection",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const connection = await store.getMetaConnection(workspaceId);
      if (!connection) return { connected: false as const };
      return redact(connection);
    },
  );

  app.delete(
    "/workspaces/:workspaceId/meta/connection",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const ok = await store.deleteMetaConnection(workspaceId);
      if (!ok) throw HttpError.notFound("Conexão não encontrada.");
      return reply.code(204).send();
    },
  );
}

async function registerSendRoute(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
): Promise<void> {
  app.post(
    "/workspaces/:workspaceId/meta/send",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const body = sendSchema.parse((await request.body) ?? {});
      const conversation = await store.findConversationById(workspaceId, body.conversationId);
      if (!conversation) throw HttpError.notFound("Conversa não encontrada.");
      if (conversation.channel !== "messenger" && conversation.channel !== "instagram") {
        throw HttpError.badRequest(
          "canal_invalido",
          "Esta conversa não é do Messenger/Instagram.",
        );
      }
      const toValue = await resolveRecipient(store, workspaceId, conversation.contactId, conversation.channel);
      const message = await store.addMessage({
        workspaceId,
        conversationId: conversation.id,
        direction: "saida",
        authorId: request.authUser.id,
        kind: "texto",
        text: body.text,
      });
      const queued = await store.enqueueOutbound({
        workspaceId,
        channel: conversation.channel,
        conversationId: conversation.id,
        messageId: message.id,
        toValue,
        text: body.text,
      });
      hub.publish(workspaceId, { kind: "mensagem.criada", data: message });
      hub.publish(workspaceId, { kind: "conversa.atualizada", data: conversation });
      return reply.code(201).send({ message, queued });
    },
  );
}

/**
 * Conexão Meta oficial por workspace (F2b).
 * - `GET oauth-url`: inicia o OAuth (state = workspaceId).
 * - `POST connect`: conclui via OAuth (`code`) ou conexão manual
 *   (`pageId` + `accessToken`, usada em staging/testes). O token da Página é
 *   cifrado antes de persistir e nunca volta na API.
 * - `POST send`: resposta do atendente → mensagem "saida" + fila com backoff.
 */
export async function metaRoutes(
  app: FastifyInstance,
  store: Store,
  hub: RealtimeHub,
  options: MetaRouteOptions,
): Promise<void> {
  await registerConnectionRoutes(app, store, options);
  await registerSendRoute(app, store, hub);
}

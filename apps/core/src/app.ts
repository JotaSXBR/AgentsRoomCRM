import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "./stores/store.js";
import { registerAuth } from "./plugins/auth.js";
import { RealtimeHub } from "./realtime/hub.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { inviteRoutes } from "./routes/invites.js";
import { contactRoutes } from "./routes/contacts.js";
import { inboxRoutes } from "./routes/inbox.js";
import { mediaRoutes } from "./routes/media.js";
import { webRoutes } from "./routes/web.js";
import { widgetRoutes } from "./routes/widget.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { metaRoutes } from "./routes/meta.js";
import { mailRoutes } from "./routes/mail.js";
import { outboundRoutes } from "./routes/outbound.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { metaWebhookRoutes } from "./routes/webhooksMeta.js";
import type { WhatsAppAdapter } from "./waha/adapter.js";
import type { MetaAdapter } from "./meta/adapter.js";
import type { MailReceiver, MailSender } from "./mail/transport.js";

export interface BuildAppOptions {
  store: Store;
  jwtSecret: string;
  jwtExpiresIn?: string;
  inviteTtlHours?: number;
  logger?: boolean;
  s3?: {
    s3Endpoint: string | null;
    s3Region: string;
    s3AccessKey: string | null;
    s3SecretKey: string | null;
    s3BucketMidia: string;
  };
  waha?: {
    adapter?: WhatsAppAdapter | null;
    webhookSecret?: string | null;
  };
  meta?: {
    adapter?: MetaAdapter | null;
    appId?: string | null;
    appSecret?: string | null;
    verifyToken?: string | null;
    redirectUri?: string | null;
    secretsKey?: string | null;
  };
  mail?: {
    sender?: MailSender | null;
    receiver?: MailReceiver | null;
    secretsKey?: string | null;
  };
  outbound?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
}

function defaultS3Options(): NonNullable<BuildAppOptions["s3"]> {
  return {
    s3Endpoint: null,
    s3Region: "us-east-1",
    s3AccessKey: null,
    s3SecretKey: null,
    s3BucketMidia: "crm-midia",
  };
}

async function registerCoreRoutes(
  app: FastifyInstance,
  options: BuildAppOptions,
  hub: RealtimeHub,
): Promise<void> {
  await healthRoutes(app);
  await authRoutes(app, options.store, options.jwtExpiresIn ?? "12h");
  await workspaceRoutes(app, options.store);
  await inviteRoutes(app, options.store, options.inviteTtlHours ?? 72);
  await contactRoutes(app, options.store);
  await inboxRoutes(app, options.store, hub);
  await mediaRoutes(app, options.store, options.s3 ?? defaultS3Options());
  await webRoutes(app);
  await widgetRoutes(app, options.store, hub);
  await whatsappRoutes(app, options.store, options.waha?.adapter ?? null);
  await webhookRoutes(app, options.store, hub, {
    webhookSecret: options.waha?.webhookSecret ?? null,
  });
}

function metaConnectionOptions(
  options: BuildAppOptions,
  secretsKey: string,
): Parameters<typeof metaRoutes>[3] {
  return {
    adapter: options.meta?.adapter ?? null,
    appId: options.meta?.appId ?? null,
    redirectUri: options.meta?.redirectUri ?? null,
    secretsKey,
  };
}

function mailRouteOptions(
  options: BuildAppOptions,
  secretsKey: string,
): Parameters<typeof mailRoutes>[3] {
  return {
    receiver: options.mail?.receiver ?? null,
    secretsKey,
  };
}

function outboundRouteOptions(
  options: BuildAppOptions,
  secretsKey: string,
): Parameters<typeof outboundRoutes>[2] {
  return {
    metaAdapter: options.meta?.adapter ?? null,
    mailSender: options.mail?.sender ?? null,
    secretsKey,
    maxAttempts: options.outbound?.maxAttempts,
    baseDelayMs: options.outbound?.baseDelayMs,
    maxDelayMs: options.outbound?.maxDelayMs,
  };
}

function metaWebhookRouteOptions(
  options: BuildAppOptions,
): Parameters<typeof metaWebhookRoutes>[3] {
  return {
    appSecret: options.meta?.appSecret ?? null,
    verifyToken: options.meta?.verifyToken ?? null,
  };
}

async function registerMetaMailRoutes(
  app: FastifyInstance,
  options: BuildAppOptions,
  hub: RealtimeHub,
  secretsKey: string,
): Promise<void> {
  await metaRoutes(app, options.store, hub, metaConnectionOptions(options, secretsKey));
  await mailRoutes(app, options.store, hub, mailRouteOptions(options, secretsKey));
  await outboundRoutes(app, options.store, outboundRouteOptions(options, secretsKey));
  await metaWebhookRoutes(app, options.store, hub, metaWebhookRouteOptions(options));
}

async function registerRoutes(
  app: FastifyInstance,
  options: BuildAppOptions,
  hub: RealtimeHub,
): Promise<void> {
  await registerCoreRoutes(app, options, hub);
  const secretsKey = options.meta?.secretsKey ?? options.mail?.secretsKey ?? options.jwtSecret;
  await registerMetaMailRoutes(app, options, hub, secretsKey);
}

function isInvalidMediaTypeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
  );
}

function resolveStatusCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode as number;
  }
  return 500;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, { origin: true });
  await app.register(helmet);
  await app.register(jwt, { secret: options.jwtSecret });

  await registerAuth(app, options.store);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        code: "validacao",
        message: "Dados inválidos.",
        issues: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    if (isInvalidMediaTypeError(error)) {
      return reply.code(400).send({ code: "validacao", message: "JSON inválido." });
    }
    const status = resolveStatusCode(error);
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({
      code: status === 500 ? "erro_interno" : "erro",
      message: status === 500 ? "Erro interno." : (error as Error).message,
    });
  });

  const hub = new RealtimeHub();
  await registerRoutes(app, options, hub);

  return app;
}

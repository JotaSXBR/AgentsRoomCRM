import { loadConfig, assertProdSecrets } from "./config.js";
import { buildApp } from "./app.js";
import { MemoryStore } from "./stores/memory.js";
import { PostgresStore, createPool } from "./stores/postgres.js";
import { closeInfra } from "./infra.js";
import { createWahaHttpAdapter } from "./waha/wahaHttpAdapter.js";
import { createMetaHttpAdapter } from "./meta/metaHttpAdapter.js";
import { createSmtpSender } from "./mail/smtpSender.js";
import { createImapReceiver } from "./mail/imapReceiver.js";
import { processAllWorkspaces } from "./outbound/queue.js";
import { buildWorkspaceSender } from "./outbound/sender.js";
import { syncAllMailboxes } from "./mail/sync.js";
import type { Store } from "./stores/store.js";

function startOutboundTicker(
  store: Store,
  tickMs: number,
  build: (workspaceId: string) => Promise<ReturnType<typeof buildWorkspaceSender> | null>,
  options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number },
): void {
  if (!tickMs || tickMs <= 0) return;
  const timer = setInterval(() => {
    processAllWorkspaces(store, build, options).catch((error) => {
      console.error("[core] outbound tick falhou:", (error as Error).message);
    });
  }, tickMs);
  timer.unref?.();
  console.log(`[core] ticker da fila de saída a cada ${tickMs}ms.`);
}

function startMailSyncTicker(
  store: Store,
  options: { intervalMs: number; receiver: ReturnType<typeof createImapReceiver>; secretsKey: string; ai?: import("./ai/orchestrate.js").AiDeps },
): void {
  if (!options.intervalMs || options.intervalMs <= 0) return;
  const timer = setInterval(() => {
    syncAllMailboxes(store, options.receiver, options.secretsKey, options.ai).catch((error) => {
      console.error("[core] mail sync falhou:", (error as Error).message);
    });
  }, options.intervalMs);
  timer.unref?.();
  console.log(`[core] polling IMAP a cada ${options.intervalMs}ms.`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertProdSecrets(config);

  const store =
    config.storeDriver === "postgres" && config.databaseUrl
      ? new PostgresStore(createPool(config.databaseUrl))
      : new MemoryStore();

  if (config.storeDriver === "memory") {
    console.warn(
      "[core] STORE_DRIVER=memory — persistência em memória (dev/teste). " +
        "Produção/staging usam postgres (ver coolify/).",
    );
  }

  const metaAdapter =
    config.metaAppId && config.metaAppSecret && config.metaRedirectUri
      ? createMetaHttpAdapter({
          appId: config.metaAppId,
          appSecret: config.metaAppSecret,
          redirectUri: config.metaRedirectUri,
          apiVersion: config.metaApiVersion,
        })
      : null;
  if (!metaAdapter) {
    console.warn(
      "[core] META_APP_ID/SECRET/REDIRECT_URI ausentes — OAuth Meta desabilitado " +
        "(conexão manual continua disponível).",
    );
  }

  const mailSender = createSmtpSender();
  const mailReceiver = createImapReceiver();

  const app = await buildApp({
    store,
    jwtSecret: config.jwtSecret,
    jwtExpiresIn: config.jwtExpiresIn,
    inviteTtlHours: config.inviteTtlHours,
    logger: true,
    s3: {
      s3Endpoint: config.s3Endpoint,
      s3Region: config.s3Region,
      s3AccessKey: config.s3AccessKey,
      s3SecretKey: config.s3SecretKey,
      s3BucketMidia: config.s3BucketMidia,
    },
    waha: {
      adapter: config.wahaApiUrl
        ? createWahaHttpAdapter({
            apiUrl: config.wahaApiUrl,
            apiKey: config.wahaApiKey,
          })
        : null,
      webhookSecret: config.wahaWebhookSecret,
    },
    meta: {
      adapter: metaAdapter,
      appId: config.metaAppId,
      appSecret: config.metaAppSecret,
      verifyToken: config.metaVerifyToken,
      redirectUri: config.metaRedirectUri,
      secretsKey: config.jwtSecret,
    },
    mail: {
      sender: mailSender,
      receiver: mailReceiver,
      secretsKey: config.jwtSecret,
    },
    outbound: {
      maxAttempts: config.outboundMaxAttempts,
      baseDelayMs: config.outboundBaseDelayMs,
      maxDelayMs: config.outboundMaxDelayMs,
    },
    ai: {
      secretsKey: config.jwtSecret,
    },
  });

  startOutboundTicker(
    store,
    config.outboundTickMs,
    async (workspaceId) =>
      buildWorkspaceSender({
        store,
        workspaceId,
        metaAdapter,
        mailSender,
        secretsKey: config.jwtSecret,
      }),
    {
      maxAttempts: config.outboundMaxAttempts,
      baseDelayMs: config.outboundBaseDelayMs,
      maxDelayMs: config.outboundMaxDelayMs,
    },
  );
  startMailSyncTicker(store, {
    intervalMs: config.mailSyncIntervalMs,
    receiver: mailReceiver,
    secretsKey: config.jwtSecret,
    ai: { secretsKey: config.jwtSecret },
  });

  const shutdown = async (): Promise<void> => {
    try {
      await app.close();
    } finally {
      await closeInfra();
    }
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error) => {
  console.error("[core] Falha ao iniciar:", error);
  process.exit(1);
});

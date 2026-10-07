import { loadConfig, assertProdSecrets } from "./config.js";
import { buildApp } from "./app.js";
import { MemoryStore } from "./stores/memory.js";
import { PostgresStore, createPool } from "./stores/postgres.js";
import { closeInfra } from "./infra.js";
import { createWahaHttpAdapter } from "./waha/wahaHttpAdapter.js";

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

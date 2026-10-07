import { loadConfig, assertProdSecrets } from "./config.js";
import { buildApp } from "./app.js";
import { MemoryStore } from "./stores/memory.js";
import { PostgresStore, createPool } from "./stores/postgres.js";
import { closeInfra } from "./infra.js";

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

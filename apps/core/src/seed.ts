import { loadConfig } from "./config.js";
import { MemoryStore } from "./stores/memory.js";
import { PostgresStore, createPool } from "./stores/postgres.js";
import { hashPassword } from "./lib/password.js";

/** Cria o dono (owner_global) a partir de OWNER_EMAIL/OWNER_PASSWORD. Idempotente. */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.ownerEmail || !config.ownerPassword) {
    throw new Error("OWNER_EMAIL e OWNER_PASSWORD são obrigatórios para o seed.");
  }
  const store =
    config.storeDriver === "postgres" && config.databaseUrl
      ? new PostgresStore(createPool(config.databaseUrl))
      : new MemoryStore();

  const existing = await store.findUserByEmail(config.ownerEmail);
  if (existing) {
    console.log(`[seed] dono já existe: ${existing.email}`);
    return;
  }
  const user = await store.createUser({
    email: config.ownerEmail,
    passwordHash: await hashPassword(config.ownerPassword),
    name: config.ownerName,
    isOwnerGlobal: true,
  });
  console.log(`[seed] dono criado: ${user.email} (owner_global)`);
  process.exit(0);
}

main().catch((error) => {
  console.error("[seed] falhou:", error);
  process.exit(1);
});

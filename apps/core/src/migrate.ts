import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { loadConfig } from "./config.js";

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
}

async function loadApplied(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query("SELECT name FROM schema_migrations");
  return new Set(rows.map((r: { name: string }) => String(r.name)));
}

async function listMigrationFiles(dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`Nenhuma migration em ${dir}`);
  return files;
}

async function applyMigration(
  pool: Pool,
  dir: string,
  file: string,
  appDbPassword: string,
): Promise<void> {
  const sql = (await readFile(path.join(dir, file), "utf8")).replaceAll(
    "${APP_DB_PASSWORD}",
    appDbPassword.replaceAll("'", "''"),
  );
  console.log(`[migrate] aplicando ${file}...`);
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await pool.query("COMMIT");
    console.log(`[migrate] ${file} — ok.`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

/** Roda `migrations/*.sql` em ordem com o role migrador (owner, BYPASSRLS). */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrlMigrator) {
    throw new Error("DATABASE_URL_MIGRATOR (ou DATABASE_URL) não configurado.");
  }
  const dir = path.resolve(__dirname, "..", "migrations");
  const files = await listMigrationFiles(dir);

  const appDbPassword = process.env.APP_DB_PASSWORD;
  if (!appDbPassword) {
    throw new Error("APP_DB_PASSWORD não configurado (senha do role app_user).");
  }

  const pool = new Pool({ connectionString: config.databaseUrlMigrator });
  try {
    await ensureMigrationsTable(pool);
    const applied = await loadApplied(pool);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] ${file} — já aplicada, pulando.`);
        continue;
      }
      await applyMigration(pool, dir, file, appDbPassword);
    }
    console.log("[migrate] concluído.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate] falhou:", error);
  process.exit(1);
});

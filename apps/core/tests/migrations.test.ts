import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const TENANT_TABLES = [
  "workspace_members",
  "invites",
  "contacts",
  "contact_channels",
  "tags",
  "conversations",
  "conversation_tags",
  "messages",
  "notes",
  "contact_events",
];
const ALL_TABLES = ["users", "workspaces", ...TENANT_TABLES];

function readAllSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

/**
 * Auditoria estática do contrato F0: RLS em TODAS as tabelas e
 * workspace_id obrigatório nas tabelas tenant. Roda sem banco.
 */
describe("migrations: RLS + workspace_id", () => {
  const sql = readAllSql();

  it.each(ALL_TABLES)("tabela %s tem RLS ativado e forçado", (table) => {
    const enable = new RegExp(
      `ALTER TABLE\\s+${table}\\s+ENABLE ROW LEVEL SECURITY`,
      "i",
    );
    const force = new RegExp(
      `ALTER TABLE\\s+${table}\\s+FORCE ROW LEVEL SECURITY`,
      "i",
    );
    expect(sql).toMatch(enable);
    expect(sql).toMatch(force);
  });

  it.each(TENANT_TABLES)("tabela tenant %s exige workspace_id", (table) => {
    expect(sql).toMatch(new RegExp(`${table}[\\s\\S]*?workspace_id\\s+UUID\\s+NOT NULL`, "i"));
  });

  it("policies tenant usam app.current_workspace_id", () => {
    const matches = sql.match(/app\.current_workspace_id/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(TENANT_TABLES.length);
  });

  it("role app_user existe e recebe grants (sem BYPASSRLS)", () => {
    expect(sql).toMatch(/CREATE ROLE app_user/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*?TO app_user/i);
    expect(sql).not.toMatch(/BYPASSRLS/);
  });

  it("convites usam token por hash único", () => {
    expect(sql).toMatch(/token_hash\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*token_hash\s*\)/i);
  });
});

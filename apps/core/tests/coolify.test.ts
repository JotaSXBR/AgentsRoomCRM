import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COOLIFY_DIR = path.resolve(__dirname, "../../../coolify");
const RESOURCES = ["core", "postgres", "redis", "waha", "storage", "ollama"];
const PROJECTS = ["prod", "staging"] as const;

function read(name: string): string {
  return readFileSync(path.join(COOLIFY_DIR, name), "utf8");
}

/**
 * Contrato Coolify (F0): mesma VPS, dois projetos, zero contato de rede.
 * Segredos nascem gerados no Coolify; o repo guarda guias + mapa
 * de-onde-para-onde (`<projeto>/env.example`), nunca valores.
 */
describe("coolify: projetos e recursos separados", () => {
  it.each(RESOURCES)("recurso %s tem guia próprio", (resource) => {
    expect(
      existsSync(path.join(COOLIFY_DIR, "resources", resource, "README.md")),
      resource,
    ).toBe(true);
  });

  it.each(PROJECTS)("projeto %s tem README e env.example", (project) => {
    expect(existsSync(path.join(COOLIFY_DIR, project, "README.md"))).toBe(true);
    expect(existsSync(path.join(COOLIFY_DIR, project, "env.example"))).toBe(true);
  });

  it("staging usa destination/rede própria (sem contato com a prod)", () => {
    expect(read("staging/README.md")).toMatch(/coolify-staging/);
    expect(read("prod/README.md")).not.toMatch(/coolify-staging/);
  });

  it("env examples trazem origens, não segredos reais", () => {
    const BENIGN = new Set(["admin", "info", "debug", "padrao", "12h"]);
    for (const project of PROJECTS) {
      const lines = read(`${project}/env.example`).split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const value = trimmed.slice(trimmed.indexOf("=") + 1).trim();
        const ok =
          value === "" ||
          value.startsWith("gerar") ||
          value.includes("<") ||
          value.includes("exemplo") ||
          BENIGN.has(value);
        expect(ok, `${project}: valor real em '${trimmed}'`).toBe(true);
      }
    }
  });

  it("waha usa engine GOWS (deploy oficial)", () => {
    const compose = read("resources/waha/compose.yml");
    expect(compose).toMatch(/image: devlikeapro\/waha:gows/);
    expect(compose).toMatch(/WHATSAPP_DEFAULT_ENGINE:\s*GOWS/);
    expect(compose).toMatch(/:\/app\/\.sessions/);
    expect(compose).not.toMatch(/aldonunes\/gows/);
  });

  it("storage usa variáveis oficiais RustFS", () => {
    const compose = read("resources/storage/compose.yml");
    expect(compose).toMatch(/image: rustfs\/rustfs/);
    expect(compose).toMatch(/RUSTFS_ACCESS_KEY/);
    expect(compose).toMatch(/RUSTFS_SECRET_KEY/);
    expect(compose).not.toMatch(/RUSTFS_ROOT_/);
    expect(compose).toMatch(/\/health\/ready/);
  });

  it("variáveis dos composes de recurso vêm dos env examples", () => {
    const composeVars = new Set(
      [
        ...read("resources/waha/compose.yml").matchAll(
          /\$\{([A-Z_][A-Z0-9_]*)/g,
        ),
        ...read("resources/storage/compose.yml").matchAll(
          /\$\{([A-Z_][A-Z0-9_]*)/g,
        ),
      ].map((m) => m[1]),
    );
    expect(composeVars.size).toBeGreaterThan(0);
    for (const project of PROJECTS) {
      const example = read(`${project}/env.example`);
      for (const name of composeVars) {
        expect(
          example,
          `${name} sem origem em ${project}/env.example`,
        ).toMatch(new RegExp(`^#?\\s*${name}=`, "m"));
      }
    }
  });

  it("redis.conf existe e exige persistência", () => {
    const conf = read("resources/redis/redis.conf");
    expect(conf).toMatch(/appendonly yes/);
    expect(conf).toMatch(/maxmemory-policy noeviction/);
  });

  it("scripts de bootstrap existem", () => {
    for (const file of [
      "resources/waha/bootstrap.sh",
      "resources/storage/bootstrap.sh",
      "resources/ollama/pull-models.sh",
    ]) {
      expect(existsSync(path.join(COOLIFY_DIR, file)), file).toBe(true);
    }
  });

  it("entrypoint do core (migrate automático) referenciado no Dockerfile", () => {
    const dockerfile = readFileSync(
      path.resolve(__dirname, "../Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(/docker-entrypoint\.sh/);
    expect(
      existsSync(path.resolve(__dirname, "../docker-entrypoint.sh")),
    ).toBe(true);
  });

  it("stack local tem todos os serviços e é neutra de ambiente", () => {
    const local = read("local/docker-compose.yml");
    for (const service of [
      "core",
      "postgres",
      "redis",
      "waha",
      "rustfs",
      "ollama",
    ]) {
      expect(local).toMatch(new RegExp(`^  ${service}:`, "m"));
    }
    expect(local).toMatch(/image: devlikeapro\/waha:gows/);
    expect(local).not.toMatch(/-(prod|staging)\b/);
  });
});

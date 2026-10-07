// Fast lint tier. Everything here runs without type information, which is
// what keeps it quick enough for a pre-commit hook. The rules that need the
// type checker live in eslint.typed.config.mjs and run on their own script.
//
// Adapted from vibe-coding-toolkit templates/eslint (MAX_LINES=350) to this
// monorepo: source roots apps/*/src + packages/*/src, no import-x block
// (no layering to enforce via import-x yet), quality rules wired to the
// real data module (stores/postgres) and log adapter (infra/logger).
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

import quality from "./eslint-rules/index.cjs";

export default defineConfig([
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
      // js.configs.recommended turns on no-undef, which knows nothing about
      // the runtime this project targets. Node + browser (widget) globals
      // declared explicitly; switch to the `globals` package if it grows.
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        document: "readonly",
        window: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strict,

  // Framework presets: none in use (Fastify API + tiny browser widget).
  // Add a curated files-scoped block per plugin when a framework arrives.

  {
    files: [
      "apps/*/src/**/*.{js,ts,mjs,cjs}",
      "packages/*/src/**/*.{js,ts,mjs,cjs}",
    ],
    plugins: { quality },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-var": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Size/complexity budget stays "warn": conversation starter, promote
      // to "error" once the count for it reaches zero.
      complexity: ["warn", 12],
      "max-depth": ["warn", 4],
      "max-statements": ["warn", 20],
      "max-params": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      "max-nested-callbacks": ["warn", 3],
      // Baseline 2026-10-07: 3 files over 350 (postgres.ts ~1096,
      // memory.ts ~745, store.ts ~359). Explicit ignore list beats a rule
      // nobody trusts; empty the list, then drop the option.
      "quality/max-lines": [
        "error",
        {
          max: 350,
          ignore: [
            "apps/core/src/stores/postgres.ts",
            "apps/core/src/stores/memory.ts",
            "apps/core/src/stores/store.ts",
          ],
        },
      ],
      "quality/no-direct-console": ["error", { logger: "infra/logger" }],
      // Routes/realtime must go through stores/*, never pg/pool directly.
      // Only server.ts/seed.ts/migrate.ts may construct the pool.
      "quality/no-direct-data-access": [
        "error",
        {
          modules: ["pg", "./stores/postgres.js", "../stores/postgres.js"],
          bindings: ["Pool", "PostgresStore", "createPool"],
          layers: ["/apps/core/src/routes/", "/apps/core/src/realtime/"],
        },
      ],
    },
  },
  {
    // The log adapter itself, plus anything that must log before the rest of
    // the infrastructure is reachable. MUST come after the block that turns
    // the rule on: flat config applies the later block last.
    files: [
      "apps/core/src/infra/logger.ts",
      "apps/core/src/migrate.ts",
      "apps/core/src/seed.ts",
      "apps/core/src/server.ts",
    ],
    rules: {
      "quality/no-direct-console": "off",
    },
  },
  {
    // Browser widget: console is a visible UX fallback, not server logging.
    files: ["apps/core/src/routes/widget.ts"],
    rules: {
      "quality/no-direct-console": "off",
    },
  },
  {
    // Same file budget for test files, at "warn", placed after the "error"
    // block for the same ordering reason.
    files: [
      "**/*.test.{ts,tsx}",
      "**/{__tests__,__mocks__,fixtures,mocks}/**/*.{ts,tsx}",
    ],
    plugins: { quality },
    rules: {
      "quality/max-lines": ["warn", { includeTests: true }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "max-statements": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
    },
  },
  {
    files: ["eslint-rules/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".agentsroom/**",
    ".claude/**",
    ".github/agents/**",
    ".github/hooks/**",
    ".github/skills/**",
    "node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    "**/*.tsbuildinfo",
    "package-lock.json",
    "research/**",
    "coolify/**",
    "**/*.d.ts",
    "**/*.js",
    "apps/core/public/**",
  ]),
]);

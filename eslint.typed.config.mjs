// Type-aware lint tier, deliberately kept OUT of eslint.config.mjs. Turning
// on projectService means ESLint builds a full TypeScript program, which on
// a large codebase is slow enough to break a pre-commit hook and heavy
// enough to exhaust the heap on a small CI runner.
//
// Two config files and two npm scripts (`lint` and `lint:types`), rather
// than one config branching on process.env.CI: branching makes local and CI
// behavior diverge silently for identical code, and reading process.env
// inside a flat config file trips that config's own no-undef rule.
import defaultConfig from "./eslint.config.mjs";

export default [
  ...defaultConfig,
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Every rule here starts at "warn". None of them has a known violation
      // count on a codebase this config has never run against, so none of
      // them gets to fail a build sight unseen. Promote to "error" per rule,
      // once its count is zero.
      //
      // Baseline 2026-10-07 (npm run lint:types → 0 errors):
      // - require-await ~60: MemoryStore methods implement the async Store
      //   interface (Postgres impl awaits); removing async would break the
      //   interface contract. Tracked debt, not a fix.
      // - no-unsafe-* ~150: pg result rows typed as any in stores/postgres.ts
      //   (+ waha adapter payloads). Typing all rows is the expensive tail;
      //   fix per-file when touching it.
      // - return-await: zero — fixed (FastifyReply is thenable).
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/return-await": ["warn", "in-try-catch"],
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/require-await": "warn",
    },
  },
];

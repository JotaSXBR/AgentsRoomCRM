import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agentsroom/shared": path.resolve(
        __dirname,
        "../../packages/shared/src/index.ts",
      ),
      "@agentsroom/db": path.resolve(
        __dirname,
        "../../packages/db/src/index.ts",
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Suite completa cria dezenas de usuários com bcrypt via /auth/register;
    // em CI sob carga um teste pesado passa de 5s. Margem global para a suite.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

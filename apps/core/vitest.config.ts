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
  },
});

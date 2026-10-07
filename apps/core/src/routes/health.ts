import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "core",
    version: "0.1.0",
    uptime: process.uptime(),
  }));

  app.get("/ready", async () => ({
    status: "ok",
    // F1: incluir checagens reais de postgres/redis aqui.
    checks: { store: "ok" },
  }));
}

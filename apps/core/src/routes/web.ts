import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/** Página estática da inbox (responsiva; modo reduzido no mobile). */
export async function webRoutes(app: FastifyInstance): Promise<void> {
  const html = readFileSync(
    path.resolve(__dirname, "../../public/inbox.html"),
    "utf8",
  );
  app.get("/app/inbox", async (_request, reply) => {
    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header(
        "Content-Security-Policy",
        "default-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
      )
      .send(html);
  });
}

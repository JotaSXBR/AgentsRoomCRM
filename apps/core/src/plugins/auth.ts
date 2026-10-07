import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "@agentsroom/shared";
import type { AuthUser, Store } from "../stores/store.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

/**
 * JWT obrigatório (via `onRequest: [app.authenticate]` nas rotas privadas).
 * Carrega o usuário do store a cada request para que mudanças em
 * `is_owner_global` tenham efeito imediato.
 */
export async function registerAuth(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.decorate(
    "authenticate",
    async (request: FastifyRequest): Promise<void> => {
      try {
        await request.jwtVerify();
      } catch {
        throw HttpError.unauthorized();
      }
      const decoded = request.user as {
        sub?: unknown;
      };
      if (typeof decoded?.sub !== "string") throw HttpError.unauthorized();
      const user = await store.findUserById(decoded.sub);
      if (!user) throw HttpError.unauthorized("Usuário não existe mais.");
      request.authUser = {
        id: user.id,
        email: user.email,
        isOwnerGlobal: user.isOwnerGlobal,
      };
    },
  );
}

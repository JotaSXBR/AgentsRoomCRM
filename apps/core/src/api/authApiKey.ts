import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "@agentsroom/shared";
import type { ApiKeyRecord, Store } from "../stores/store.js";
import { hashToken } from "../lib/tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey: ApiKeyRecord;
  }
  interface FastifyInstance {
    authenticateApiKey: (request: FastifyRequest) => Promise<void>;
  }
}

/** Extrai a chave do header `Authorization: Bearer` ou `X-API-Key`. */
export function readApiKeyHeader(headers: Record<string, unknown>): string | null {
  const direct = headers["x-api-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const auth = headers.authorization;
  if (typeof auth === "string" && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return null;
}

/**
 * Autenticação machine-to-machine (F5). A chave carrega o próprio tenant:
 * `workspaceId` vem sempre da chave, nunca do corpo/URL, então não há como
 * atravessar workspace — o RLS continua sendo a segunda camada.
 */
export async function registerApiKeyAuth(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.decorate("authenticateApiKey", async (request: FastifyRequest): Promise<void> => {
    const raw = readApiKeyHeader(request.headers as Record<string, unknown>);
    if (!raw) throw HttpError.unauthorized("Informe a chave de API (Authorization: Bearer).");
    const key = await store.findApiKeyByHash(hashToken(raw));
    if (!key || key.revokedAt) throw HttpError.unauthorized("Chave de API inválida ou revogada.");
    // `last_used_at` é informativo: falhar aqui não pode derrubar a requisição.
    await store.touchApiKey(key.workspaceId, key.id).catch(() => null);
    request.apiKey = key;
  });
}

/** Garante que a chave tem o escopo exigido pela rota. */
export function assertScope(key: ApiKeyRecord, scope: string): void {
  if (!key.scopes.includes(scope as ApiKeyRecord["scopes"][number])) {
    throw HttpError.forbidden(`Chave sem o escopo '${scope}'.`);
  }
}
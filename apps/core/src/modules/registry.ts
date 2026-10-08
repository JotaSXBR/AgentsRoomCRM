import type { FastifyInstance } from "fastify";
import type { McpToolDefinition } from "../mcp/protocol.js";
import type { Store } from "../stores/store.js";

/**
 * Contexto entregue a cada módulo: o app Fastify, o store e o hub de eventos.
 * Um módulo nunca fala com Postgres direto — só pelo `Store`, que já carrega
 * o isolamento por workspace e o RLS.
 */
export interface ModuleContext {
  app: FastifyInstance;
  store: Store;
}

export interface CrmModule {
  /** Chave estável (`relatorios`, `lgpd`, `ia`): liga/desliga por workspace. */
  key: string;
  name: string;
  description: string;
  version: string;
  /** Rotas HTTP próprias do módulo (o tenancy continua obrigatório nelas). */
  routes?: (ctx: ModuleContext) => Promise<void>;
  /** Tools MCP do módulo, injetadas no servidor MCP. */
  mcpTools?: McpToolDefinition[];
}

export interface ModuleRegistry {
  modules: CrmModule[];
  register(module: CrmModule): void;
  keys(): string[];
  toolList(): McpToolDefinition[];
}

/**
 * Registro de módulos extensíveis (F5). Adicionar uma capacidade nova =
 * criar um `CrmModule` e registrá-lo: rotas e tools MCP entram sozinhas, e o
 * workspace liga/desliga pela chave em `workspace_modules`.
 */
export function createModuleRegistry(initial: CrmModule[] = []): ModuleRegistry {
  const modules: CrmModule[] = [];
  const seen = new Set<string>();
  const register = (module: CrmModule): void => {
    if (seen.has(module.key)) return;
    seen.add(module.key);
    modules.push(module);
  };
  for (const module of initial) register(module);
  return {
    modules,
    register,
    keys: () => modules.map((m) => m.key),
    toolList: () => modules.flatMap((m) => m.mcpTools ?? []),
  };
}

/** Módulos desligados explicitamente por workspace (default: todos ligados). */
export async function disabledModuleKeys(
  store: Store,
  workspaceId: string,
  known: string[],
): Promise<Set<string>> {
  const rows = await store.listWorkspaceModules(workspaceId);
  const disabled = new Set<string>();
  for (const row of rows) {
    if (!known.includes(row.moduleKey)) continue;
    if (!row.enabled) disabled.add(row.moduleKey);
  }
  return disabled;
}
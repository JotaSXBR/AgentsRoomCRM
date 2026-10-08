import type { FastifyInstance } from "fastify";
import { handleRpc } from "../mcp/dispatcher.js";
import { CRM_TOOLS } from "../mcp/tools.js";
import type { McpToolDefinition } from "../mcp/protocol.js";
import type { Store } from "../stores/store.js";

/**
 * Servidor MCP (Model Context Protocol) sobre HTTP + JSON-RPC 2.0.
 *
 * - `POST /mcp` autentica por chave de API (`Authorization: Bearer` ou
 *   `X-API-Key`): a chave carrega o workspace, então um agente externo só vê e
 *   só escreve no tenant da própria chave. O `workspaceId` das tools é injetado
 *   pelo servidor, nunca aceito do cliente.
 * - Métodos: `initialize`, `notifications/initialized`, `ping`, `tools/list`,
 *   `tools/call`.
 * - Sem sessão stateful: cada requisição é autocontida, o que mantém o servidor
 *   seguro para escalar horizontalmente (nada em memória entre chamadas).
 */
export async function mcpRoutes(
  app: FastifyInstance,
  store: Store,
  options: { tools?: McpToolDefinition[] } = {},
): Promise<void> {
  const tools = options.tools ?? CRM_TOOLS;

  app.post("/mcp", { onRequest: [app.authenticateApiKey] }, async (request, reply) => {
    const key = request.apiKey;
    const body = (await request.body) as { id?: unknown } | null;
    const isNotification = body !== null && typeof body === "object" && body.id === undefined;
    const response = await handleRpc(
      { store, tools, workspaceId: key.workspaceId, scopes: key.scopes },
      body,
    );
    if (isNotification) return reply.code(202).send();
    return reply.send(response);
  });

  // Descoberta para quem integra por HTTP: o que dá para fazer com a chave.
  app.get("/mcp/tools", { onRequest: [app.authenticateApiKey] }, async (request) => {
    const key = request.apiKey;
    return {
      workspaceId: key.workspaceId,
      tools: tools
        .filter((tool) => tool.scopes.some((scope) => key.scopes.includes(scope as never)))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
    };
  });
}
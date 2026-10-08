import { z } from "zod";
import type { Store } from "../stores/store.js";
import {
  negotiateProtocolVersion,
  parseRpcRequest,
  rpcError,
  rpcResult,
  serverInfo,
  toolError,
  toolResult,
  type JsonRpcRequest,
  type McpToolDefinition,
} from "./protocol.js";

export interface McpContext {
  store: Store;
  tools: McpToolDefinition[];
  /** Workspace da chave que abriu a sessão: injetado, nunca vindo do cliente. */
  workspaceId: string;
  scopes: string[];
}

function findTool(tools: McpToolDefinition[], name: unknown): McpToolDefinition | null {
  return typeof name === "string" ? (tools.find((t) => t.name === name) ?? null) : null;
}

function toolAllowed(tool: McpToolDefinition, scopes: string[]): boolean {
  return tool.scopes.some((scope) => scopes.includes(scope));
}

function toolListing(tools: McpToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * O `workspaceId` das tools é SEMPRE o da chave de API: um valor conflitante
 * enviado pelo cliente é sobrescrito, nunca respeitado — sem isso a tool viraria
 * um caminho de escape entre tenants.
 */
function withScopedWorkspace(args: Record<string, unknown>, workspaceId: string): Record<string, unknown> {
  return { ...args, workspaceId };
}

async function callTool(ctx: McpContext, request: JsonRpcRequest): Promise<Record<string, unknown>> {
  const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
  const tool = findTool(ctx.tools, params.name);
  if (!tool) return rpcError(request.id, -32602, `Tool desconhecida: ${String(params.name)}`);
  if (!toolAllowed(tool, ctx.scopes)) {
    return rpcError(request.id, -32603, `Escopo insuficiente para '${tool.name}'.`);
  }
  const args = z.record(z.unknown()).parse(params.arguments ?? {});
  try {
    const value = await tool.handler(withScopedWorkspace(args, ctx.workspaceId), ctx.store);
    return rpcResult(request.id, toolResult(value));
  } catch (error) {
    // Erro de tool vira resultado com isError e a sessão continua viva: é o que
    // deixa o agente externo ler a mensagem e corrigir a chamada.
    return rpcResult(request.id, toolError((error as Error).message));
  }
}

/** Despacha um envelope JSON-RPC para o método MCP correspondente. */
export async function handleRpc(ctx: McpContext, body: unknown): Promise<Record<string, unknown>> {
  let request: JsonRpcRequest;
  try {
    request = parseRpcRequest(body);
  } catch (error) {
    return rpcError(null, -32700, (error as Error).message);
  }
  if (request.method === "initialize") {
    const version = negotiateProtocolVersion(
      (request.params as { protocolVersion?: unknown } | undefined)?.protocolVersion,
    );
    return rpcResult(request.id, { ...serverInfo(), protocolVersion: version });
  }
  switch (request.method) {
    case "notifications/initialized":
    case "initialized":
    case "ping":
      return rpcResult(request.id, {});
    case "tools/list":
      return rpcResult(request.id, {
        tools: toolListing(ctx.tools.filter((tool) => toolAllowed(tool, ctx.scopes))),
      });
    case "tools/call":
      return callTool(ctx, request);
    default:
      return rpcError(request.id, -32601, `Método não suportado: ${request.method}`);
  }
}
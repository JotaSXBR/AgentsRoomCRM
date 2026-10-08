import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";

/** Protocolo MCP negoceado; aceitamos o do cliente quando conhecido. */
export const SUPPORTED_PROTOCOL = "2025-06-18";
const KNOWN_PROTOCOLS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
  "2026-07-28",
]);

export interface McpContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Só escopos de chave de API autorizados a chamar esta tool. */
  scopes: string[];
  handler: (args: Record<string, unknown>, store: Store) => Promise<unknown>;
}

export function toolResult(value: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});

export type JsonRpcRequest = z.infer<typeof requestSchema>;

export function parseRpcRequest(body: unknown): JsonRpcRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw HttpError.badRequest("jsonrpc_invalido", "Envelope JSON-RPC 2.0 inválido.");
  }
  return parsed.data;
}

export function rpcResult(id: JsonRpcRequest["id"], result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" && KNOWN_PROTOCOLS.has(requested)
    ? requested
    : SUPPORTED_PROTOCOL;
}

export function serverInfo(): Record<string, unknown> {
  return {
    protocolVersion: SUPPORTED_PROTOCOL,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "agentsroom-crm", version: "0.5.0" },
  };
}
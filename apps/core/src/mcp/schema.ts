/**
 * Schema base das tools MCP (F5).
 *
 * `workspaceId` aparece como propriedade exigida porque é assim que o agente
 * lê o contrato em `tools/list` — mas o valor real é SEMPRE injetado pelo
 * servidor a partir da chave de API (ver `dispatcher.ts`), nunca aceito do
 * cliente. Isso mantém a documentação honesta sem abrir brecha de tenant.
 */
export function wsSchema(
  extra: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      workspaceId: { type: "string", description: "Id do workspace (injetado pela chave de API)." },
      ...extra,
    },
    required: ["workspaceId", ...required],
  };
}

export function str(description: string): { type: string; description: string } {
  return { type: "string", description };
}

export function strArray(description: string): Record<string, unknown> {
  return { type: "array", items: { type: "string" }, description };
}
import { CRM_TOOLS } from "./tools.js";

export interface McpToolSummary {
  name: string;
  description: string;
  scopes: string[];
  title: string;
}

/** Rótulos em português para o catálogo de tools (o cliente mostra ao usuário). */
const TITLES: Record<string, string> = {
  criar_fila: "Criar fila",
  listar_filas: "Listar filas",
  criar_regra_bot: "Criar regra do bot",
  criar_fluxo: "Criar fluxo de atendimento",
  listar_fluxos: "Listar fluxos",
  criar_webhook: "Criar webhook de saída",
  criar_chave_api: "Criar chave de API",
  metricas_qualidade: "Consultar TME/TMA/CSAT",
  registrar_consentimento: "Registrar consentimento LGPD",
  exportar_contato: "Exportar dados do contato",
  excluir_contato: "Excluir dados do contato",
};

/** Snapshot das tools MCP — usado por `/mcp/tools` e pelos testes. */
export function mcpToolCatalog(): McpToolSummary[] {
  return CRM_TOOLS.map((tool) => ({
    name: tool.name,
    title: TITLES[tool.name] ?? tool.name,
    description: tool.description,
    scopes: tool.scopes,
  }));
}
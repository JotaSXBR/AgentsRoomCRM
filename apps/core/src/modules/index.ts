import type { CrmModule } from "./registry.js";
import { createModuleRegistry } from "./registry.js";
import { registerIntegrationsRoutes } from "../routes/integrations.js";
import { registerReportRoutes } from "../routes/reports.js";
import { registerLgpdRoutes } from "../routes/lgpd.js";
import { CRM_TOOLS } from "../mcp/tools.js";

const VERSION = "1.0.0";

function pick(names: string[]) {
  return CRM_TOOLS.filter((tool) => names.includes(tool.name));
}

/**
 * Módulos da F5 (sistema extensível). Cada módulo é uma unidade independente:
 * traz suas rotas HTTP e suas tools MCP, e o workspace liga/desliga pela chave
 * em `workspace_modules` — sem deploy para desativar uma capacidade.
 */
export const F5_MODULES: CrmModule[] = [
  {
    key: "integracoes",
    name: "Integrações",
    description: "Chaves de API pública e webhooks de saída assinados (HMAC).",
    version: VERSION,
    routes: async ({ app, store }) => registerIntegrationsRoutes(app, store),
    mcpTools: pick(["criar_webhook", "criar_chave_api"]),
  },
  {
    key: "relatorios",
    name: "Relatórios",
    description: "TME/TMA/CSAT por atendente, fila ou canal, com exportação CSV.",
    version: VERSION,
    routes: async ({ app, store }) => registerReportRoutes(app, store),
    mcpTools: pick(["metricas_qualidade"]),
  },
  {
    key: "lgpd",
    name: "LGPD",
    description: "Consentimento por finalidade, exportação e exclusão de dados do titular.",
    version: VERSION,
    routes: async ({ app, store }) => registerLgpdRoutes(app, store),
    mcpTools: pick(["registrar_consentimento", "exportar_contato", "excluir_contato"]),
  },
  {
    key: "automacao",
    name: "Automação",
    description: "Filas, regras do bot e fluxos disparados por termos.",
    version: VERSION,
    mcpTools: pick(["criar_fila", "listar_filas", "criar_regra_bot", "criar_fluxo", "listar_fluxos"]),
  },
];

/** Registro pronto: `registry.keys()` alimenta as rotas de management. */
export function buildRegistry(): ReturnType<typeof createModuleRegistry> {
  return createModuleRegistry(F5_MODULES);
}
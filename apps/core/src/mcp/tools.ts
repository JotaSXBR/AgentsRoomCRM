import { z } from "zod";
import { buildQualityReport, QUALITY_GROUPS } from "../reports/quality.js";
import { createKeyRecord, exportContact } from "./helpers.js";
import { generateWebhookSecret } from "../lib/apiKeys.js";
import { str, strArray, wsSchema as ws } from "./schema.js";
import { AUTOMATION_TOOLS } from "./toolsAutomation.js";
import type { McpToolDefinition } from "./protocol.js";

const KIND_CONSENT = ["dados", "marketing", "ia"] as const;
const SCOPES_API = ["mcp", "api:leitura", "api:escrita"] as const;

/** Integrações, métricas e LGPD (F5). */
const INTEGRATION_TOOLS: McpToolDefinition[] = [
  {
    name: "criar_webhook",
    description:
      "Registra endpoint de saída. O segredo HMAC volta uma única vez; cada entrega é assinada.",
    inputSchema: ws(
      {
        name: { type: "string" },
        url: str("HTTP/HTTPS do receptor."),
        events: strArray('Eventos assinados; ["*"] = todos.'),
      },
      ["name", "url"],
    ),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => {
      const workspaceId = String(args.workspaceId ?? "");
      const body = z
        .object({
          name: z.string().min(1).max(80),
          url: z.string().url(),
          events: z.array(z.string().min(1)).optional(),
        })
        .parse(args);
      const endpoint = await store.createWebhookEndpoint({
        workspaceId,
        name: body.name,
        url: body.url,
        events: body.events,
        secret: generateWebhookSecret(),
      });
      return {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        events: endpoint.events,
        secret: endpoint.secret,
        aviso: "Guarde o segredo agora: ele não é exibido de novo.",
      };
    },
  },
  {
    name: "criar_chave_api",
    description: "Emite chave de API do workspace. A chave volta UMA vez (o servidor guarda só o hash).",
    inputSchema: ws(
      {
        name: { type: "string" },
        scopes: { type: "array", items: { type: "string", enum: [...SCOPES_API] } },
      },
      ["name"],
    ),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => {
      const workspaceId = String(args.workspaceId ?? "");
      const body = z
        .object({
          name: z.string().min(1).max(80),
          scopes: z.array(z.enum(SCOPES_API)).optional(),
        })
        .parse(args);
      return createKeyRecord({ store, workspaceId, name: body.name, scopes: body.scopes ?? ["mcp"] });
    },
  },
  {
    name: "metricas_qualidade",
    description: "Relatório de TME/TMA/CSAT por atendente, fila, canal ou total, numa janela ISO.",
    inputSchema: ws(
      {
        groupBy: { type: "string", enum: [...QUALITY_GROUPS] },
        from: str("ISO 8601 com offset."),
        to: str("ISO 8601 com offset."),
        tmeAlvoSeg: { type: "number", description: "Meta de TME em segundos (calcula SLA%)." },
      },
      [],
    ),
    scopes: ["mcp", "api:leitura"],
    handler: async (args, store) => {
      const body = z
        .object({
          workspaceId: z.string().min(1),
          groupBy: z.enum(QUALITY_GROUPS).optional(),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
          tmeAlvoSeg: z.number().int().positive().nullish(),
        })
        .parse(args);
      return buildQualityReport(store, body.workspaceId, {
        from: body.from ? new Date(body.from) : undefined,
        to: body.to ? new Date(body.to) : undefined,
        groupBy: body.groupBy,
        tmeAlvoSeg: body.tmeAlvoSeg ?? null,
      });
    },
  },
  {
    name: "registrar_consentimento",
    description: "Grava/revoga consentimento LGPD de um contato (dados | marketing | ia).",
    inputSchema: ws(
      {
        contactId: { type: "string" },
        kind: { type: "string", enum: [...KIND_CONSENT] },
        granted: { type: "boolean" },
        source: { type: "string" },
        note: { type: "string" },
      },
      ["contactId", "kind", "granted"],
    ),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => {
      const workspaceId = String(args.workspaceId ?? "");
      const body = z
        .object({
          contactId: z.string().min(1),
          kind: z.enum(KIND_CONSENT),
          granted: z.boolean(),
          source: z.string().max(60).optional(),
          note: z.string().max(200).nullish(),
        })
        .parse(args);
      try {
        return await store.setConsent({ workspaceId, ...body, source: body.source ?? "mcp" });
      } catch (error) {
        if ((error as Error).message === "contato_invalido") {
          throw new Error("Contato não existe neste workspace.");
        }
        throw error;
      }
    },
  },
  {
    name: "exportar_contato",
    description: "Portabilidade LGPD (art. 18, V): devolve todos os dados pessoais de um contato.",
    inputSchema: ws({ contactId: { type: "string" } }, ["contactId"]),
    scopes: ["mcp", "api:leitura"],
    handler: async (args, store) =>
      exportContact(store, String(args.workspaceId), String(args.contactId)),
  },
  {
    name: "excluir_contato",
    description:
      "Elimina os dados pessoais de um contato (anonimiza o cadastro). Irreversível: o servidor registra a trilha LGPD.",
    inputSchema: ws({ contactId: { type: "string" }, motivo: { type: "string" } }, [
      "contactId",
      "motivo",
    ]),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => {
      const workspaceId = String(args.workspaceId ?? "");
      const body = z
        .object({
          contactId: z.string().min(1),
          motivo: z.string().min(3).max(200),
        })
        .parse(args);
      try {
        const summary = await store.purgeContactData(workspaceId, body.contactId);
        await store.addLgpdRequest({
          workspaceId,
          contactId: body.contactId,
          scope: "contato",
          action: "exclusao",
          summary: { ...summary, motivo: body.motivo },
        });
        return summary;
      } catch (error) {
        if ((error as Error).message === "contato_invalido") {
          throw new Error("Contato não existe neste workspace.");
        }
        throw error;
      }
    },
  },
];

/**
 * Catálogo completo de tools MCP do CRM: automação (filas/regras/fluxos) +
 * integrações, relatórios e LGPD. `POST /mcp` filtra por escopo da chave.
 */
export const CRM_TOOLS = [...AUTOMATION_TOOLS, ...INTEGRATION_TOOLS];
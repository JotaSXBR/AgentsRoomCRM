import { z } from "zod";
import type { Store } from "../stores/store.js";
import { resolveQueueId } from "./helpers.js";
import { str, strArray, wsSchema as ws } from "./schema.js";
import type { McpToolDefinition } from "./protocol.js";

const flowStepSchema = z.object({
  action: z.enum(["responder", "menu", "enfileirar", "encerrar"]),
  payload: z.record(z.unknown()).default({}),
});

const queueNameProp = str("Nome da fila de destino (criada se ainda não existir).");

/** Traduz `queueName` (nome) em `queueId` (id interno) dentro do payload. */
async function queuePayload(
  store: Store,
  workspaceId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = typeof payload.queueName === "string" ? payload.queueName : null;
  return { ...payload, queueId: await resolveQueueId(store, workspaceId, name) };
}

/** Monta uma regra do bot a partir dos argumentos do agente (criar_regra_bot). */
async function createBotRuleFromArgs(store: Store, args: Record<string, unknown>): Promise<unknown> {
  const workspaceId = String(args.workspaceId ?? "");
  const body = z
    .object({
      name: z.string().min(1).max(120),
      kind: z.enum(["palavra_chave", "menu", "triagem"]),
      terms: z.array(z.string().min(1)).optional(),
      reply: z.string().nullish(),
      priority: z.number().int().optional(),
      queueName: z.string().nullish(),
      options: z
        .array(
          z.object({
            label: z.string().min(1),
            reply: z.string().min(1),
            queueName: z.string().nullish(),
          }),
        )
        .optional(),
    })
    .parse(args);
  const options = await Promise.all(
    (body.options ?? []).map(async (option, index) => ({
      // `key` é o que o contato digita para escolher a opção (menu da F3).
      key: String(index + 1),
      label: option.label,
      reply: option.reply,
      queueId: await resolveQueueId(store, workspaceId, option.queueName ?? null),
    })),
  );
  return store.createBotRule({
    workspaceId,
    name: body.name,
    kind: body.kind,
    priority: body.priority ?? 100,
    terms: body.terms ?? [],
    reply: body.reply ?? null,
    options,
    queueId: await resolveQueueId(store, workspaceId, body.queueName ?? null),
  });
}

/**
 * Automação: filas, regras do bot e fluxos (F5).
 *
 * É este conjunto que dá a um agente de IA externo a peça que faltava — criar
 * o fluxo inteiro do atendimento sem ninguém abrir a UI.
 */
export const AUTOMATION_TOOLS: McpToolDefinition[] = [
  {
    name: "criar_fila",
    description: "Cria uma fila de atendimento no workspace (destino padrão do fluxo).",
    inputSchema: ws(
      {
        name: str("Nome da fila, único no workspace."),
        channel: str("Canal esperado (whatsapp, email, ...)."),
        isDefault: { type: "boolean", description: "Torna a fila padrão do workspace." },
      },
      ["name"],
    ),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => {
      const workspaceId = String(args.workspaceId ?? "");
      const body = z
        .object({
          name: z.string().min(1).max(80),
          channel: z.string().max(40).nullish(),
          isDefault: z.boolean().optional(),
        })
        .parse(args);
      try {
        // `await` é obrigatório: sem ele a rejeição escapa do try/catch e o
        // agente receberia o código cru do store em vez da mensagem.
        return await store.createQueue({ workspaceId, ...body });
      } catch (error) {
        if ((error as Error).message === "fila_nome_em_uso") {
          throw new Error("Já existe uma fila com esse nome no workspace.");
        }
        throw error;
      }
    },
  },
  {
    name: "listar_filas",
    description: "Lista as filas do workspace com id, nome, canal e se é a padrão.",
    inputSchema: ws({}, []),
    scopes: ["mcp", "api:leitura"],
    handler: async (args, store) => ({ data: await store.listQueues(String(args.workspaceId)) }),
  },
  {
    name: "criar_regra_bot",
    description:
      "Cria regra do bot: palavra_chave (por termos), menu (opções) ou triagem (encaminha para fila).",
    inputSchema: ws(
      {
        name: { type: "string" },
        kind: { type: "string", enum: ["palavra_chave", "menu", "triagem"] },
        terms: strArray("Termos que casam com a mensagem."),
        reply: { type: "string" },
        priority: { type: "number" },
        queueName: queueNameProp,
        options: {
          type: "array",
          description: "Só para kind=menu.",
          items: {
            type: "object",
            properties: { label: { type: "string" }, reply: { type: "string" }, queueName: { type: "string" } },
            required: ["label", "reply"],
          },
        },
      },
      ["name", "kind"],
    ),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => createBotRuleFromArgs(store, args),
  },
  {
    name: "criar_fluxo",
    description:
      "Cria um fluxo (gatilho por termos + passos ordenados: responder, menu, enfileirar, encerrar).",
    inputSchema: ws(
      {
        name: { type: "string" },
        terms: strArray("Termos que disparam o fluxo."),
        steps: {
          type: "array",
          description: "Passos executados em ordem no intake.",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["responder", "menu", "enfileirar", "encerrar"] },
              payload: { type: "object", description: "Dados do passo (text, queueName, options)." },
            },
            required: ["action"],
          },
        },
      },
      ["name", "steps"],
    ),
    scopes: ["mcp", "api:escrita"],
    handler: async (args, store) => {
      const workspaceId = String(args.workspaceId ?? "");
      const body = z
        .object({
          name: z.string().min(1).max(120),
          terms: z.array(z.string().min(1)).default([]),
          active: z.boolean().optional(),
          steps: z.array(flowStepSchema).min(1),
        })
        .parse(args);
      const steps = [];
      for (const step of body.steps) {
        steps.push({
          action: step.action,
          payload:
            step.action === "enfileirar"
              ? await queuePayload(store, workspaceId, step.payload)
              : step.payload,
        });
      }
      return store.createFlow({
        workspaceId,
        name: body.name,
        terms: body.terms,
        active: body.active,
        steps,
      });
    },
  },
  {
    name: "listar_fluxos",
    description: "Lista os fluxos do workspace com seus passos.",
    inputSchema: ws({}, []),
    scopes: ["mcp", "api:leitura"],
    handler: async (args, store) => ({ data: await store.listFlows(String(args.workspaceId)) }),
  },
];
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { encryptSecret } from "../lib/secrets.js";
import { requireWorkspace } from "../plugins/tenant.js";
import { chunkText } from "../ai/chunking.js";

function assertSupervisor(role: string): void {
  if (role !== "owner_global" && role !== "admin_ws" && role !== "supervisor") {
    throw HttpError.forbidden();
  }
}

const putSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    systemPrompt: z.string().min(1).max(4000).optional(),
    fallbackMessage: z.string().min(1).max(2000).optional(),
    maxChunks: z.number().int().min(1).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para atualizar." });

const putProviderSchema = z.object({
  kind: z.enum(["openai_compatible", "ollama"]),
  baseUrl: z.string().url().max(500),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(500).nullish(),
  priceInputPerMtok: z.number().min(0).nullish(),
  priceOutputPerMtok: z.number().min(0).nullish(),
});

const createSourceSchema = z
  .object({
    kind: z.enum(["faq", "documento", "url"]),
    title: z.string().min(1).max(200),
    content: z.string().max(200_000).nullish(),
    url: z.string().url().max(2000).nullish(),
  })
  .refine((v) => v.kind === "url" || (v.content && v.content.trim() !== ""), {
    message: "faq/documento exigem content.",
  })
  .refine((v) => v.kind !== "url" || v.url, { message: "url exige o campo url." });

const patchSourceSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().max(200_000).nullish(),
    url: z.string().url().max(2000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para atualizar." });

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function aiRoutes(
  app: FastifyInstance,
  store: Store,
  options: { secretsKey: string },
): Promise<void> {
  // ---- settings ----
  app.get("/workspaces/:workspaceId/ai/settings", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    await requireWorkspace(store, request, workspaceId);
    return (
      (await store.getAiSettings(workspaceId)) ?? {
        workspaceId,
        enabled: false,
        systemPrompt: "Você é um assistente de atendimento. Responda apenas com base no contexto fornecido e cite as fontes.",
        fallbackMessage: "Vou transferir você para um atendente humano.",
        maxChunks: 3,
        updatedAt: null,
      }
    );
  });

  app.put("/workspaces/:workspaceId/ai/settings", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const body = putSettingsSchema.parse(await request.body);
    return store.upsertAiSettings({ workspaceId, ...body });
  });

  // ---- provider ----
  app.get("/workspaces/:workspaceId/ai/provider", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    await requireWorkspace(store, request, workspaceId);
    const provider = await store.getAiProvider(workspaceId);
    if (!provider) return null;
    return {
      workspaceId: provider.workspaceId,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      model: provider.model,
      hasApiKey: provider.apiKeyEnc !== null,
      priceInputPerMtok: provider.priceInputPerMtok,
      priceOutputPerMtok: provider.priceOutputPerMtok,
      updatedAt: provider.updatedAt,
    };
  });

  app.put("/workspaces/:workspaceId/ai/provider", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const body = putProviderSchema.parse(await request.body);
    const apiKeyEnc =
      body.apiKey && body.apiKey.trim() !== "" ? encryptSecret(body.apiKey, options.secretsKey) : undefined;
    const provider = await store.upsertAiProvider({
      workspaceId,
      kind: body.kind,
      baseUrl: body.baseUrl,
      model: body.model,
      apiKeyEnc,
      priceInputPerMtok: body.priceInputPerMtok,
      priceOutputPerMtok: body.priceOutputPerMtok,
    });
    return {
      workspaceId: provider.workspaceId,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      model: provider.model,
      hasApiKey: provider.apiKeyEnc !== null,
      priceInputPerMtok: provider.priceInputPerMtok,
      priceOutputPerMtok: provider.priceOutputPerMtok,
      updatedAt: provider.updatedAt,
    };
  });

  app.delete("/workspaces/:workspaceId/ai/provider", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const ok = await store.deleteAiProvider(workspaceId);
    if (!ok) throw HttpError.notFound("Provider não configurado.");
    return reply.code(204).send();
  });

  // ---- knowledge sources ----
  app.get("/workspaces/:workspaceId/ai/sources", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    await requireWorkspace(store, request, workspaceId);
    return { data: await store.listKnowledgeSources(workspaceId) };
  });

  app.post("/workspaces/:workspaceId/ai/sources", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const body = createSourceSchema.parse(await request.body);
    const source = await store.createKnowledgeSource({ workspaceId, ...body });
    if (source.content && source.content.trim() !== "") {
      await store.replaceKnowledgeChunks(workspaceId, source.id, chunkText(source.content));
    }
    return reply.code(201).send(source);
  });

  app.patch("/workspaces/:workspaceId/ai/sources/:sourceId", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const body = patchSourceSchema.parse(await request.body);
    const source = await store.updateKnowledgeSource(workspaceId, sourceId, body);
    if (!source) throw HttpError.notFound("Fonte não encontrada.");
    if (body.content !== undefined) {
      await store.replaceKnowledgeChunks(workspaceId, source.id, chunkText(body.content ?? ""));
    }
    return source;
  });

  app.delete("/workspaces/:workspaceId/ai/sources/:sourceId", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const ok = await store.deleteKnowledgeSource(workspaceId, sourceId);
    if (!ok) throw HttpError.notFound("Fonte não encontrada.");
    return reply.code(204).send();
  });

  app.post("/workspaces/:workspaceId/ai/sources/:sourceId/sync", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId, sourceId } = request.params as { workspaceId: string; sourceId: string };
    assertSupervisor(await requireWorkspace(store, request, workspaceId));
    const source = await store.findKnowledgeSource(workspaceId, sourceId);
    if (!source) throw HttpError.notFound("Fonte não encontrada.");
    if (source.kind !== "url" || !source.url) {
      throw HttpError.badRequest("fonte_sem_url", "Sync só aplica a fontes do tipo url.");
    }
    try {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = stripHtml(await response.text());
      const updated = await store.updateKnowledgeSource(workspaceId, sourceId, {
        content: text,
        status: text ? "pronto" : "vazio",
        error: null,
      });
      await store.replaceKnowledgeChunks(workspaceId, sourceId, chunkText(text));
      return updated;
    } catch (error) {
      return store.updateKnowledgeSource(workspaceId, sourceId, {
        status: "erro",
        error: (error as Error).message.slice(0, 300),
      });
    }
  });

  // ---- logs ----
  app.get("/workspaces/:workspaceId/ai/logs", { onRequest: [app.authenticate] }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    await requireWorkspace(store, request, workspaceId);
    const { limit } = (request.query ?? {}) as { limit?: string };
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    return {
      data: await store.listAiLogs(
        workspaceId,
        parsedLimit !== undefined && Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 500)
          : undefined,
      ),
    };
  });
}

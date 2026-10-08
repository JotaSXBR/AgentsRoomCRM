import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import { buildQualityReport, QUALITY_GROUPS } from "../reports/quality.js";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  groupBy: z.enum(QUALITY_GROUPS).default("assignee"),
  tmeAlvoSeg: z.coerce.number().int().positive().optional(),
});

const ratingSchema = z.object({
  score: z.number().int().min(1, "Nota de 1 a 5.").max(5, "Nota de 1 a 5."),
  comment: z.string().max(1000).nullish(),
});

/**
 * Relatórios (F5): TME/TMA/CSAT por atendente, fila ou canal, e o registro da
 * nota de atendimento (CSAT). `POST .../rating` aceita tanto o registro
 * interno pelo atendente quanto o envio pelo cliente.
 */
export async function registerReportRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get(
    "/workspaces/:workspaceId/reports/quality",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const query = querySchema.parse(request.query ?? {});
      return buildQualityReport(store, workspaceId, {
        groupBy: query.groupBy,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        tmeAlvoSeg: query.tmeAlvoSeg ?? null,
      });
    },
  );

  app.get(
    "/workspaces/:workspaceId/reports/quality.csv",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      const query = querySchema.parse(request.query ?? {});
      const report = await buildQualityReport(store, workspaceId, {
        groupBy: query.groupBy,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        tmeAlvoSeg: query.tmeAlvoSeg ?? null,
      });
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .send(toCsv(report.data));
    },
  );

  app.get(
    "/workspaces/:workspaceId/inbox/conversations/:id/rating",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const rating = await store.findRating(workspaceId, id);
      if (!rating) throw HttpError.notFound("Conversa ainda não avaliada.");
      return rating;
    },
  );

  app.put(
    "/workspaces/:workspaceId/inbox/conversations/:id/rating",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId, id } = request.params as { workspaceId: string; id: string };
      await requireWorkspace(store, request, workspaceId);
      const body = ratingSchema.parse(await request.body);
      try {
        return await store.rateConversation({
          workspaceId,
          conversationId: id,
          score: body.score,
          comment: body.comment ?? null,
          source: "atendente",
          ratedBy: request.authUser.id,
        });
      } catch (error) {
        if ((error as Error).message === "conversa_invalida") {
          throw HttpError.notFound("Conversa não encontrada.");
        }
        throw error;
      }
    },
  );
}

interface CsvRow {
  key: string;
  tickets: number;
  resolvidos: number;
  resolucaoPct: number | null;
  tmeMedioSeg: number | null;
  tmeMedianaSeg: number | null;
  tmaMedioSeg: number | null;
  tmaMedianaSeg: number | null;
  csatMedio: number | null;
  csatRespostas: number;
  slaTmePct: number | null;
}

const CSV_COLUMNS = [
  "grupo",
  "tickets",
  "resolvidos",
  "resolucao_pct",
  "tme_medio_seg",
  "tme_mediana_seg",
  "tma_medio_seg",
  "tma_mediana_seg",
  "csat_medio",
  "csat_respostas",
  "sla_tme_pct",
] as const;

/** CSV para planilha; campos ausentes ficam vazios, nunca `null`. */
export function toCsv(rows: CsvRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((row) =>
    [
      row.key,
      row.tickets,
      row.resolvidos,
      row.resolucaoPct ?? "",
      row.tmeMedioSeg ?? "",
      row.tmeMedianaSeg ?? "",
      row.tmaMedioSeg ?? "",
      row.tmaMedianaSeg ?? "",
      row.csatMedio ?? "",
      row.csatRespostas,
      row.slaTmePct ?? "",
    ].join(","),
  );
  return [header, ...body].join("\n");
}
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { requireWorkspace } from "../plugins/tenant.js";
import type { CoreConfig } from "../config.js";

const MAX_BYTES = 25 * 1024 * 1024;

const presignSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive().max(MAX_BYTES),
});

/**
 * Presigned PUT para upload de mídia no bucket do workspace (RustFS/S3).
 * Bucket único configurado com prefixo por workspace: `{workspaceId}/{uuid}-{nome}`.
 */
export async function mediaRoutes(
  app: FastifyInstance,
  store: Store,
  config: Pick<CoreConfig, "s3Endpoint" | "s3Region" | "s3AccessKey" | "s3SecretKey" | "s3BucketMidia">,
): Promise<void> {
  app.post(
    "/workspaces/:workspaceId/media/presign",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { workspaceId } = request.params as { workspaceId: string };
      await requireWorkspace(store, request, workspaceId);
      if (!config.s3Endpoint || !config.s3AccessKey || !config.s3SecretKey) {
        throw new HttpError(503, "s3_nao_configurado", "Upload de mídia não configurado.");
      }
      const body = presignSchema.parse(await request.body);
      const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const key = `${workspaceId}/${randomUUID()}-${safeName}`;
      const client = new S3Client({
        endpoint: config.s3Endpoint,
        region: config.s3Region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.s3AccessKey,
          secretAccessKey: config.s3SecretKey,
        },
      });
      const command = new PutObjectCommand({
        Bucket: config.s3BucketMidia,
        Key: key,
        ContentType: body.contentType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 900 });
      return {
        uploadUrl: url,
        key,
        bucket: config.s3BucketMidia,
        maxBytes: MAX_BYTES,
        expiresIn: 900,
      };
    },
  );
}

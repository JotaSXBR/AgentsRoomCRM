import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export interface CoreConfig {
  port: number;
  host: string;
  logLevel: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  databaseUrl: string | null;
  databaseUrlMigrator: string | null;
  redisUrl: string | null;
  storeDriver: "memory" | "postgres";
  ownerEmail: string | null;
  ownerPassword: string | null;
  ownerName: string;
  inviteTtlHours: number;
  // Serviços adjacentes — contrato reservado, consumo em F1 (tudo opcional).
  wahaApiUrl: string | null;
  wahaApiKey: string | null;
  wahaDefaultSession: string;
  wahaWebhookSecret: string | null;
  // F2b — Meta oficial (Graph API v21+) por workspace.
  metaAppId: string | null;
  metaAppSecret: string | null;
  metaVerifyToken: string | null;
  metaRedirectUri: string | null;
  metaApiVersion: string;
  // F2b — fila de saída com backoff + polling IMAP.
  outboundMaxAttempts: number;
  outboundBaseDelayMs: number;
  outboundMaxDelayMs: number;
  outboundTickMs: number;
  mailSyncIntervalMs: number;
  s3Endpoint: string | null;
  s3Region: string;
  s3AccessKey: string | null;
  s3SecretKey: string | null;
  s3BucketMidia: string;
  s3BucketBackups: string;
  ollamaUrl: string | null;
}

function serverSection(env: NodeJS.ProcessEnv): Pick<CoreConfig, "port" | "host" | "logLevel"> {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    logLevel: env.LOG_LEVEL ?? "info",
  };
}

function authSection(env: NodeJS.ProcessEnv): Pick<CoreConfig, "jwtSecret" | "jwtExpiresIn" | "ownerEmail" | "ownerPassword" | "ownerName" | "inviteTtlHours"> {
  return {
    jwtSecret: env.JWT_SECRET ?? "dev-secret-trocar",
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? "12h",
    ownerEmail: env.OWNER_EMAIL ?? null,
    ownerPassword: env.OWNER_PASSWORD ?? null,
    ownerName: env.OWNER_NAME ?? "Dono",
    inviteTtlHours: Number(env.INVITE_TTL_HOURS ?? 72),
  };
}

function storeSection(env: NodeJS.ProcessEnv, databaseUrl: string | null): Pick<CoreConfig, "databaseUrl" | "databaseUrlMigrator" | "redisUrl" | "storeDriver"> {
  return {
    databaseUrl,
    databaseUrlMigrator: env.DATABASE_URL_MIGRATOR ?? databaseUrl,
    redisUrl: env.REDIS_URL ?? null,
    storeDriver: env.STORE_DRIVER === "postgres" ? "postgres" : "memory",
  };
}

function wahaSection(env: NodeJS.ProcessEnv): Pick<CoreConfig, "wahaApiUrl" | "wahaApiKey" | "wahaDefaultSession" | "wahaWebhookSecret"> {
  return {
    wahaApiUrl: env.WAHA_API_URL ?? null,
    wahaApiKey: env.WAHA_API_KEY ?? null,
    wahaDefaultSession: env.WAHA_DEFAULT_SESSION ?? "padrao",
    wahaWebhookSecret: env.WAHA_WEBHOOK_SECRET ?? null,
  };
}

function metaSection(
  env: NodeJS.ProcessEnv,
): Pick<
  CoreConfig,
  | "metaAppId"
  | "metaAppSecret"
  | "metaVerifyToken"
  | "metaRedirectUri"
  | "metaApiVersion"
  | "outboundMaxAttempts"
  | "outboundBaseDelayMs"
  | "outboundMaxDelayMs"
  | "outboundTickMs"
  | "mailSyncIntervalMs"
> {
  return {
    metaAppId: env.META_APP_ID ?? null,
    metaAppSecret: env.META_APP_SECRET ?? null,
    metaVerifyToken: env.META_VERIFY_TOKEN ?? null,
    metaRedirectUri: env.META_REDIRECT_URI ?? null,
    metaApiVersion: env.META_API_VERSION ?? "v21.0",
    outboundMaxAttempts: Number(env.OUTBOUND_MAX_ATTEMPTS ?? 8),
    outboundBaseDelayMs: Number(env.OUTBOUND_BASE_DELAY_MS ?? 30_000),
    outboundMaxDelayMs: Number(env.OUTBOUND_MAX_DELAY_MS ?? 3_600_000),
    outboundTickMs: Number(env.OUTBOUND_TICK_MS ?? 0),
    mailSyncIntervalMs: Number(env.MAIL_SYNC_INTERVAL_MS ?? 0),
  };
}

function s3Section(env: NodeJS.ProcessEnv): Pick<CoreConfig, "s3Endpoint" | "s3Region" | "s3AccessKey" | "s3SecretKey" | "s3BucketMidia" | "s3BucketBackups" | "ollamaUrl"> {
  return {
    s3Endpoint: env.S3_ENDPOINT ?? null,
    s3Region: env.S3_REGION ?? "us-east-1",
    s3AccessKey: env.S3_ACCESS_KEY ?? null,
    s3SecretKey: env.S3_SECRET_KEY ?? null,
    s3BucketMidia: env.S3_BUCKET_MIDIA ?? "crm-midia",
    s3BucketBackups: env.S3_BUCKET_BACKUPS ?? "crm-backups",
    ollamaUrl: env.OLLAMA_URL ?? null,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const databaseUrl = env.DATABASE_URL ?? null;
  return {
    ...serverSection(env),
    ...authSection(env),
    ...storeSection(env, databaseUrl),
    ...wahaSection(env),
    ...metaSection(env),
    ...s3Section(env),
  };
}

export function assertProdSecrets(config: CoreConfig): void {
  if (process.env.NODE_ENV === "production") {
    required("JWT_SECRET");
    if (config.jwtSecret.includes("trocar")) {
      throw new Error("JWT_SECRET com valor placeholder em produção.");
    }
  }
}

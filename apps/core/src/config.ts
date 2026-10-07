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
  s3Endpoint: string | null;
  s3Region: string;
  s3AccessKey: string | null;
  s3SecretKey: string | null;
  s3BucketMidia: string;
  s3BucketBackups: string;
  ollamaUrl: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const databaseUrl = env.DATABASE_URL ?? null;
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    logLevel: env.LOG_LEVEL ?? "info",
    jwtSecret: env.JWT_SECRET ?? "dev-secret-trocar",
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? "12h",
    databaseUrl,
    databaseUrlMigrator: env.DATABASE_URL_MIGRATOR ?? databaseUrl,
    redisUrl: env.REDIS_URL ?? null,
    storeDriver: env.STORE_DRIVER === "postgres" ? "postgres" : "memory",
    ownerEmail: env.OWNER_EMAIL ?? null,
    ownerPassword: env.OWNER_PASSWORD ?? null,
    ownerName: env.OWNER_NAME ?? "Dono",
    inviteTtlHours: Number(env.INVITE_TTL_HOURS ?? 72),
    wahaApiUrl: env.WAHA_API_URL ?? null,
    wahaApiKey: env.WAHA_API_KEY ?? null,
    wahaDefaultSession: env.WAHA_DEFAULT_SESSION ?? "padrao",
    s3Endpoint: env.S3_ENDPOINT ?? null,
    s3Region: env.S3_REGION ?? "us-east-1",
    s3AccessKey: env.S3_ACCESS_KEY ?? null,
    s3SecretKey: env.S3_SECRET_KEY ?? null,
    s3BucketMidia: env.S3_BUCKET_MIDIA ?? "crm-midia",
    s3BucketBackups: env.S3_BUCKET_BACKUPS ?? "crm-backups",
    ollamaUrl: env.OLLAMA_URL ?? null,
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

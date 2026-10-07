import { Pool } from "pg";
import Redis from "ioredis";

let pool: Pool | null = null;
let redis: Redis | null = null;

export function getPool(databaseUrl: string): Pool {
  pool ??= new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export function getRedis(redisUrl: string): Redis {
  redis ??= new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  return redis;
}

export async function closeInfra(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

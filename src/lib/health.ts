import { prisma } from './prisma.js';
import { getRedisClient, isRedisConfigured } from './redis.js';
import { logger } from './logger.js';

export type DependencyHealthStatus = 'healthy' | 'unhealthy' | 'unavailable';

export interface DependencyHealth {
  status: DependencyHealthStatus;
  latencyMs: number | null;
  error?: string;
}

export interface HealthResponse {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  ready: boolean;
  timestamp: string;
  checks: {
    database: DependencyHealth;
    redis: DependencyHealth;
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export async function checkDatabaseHealth(timeoutMs = 1500): Promise<DependencyHealth> {
  const startedAt = Date.now();

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, timeoutMs, 'Database health check timed out');

    return {
      status: 'healthy',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed');

    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Database health check failed',
    };
  }
}

export async function checkRedisHealth(timeoutMs = 1000): Promise<DependencyHealth> {
  if (!isRedisConfigured()) {
    return {
      status: 'unavailable',
      latencyMs: null,
      error: 'REDIS_URL is not configured',
    };
  }

  const startedAt = Date.now();

  try {
    const client = await getRedisClient();

    if (!client) {
      throw new Error('Redis client is unavailable');
    }

    await withTimeout(client.ping(), timeoutMs, 'Redis health check timed out');

    return {
      status: 'healthy',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    logger.error({ err: error }, 'Redis health check failed');

    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Redis health check failed',
    };
  }
}

export function buildHealthResponse(
  database: DependencyHealth,
  redis: DependencyHealth
): HealthResponse {
  const ready = database.status === 'healthy';
  const status: HealthResponse['status'] = !ready
    ? 'unhealthy'
    : redis.status === 'healthy'
      ? 'healthy'
      : 'degraded';

  return {
    success: ready,
    status,
    ready,
    timestamp: new Date().toISOString(),
    checks: {
      database,
      redis,
    },
  };
}

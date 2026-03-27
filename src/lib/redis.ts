import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { HttpError } from './auth.js';

export type RedisLike = {
  ping(): Promise<unknown>;
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string, ...args: any[]): Promise<unknown>;
  del?(...keys: string[]): Promise<number>;
  exists?(...keys: string[]): Promise<number>;
  expire?(key: string, seconds: number): Promise<number>;
  zremrangebyscore?(key: string, min: number | string, max: number | string): Promise<number>;
  zcard?(key: string): Promise<number>;
  zadd?(key: string, score: number, member: string): Promise<number>;
  zrange?(key: string, start: number, stop: number, withScores?: string): Promise<string[]>;
};

let redisClient: RedisLike | null = null;
let redisClientPromise: Promise<RedisLike | null> | null = null;

async function createRedisClient(): Promise<RedisLike | null> {
  if (!env.REDIS_URL) {
    logger.info('Redis not configured (REDIS_URL not set)');
    return null;
  }

  const isUpstash = (() => {
    try {
      return new URL(env.REDIS_URL).hostname.endsWith('.upstash.io');
    } catch {
      return false;
    }
  })();

  if (isUpstash) {
    const { Redis } = await import('@upstash/redis');
    logger.info('Redis client initialized (Upstash)');
    return Redis.fromEnv() as unknown as RedisLike;
  }

  const { default: IORedis } = await import('ioredis');
  logger.info('Redis client initialized (ioredis)');
  return new IORedis(env.REDIS_URL) as unknown as RedisLike;
}

export async function getRedisClient(): Promise<RedisLike | null> {
  if (redisClient) {
    return redisClient;
  }

  if (!redisClientPromise) {
    redisClientPromise = createRedisClient().then((client) => {
      redisClient = client;
      return client;
    }).catch((err) => {
      logger.error({ err }, 'Failed to initialize Redis client');
      redisClientPromise = null;
      return null;
    });
  }

  return redisClientPromise;
}

export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

export { redisClient as redis };

async function withRedisClient<T>(fn: (client: RedisLike) => Promise<T>): Promise<T | null> {
  const client = await getRedisClient();

  if (!client) {
    return null;
  }

  return fn(client);
}

export async function redisGet(key: string): Promise<string | null> {
  const result = await withRedisClient(async (client) => {
    const result = await client.get?.(key);
    return typeof result === 'string' ? result : null;
  });

  return result ?? null;
}

export async function redisSetEx(key: string, value: string, seconds: number): Promise<boolean> {
  const result = await withRedisClient(async (client) => {
    if (!client.set) {
      return false;
    }

    try {
      await client.set(key, value, 'EX', seconds);
      return true;
    } catch {
      try {
        await client.set(key, value, { ex: seconds } as any);
        return true;
      } catch {
        return false;
      }
    }
  });

  return result ?? false;
}

export async function redisDel(...keys: string[]): Promise<number> {
  const result = await withRedisClient(async (client) => {
    const result = await client.del?.(...keys);
    return typeof result === 'number' ? result : 0;
  });

  return result ?? 0;
}

export async function redisExists(key: string): Promise<boolean> {
  const result = await withRedisClient(async (client) => {
    const result = await client.exists?.(key);
    return result === 1;
  });

  return result ?? false;
}

export async function redisExpire(key: string, seconds: number): Promise<boolean> {
  const result = await withRedisClient(async (client) => {
    const result = await client.expire?.(key, seconds);
    return result === 1;
  });

  return result ?? false;
}

export async function redisZTrimBeforeScore(key: string, maxScore: number): Promise<number> {
  const result = await withRedisClient(async (client) => {
    const result = await client.zremrangebyscore?.(key, '-inf', maxScore);
    return typeof result === 'number' ? result : 0;
  });

  return result ?? 0;
}

export async function redisZAdd(key: string, score: number, member: string): Promise<boolean> {
  const result = await withRedisClient(async (client) => {
    if (!client.zadd) {
      return false;
    }

    try {
      await client.zadd(key, score, member);
      return true;
    } catch {
      try {
        await (client.zadd as any)(key, { score, member });
        return true;
      } catch {
        return false;
      }
    }
  });

  return result ?? false;
}

export async function redisZCard(key: string): Promise<number> {
  const result = await withRedisClient(async (client) => {
    const result = await client.zcard?.(key);
    return typeof result === 'number' ? result : 0;
  });

  return result ?? 0;
}

export async function addRateLimitHit(key: string, timestampMs: number): Promise<void> {
  await redisZTrimBeforeScore(key, timestampMs);
  const added = await redisZAdd(key, timestampMs, `${timestampMs}:${crypto.randomBytes(4).toString('hex')}`);

  if (!added) {
    throw new HttpError(503, 'Rate limit cache unavailable', 'REDIS_UNAVAILABLE');
  }
}

export async function getRateLimitCount(key: string, minTimestampMs: number): Promise<number> {
  await redisZTrimBeforeScore(key, minTimestampMs);
  return redisZCard(key);
}

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getRedisClient, isRedisConfigured } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { consumeSlidingWindow } from '../lib/runtime-cache.js';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  message?: string;
  identifier?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

type RedisRateLimitClient = NonNullable<Awaited<ReturnType<typeof getRedisClient>>>;

function getRequestIdentifier(req: Request): string {
  const requestWithUser = req as Request & { user?: { id?: string }; userId?: string };
  const authenticatedUserId = requestWithUser.user?.id ?? requestWithUser.userId;

  if (authenticatedUserId) {
    return `user:${authenticatedUserId}`;
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedIp = typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0]?.trim()
    : Array.isArray(forwardedFor)
      ? forwardedFor[0]?.split(',')[0]?.trim()
      : undefined;

  return `ip:${forwardedIp || req.ip || req.socket.remoteAddress || 'unknown'}`;
}

function buildRateLimitKey(req: Request, options: RateLimitOptions): string {
  const prefix = options.keyPrefix ?? 'rate-limit';
  const identifier = options.identifier?.(req) ?? getRequestIdentifier(req);
  return `${prefix}:${identifier}`;
}

async function incrementSlidingWindow(
  client: RedisRateLimitClient,
  key: string,
  windowMs: number,
  maxRequests: number
): Promise<{ allowed: boolean; remaining: number; total: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!client.zremrangebyscore || !client.zcard || !client.zadd || !client.expire) {
    throw new Error('Redis client does not support sorted-set rate limiting commands');
  }

  await client.zremrangebyscore(key, '-inf', windowStart);
  const total = await client.zcard(key);

  if (total >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      total,
    };
  }

  const member = `${now}:${Math.random().toString(36).slice(2)}`;
  await client.zadd(key, now, member);
  await client.expire(key, Math.ceil(windowMs / 1000) + 1);

  return {
    allowed: true,
    remaining: Math.max(maxRequests - total - 1, 0),
    total: total + 1,
  };
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const normalizedOptions: RateLimitOptions = {
    keyPrefix: 'rate-limit',
    ...options,
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    if (normalizedOptions.skip?.(req)) {
      next();
      return;
    }

    try {
      let result: { allowed: boolean; remaining: number; total: number };
      const key = buildRateLimitKey(req, normalizedOptions);

      if (isRedisConfigured()) {
        const client = await getRedisClient();

        if (client) {
          try {
            result = await incrementSlidingWindow(
              client,
              key,
              normalizedOptions.windowMs,
              normalizedOptions.maxRequests
            );
          } catch (error) {
            logger.warn({ err: error, key }, 'Redis rate limiting failed; using in-memory fallback');
            result = consumeSlidingWindow(key, normalizedOptions.windowMs, normalizedOptions.maxRequests);
          }
        } else {
          logger.warn({ key }, 'Redis client unavailable for rate limiting; using in-memory fallback');
          result = consumeSlidingWindow(key, normalizedOptions.windowMs, normalizedOptions.maxRequests);
        }
      } else {
        result = consumeSlidingWindow(key, normalizedOptions.windowMs, normalizedOptions.maxRequests);
      }

      if (!result.allowed) {
        res.setHeader('Retry-After', String(Math.ceil(normalizedOptions.windowMs / 1000)));
        res.setHeader('X-RateLimit-Limit', String(normalizedOptions.maxRequests));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.status(429).json({
          success: false,
          error: normalizedOptions.message ?? 'Too many requests',
        });
        return;
      }

      res.setHeader('X-RateLimit-Limit', String(normalizedOptions.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('Rate limiting failed'));
    }
  };
}

export const createRateLimit = rateLimit;

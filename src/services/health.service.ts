import { prisma } from '../lib/prisma.js';
import { getRedisClient, isRedisConfigured } from '../lib/redis.js';
import { stripe } from '../lib/stripe.js';
import { pingClerk } from '../lib/clerk.js';
import { logger } from '../lib/logger.js';

export type ServiceStatus = 'green' | 'yellow' | 'red';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latencyMs: number;
  message?: string;
}

export interface DetailedHealthResponse {
  success: boolean;
  status: ServiceStatus;
  timestamp: string;
  services: ServiceHealth[];
  uptime: number;
}

const LATENCY_THRESHOLD_MS = 500;

function resolveStatus(connected: boolean, latencyMs: number): ServiceStatus {
  if (!connected) return 'red';
  return latencyMs >= LATENCY_THRESHOLD_MS ? 'yellow' : 'green';
}

function overallStatus(services: ServiceHealth[]): ServiceStatus {
  if (services.some((s) => s.status === 'red')) return 'red';
  if (services.some((s) => s.status === 'yellow')) return 'yellow';
  return 'green';
}

async function checkPostgres(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    const status = resolveStatus(true, latencyMs);
    return {
      name: 'PostgreSQL',
      status,
      latencyMs,
      message: status === 'yellow' ? 'High latency' : 'Connected',
    };
  } catch (err) {
    logger.error({ err }, 'PostgreSQL health check failed');
    return {
      name: 'PostgreSQL',
      status: 'red',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  if (!isRedisConfigured()) {
    return {
      name: 'Redis',
      status: 'yellow',
      latencyMs: 0,
      message: 'Not configured',
    };
  }

  const start = Date.now();
  try {
    const client = await getRedisClient();
    if (!client) {
      return {
        name: 'Redis',
        status: 'red',
        latencyMs: Date.now() - start,
        message: 'Client unavailable',
      };
    }

    await client.ping();
    const latencyMs = Date.now() - start;
    const status = resolveStatus(true, latencyMs);
    return {
      name: 'Redis',
      status,
      latencyMs,
      message: status === 'yellow' ? 'High latency' : 'Connected',
    };
  } catch (err) {
    logger.error({ err }, 'Redis health check failed');
    return {
      name: 'Redis',
      status: 'red',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

async function checkClerk(): Promise<ServiceHealth> {
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (!clerkKey) {
    return {
      name: 'Clerk',
      status: 'red',
      latencyMs: 0,
      message: 'Not configured (CLERK_SECRET_KEY missing)',
    };
  }

  try {
    const result = await pingClerk();

    if (result.status === 401) {
      return { name: 'Clerk', status: 'red', latencyMs: result.latencyMs, message: 'Invalid API key' };
    }

    const status = resolveStatus(true, result.latencyMs);
    return {
      name: 'Clerk',
      status,
      latencyMs: result.latencyMs,
      message: status === 'yellow' ? 'High latency' : 'Connected',
    };
  } catch (err) {
    logger.error({ err }, 'Clerk health check failed');
    return {
      name: 'Clerk',
      status: 'red',
      latencyMs: 0,
      message: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

async function checkStripe(): Promise<ServiceHealth> {
  if (!stripe) {
    return {
      name: 'Stripe',
      status: 'yellow',
      latencyMs: 0,
      message: 'Not configured',
    };
  }

  const start = Date.now();
  try {
    await stripe.balance.retrieve();
    const latencyMs = Date.now() - start;
    const status = resolveStatus(true, latencyMs);
    return {
      name: 'Stripe',
      status,
      latencyMs,
      message: status === 'yellow' ? 'High latency' : 'Connected',
    };
  } catch (err) {
    logger.error({ err }, 'Stripe health check failed');
    return {
      name: 'Stripe',
      status: 'red',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

export async function getDetailedHealth(): Promise<DetailedHealthResponse> {
  const results = await Promise.allSettled([
    checkPostgres(),
    checkRedis(),
    checkClerk(),
    checkStripe(),
  ]);

  const services: ServiceHealth[] = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const names = ['PostgreSQL', 'Redis', 'Clerk', 'Stripe'];
    return {
      name: names[i],
      status: 'red' as ServiceStatus,
      latencyMs: 0,
      message: 'Check failed unexpectedly',
    };
  });

  return {
    success: true,
    status: overallStatus(services),
    timestamp: new Date().toISOString(),
    services,
    uptime: Math.floor(process.uptime()),
  };
}

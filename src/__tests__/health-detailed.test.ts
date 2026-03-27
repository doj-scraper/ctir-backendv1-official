import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../lib/auth.js';

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock factory closures can reference them.
//
// The detailed health endpoint calls getDetailedHealth() in
// services/health.service.ts, which directly uses prisma, redis, and stripe
// clients. We mock those underlying libs, not the lib/health helpers.
// ---------------------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  metricSnapshot: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
  systemEvent: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
}));

const redisMocks = vi.hoisted(() => ({
  isRedisConfigured: vi.fn(() => false),
  getRedisClient: vi.fn(async () => null as any),
}));

const stripeMock = vi.hoisted(() => ({
  stripe: null as any,
}));

const clerkMock = vi.hoisted(() => ({
  pingClerk: vi.fn(async () => ({ ok: true, status: 200, latencyMs: 5 })),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

const authMiddlewareMocks = vi.hoisted(() => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  optionalAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));

vi.mock('../lib/redis.js', () => ({
  isRedisConfigured: redisMocks.isRedisConfigured,
  getRedisClient: redisMocks.getRedisClient,
  redis: null,
}));

vi.mock('../lib/stripe.js', () => stripeMock);

vi.mock('../lib/clerk.js', () => clerkMock);

vi.mock('../lib/logger.js', () => ({ logger: loggerMock }));

vi.mock('../middleware/auth.js', () => authMiddlewareMocks);

vi.mock('../services/event-logger.service.js', () => ({
  logEvent: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logCritical: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GET /api/health/detailed', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-health-detailed';
    delete process.env.CLERK_SECRET_KEY;

    // Default: Prisma resolves instantly, Redis not configured, Stripe null, Clerk not configured
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisMocks.isRedisConfigured.mockReturnValue(false);
    redisMocks.getRedisClient.mockResolvedValue(null);
    stripeMock.stripe = null;
    clerkMock.pingClerk.mockRejectedValue(new Error('CLERK_SECRET_KEY not configured'));

    const { createApp } = await import('../app.js');
    const app = createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  // -------------------------------------------------------------------------
  // 0. Auth gating — unauthenticated requests are rejected
  // -------------------------------------------------------------------------
  it('rejects unauthenticated requests to /detailed', async () => {
    // Override requireAuth to block
    authMiddlewareMocks.requireAuth.mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => {
        next(new HttpError(401, 'Authentication required', 'AUTH_REQUIRED'));
      }
    );

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    expect(res.status).toBe(401);

    // Reset to passthrough for remaining tests
    authMiddlewareMocks.requireAuth.mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next()
    );
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — all services connected → overall "green"
  // -------------------------------------------------------------------------
  it('returns status "green" when all services are healthy', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisMocks.isRedisConfigured.mockReturnValue(true);
    redisMocks.getRedisClient.mockResolvedValue({ ping: vi.fn().mockResolvedValue('PONG') });
    stripeMock.stripe = { balance: { retrieve: vi.fn().mockResolvedValue({ available: [] }) } };
    process.env.CLERK_SECRET_KEY = 'sk_test_fake';
    clerkMock.pingClerk.mockResolvedValue({ ok: true, status: 200, latencyMs: 10 });

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('green');
    expect(Array.isArray(body.services)).toBe(true);

    const pgService = body.services.find((s: any) => s.name === 'PostgreSQL');
    expect(pgService).toBeDefined();
    expect(pgService.status).toBe('green');

    const redisService = body.services.find((s: any) => s.name === 'Redis');
    expect(redisService).toBeDefined();
    expect(redisService.status).toBe('green');
  });

  // -------------------------------------------------------------------------
  // 2. Partial degradation — DB connected, Redis not configured → "yellow"
  // -------------------------------------------------------------------------
  it('returns overall "yellow" when database is healthy but Redis is not configured', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisMocks.isRedisConfigured.mockReturnValue(false);
    stripeMock.stripe = null;
    // Clerk must be healthy to avoid its "red" pulling overall to "red"
    process.env.CLERK_SECRET_KEY = 'sk_test_fake';
    clerkMock.pingClerk.mockResolvedValue({ ok: true, status: 200, latencyMs: 5 });

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('yellow');

    const redisService = body.services.find((s: any) => s.name === 'Redis');
    expect(redisService).toBeDefined();
    expect(redisService.status).toBe('yellow');
    expect(redisService.message).toBe('Not configured');
  });

  // -------------------------------------------------------------------------
  // 3. Database down — Prisma query fails → overall "red"
  // -------------------------------------------------------------------------
  it('returns overall "red" when the database query fails', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    redisMocks.isRedisConfigured.mockReturnValue(false);
    stripeMock.stripe = null;

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('red');

    const pgService = body.services.find((s: any) => s.name === 'PostgreSQL');
    expect(pgService).toBeDefined();
    expect(pgService.status).toBe('red');
    expect(pgService.message).toContain('ECONNREFUSED');
  });

  // -------------------------------------------------------------------------
  // 4. High latency warning — service responds but > 500ms → "yellow"
  //
  // We simulate latency by delaying the mock's resolution so the real
  // Date.now() delta inside the service exceeds the 500ms threshold.
  // -------------------------------------------------------------------------
  it('marks a service "yellow" when its latency exceeds 500ms', async () => {
    prismaMock.$queryRaw.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ '?column?': 1 }]), 550))
    );
    redisMocks.isRedisConfigured.mockReturnValue(false);
    stripeMock.stripe = null;

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    const pgService = body.services.find((s: any) => s.name === 'PostgreSQL');
    expect(pgService).toBeDefined();
    expect(pgService.status).toBe('yellow');
    expect(pgService.latencyMs).toBeGreaterThanOrEqual(500);
    expect(pgService.message).toBe('High latency');
  });

  // -------------------------------------------------------------------------
  // 5. Response shape — verify top-level fields
  // -------------------------------------------------------------------------
  it('returns the expected response shape with all required top-level fields', async () => {
    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('services');
    expect(body).toHaveProperty('uptime');

    expect(typeof body.success).toBe('boolean');
    expect(['green', 'yellow', 'red']).toContain(body.status);
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(Array.isArray(body.services)).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 6. Service entry shape — each item has name, status, latencyMs, message
  // -------------------------------------------------------------------------
  it('each service entry contains name, status, latencyMs, and message', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_fake';
    clerkMock.pingClerk.mockResolvedValue({ ok: true, status: 200, latencyMs: 5 });
    redisMocks.isRedisConfigured.mockReturnValue(true);
    redisMocks.getRedisClient.mockResolvedValue({ ping: vi.fn().mockResolvedValue('PONG') });
    stripeMock.stripe = { balance: { retrieve: vi.fn().mockResolvedValue({ available: [] }) } };

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    // 4 services: PostgreSQL, Redis, Clerk, Stripe
    expect(body.services.length).toBe(4);

    for (const service of body.services) {
      expect(service).toHaveProperty('name');
      expect(service).toHaveProperty('status');
      expect(service).toHaveProperty('latencyMs');
      expect(service).toHaveProperty('message');

      expect(typeof service.name).toBe('string');
      expect(['green', 'yellow', 'red']).toContain(service.status);
      expect(typeof service.message).toBe('string');
      expect(typeof service.latencyMs).toBe('number');
    }
  });

  // -------------------------------------------------------------------------
  // 7. Both database and Redis down — everything red
  // -------------------------------------------------------------------------
  it('returns "red" when multiple critical services are down', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('Database health check timed out'));
    redisMocks.isRedisConfigured.mockReturnValue(true);
    redisMocks.getRedisClient.mockResolvedValue({ ping: vi.fn().mockRejectedValue(new Error('Redis timed out')) });
    stripeMock.stripe = null;

    const res = await fetch(`${baseUrl}/api/health/detailed`);
    const body: any = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('red');

    const pgService = body.services.find((s: any) => s.name === 'PostgreSQL');
    expect(pgService!.status).toBe('red');

    const redisService = body.services.find((s: any) => s.name === 'Redis');
    expect(redisService!.status).toBe('red');
  });
});

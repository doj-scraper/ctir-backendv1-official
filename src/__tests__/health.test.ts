import { beforeAll, describe, expect, test } from 'vitest';

describe('health helpers', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-health-routes';
  });

  test('marks the API ready when the database is healthy even if Redis is not configured yet', async () => {
    const { buildHealthResponse } = await import('../lib/health.js');

    const response = buildHealthResponse(
      { status: 'healthy', latencyMs: 42 },
      { status: 'unavailable', latencyMs: null, error: 'REDIS_URL is not configured' }
    );

    expect(response.success).toBe(true);
    expect(response.ready).toBe(true);
    expect(response.status).toBe('degraded');
    expect(response.checks.redis.status).toBe('unavailable');
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });

  test('marks the API unhealthy when the database check fails', async () => {
    const { buildHealthResponse } = await import('../lib/health.js');

    const response = buildHealthResponse(
      { status: 'unhealthy', latencyMs: 150, error: 'connect ECONNREFUSED' },
      { status: 'healthy', latencyMs: 5 }
    );

    expect(response.success).toBe(false);
    expect(response.ready).toBe(false);
    expect(response.status).toBe('unhealthy');
    expect(response.checks.database.error).toBe('connect ECONNREFUSED');
  });
});

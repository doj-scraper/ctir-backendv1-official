import { Router } from 'express';
import { buildHealthResponse, checkDatabaseHealth, checkRedisHealth } from '../lib/health.js';
import { getDetailedHealth } from '../services/health.service.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Basic liveness probe — open (for load balancers / uptime monitors)
router.get('/', async (_req, res) => {
  try {
    const [database, redis] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);

    const payload = buildHealthResponse(database, redis);
    res.status(payload.ready ? 200 : 503).json(payload);
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      ready: false,
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'unhealthy', latencyMs: null, error: 'Health check failed' },
        redis: { status: 'unavailable', latencyMs: null, error: 'Health check failed' },
      },
    });
  }
});

// Detailed health — ADMIN only
router.get('/detailed', requireAuth, requireRole('ADMIN'), async (_req, res) => {
  try {
    const health = await getDetailedHealth();
    const httpStatus = health.status === 'red' ? 503 : 200;
    res.status(httpStatus).json(health);
  } catch (err) {
    logger.error({ err }, 'Detailed health check failed');
    res.status(503).json({
      success: false,
      status: 'red',
      timestamp: new Date().toISOString(),
      services: [],
      uptime: Math.floor(process.uptime()),
    });
  }
});

export default router;

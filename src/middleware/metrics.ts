import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { Request, Response, NextFunction } from 'express';

export function requestMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const path = req.route?.path || req.path;
    const method = req.method;
    const statusCode = res.statusCode;

    // Skip health check endpoints to avoid noise
    if (path.startsWith('/api/health') || path.startsWith('/health')) return;

    // Fire-and-forget: store as API metric snapshot
    prisma.metricSnapshot.create({
      data: {
        name: 'API',
        value: duration,
        unit: 'ms',
        metadata: JSON.stringify({ method, path, statusCode }),
      }
    }).catch((err: unknown) => {
      logger.error({ err }, 'Failed to record request metric');
    });
  });

  next();
}
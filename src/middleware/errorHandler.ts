import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { logEvent } from '../services/event-logger.service.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error({
    err,
    method: req.method,
    url: req.url,
    body: req.body,
  }, 'Request error');

  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if ('statusCode' in err && typeof (err as { statusCode?: unknown }).statusCode === 'number') {
    const statusCode = (err as { statusCode: number }).statusCode;
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: 'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : undefined,
    });
    return;
  }

  // Prisma errors
  const prismaError = err as Error & { code?: string; meta?: { target?: unknown } };
  if (typeof prismaError.code === 'string') {
    if (prismaError.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: 'Resource already exists',
        field: prismaError.meta?.target,
      });
      return;
    }

    if (prismaError.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'Resource not found',
      });
      return;
    }

    res.status(400).json({
      success: false,
      error: 'Database operation failed',
    });
    return;
  }

  // Stripe errors
  if (err.name === 'StripeError' || err.constructor.name.includes('Stripe')) {
    res.status(402).json({
      success: false,
      error: 'Payment processing error',
      message: env.NODE_ENV === 'development' ? err.message : undefined,
    });
    return;
  }

  // JWT errors
  if (
    err.name === 'JsonWebTokenError'
    || err.name === 'TokenExpiredError'
    || err.name === 'NotBeforeError'
  ) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    const errorMessage = err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token';

    res.status(401).json({
      success: false,
      error: errorMessage,
      code,
    });
    return;
  }

  // Fire-and-forget: log all 500-level errors
  logEvent('SYSTEM', 'ERROR', 'errorHandler', err.message, { method: req.method, url: req.url });

  // Generic error fallback
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { EventCategory, EventSeverity } from '@prisma/client';

// Fire-and-forget: logs event to DB without blocking the caller
export function logEvent(
  category: EventCategory,
  severity: EventSeverity,
  source: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  prisma.systemEvent.create({
    data: { 
      category, 
      severity, 
      message, 
      metadata: metadata ? JSON.stringify(metadata) : null 
    }
  }).catch((err) => {
    logger.error({ err, category, severity, source }, 'Failed to log system event');
  });
}

export const logInfo = (source: string, message: string, metadata?: Record<string, unknown>) =>
  logEvent('SYSTEM', 'INFO', source, message, metadata);

export const logWarn = (source: string, message: string, metadata?: Record<string, unknown>) =>
  logEvent('SYSTEM', 'WARN', source, message, metadata);

export const logError = (source: string, message: string, metadata?: Record<string, unknown>) =>
  logEvent('SYSTEM', 'ERROR', source, message, metadata);

export const logCritical = (source: string, message: string, metadata?: Record<string, unknown>) =>
  logEvent('SYSTEM', 'CRITICAL', source, message, metadata);

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getDetailedHealth } from './health.service.js';
import type { MetricSnapshot } from '@prisma/client';

export interface RequestMetricsResult {
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  statusBreakdown: Record<string, number>;
}

export interface CleanupResult {
  deletedEvents: number;
  deletedMetrics: number;
}

export class MetricsService {
  /**
   * Take a health snapshot and store each service result as a MetricSnapshot.
   */
  async recordHealthSnapshot(): Promise<void> {
    try {
      const health = await getDetailedHealth();

      const records = health.services.map((svc) => ({
        name: svc.name,
        value: svc.latencyMs,
        unit: 'ms',
        metadata: svc.message ? JSON.stringify({ message: svc.message, status: svc.status }) : null,
      }));

      await prisma.metricSnapshot.createMany({ data: records });

      logger.info(
        { count: records.length },
        'Recorded health snapshot metrics',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to record health snapshot');
      throw err;
    }
  }

  /**
   * Get time-series data for a specific service.
   */
  async getMetricsTimeline(
    serviceName: string,
    hours: number,
  ): Promise<MetricSnapshot[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return prisma.metricSnapshot.findMany({
      where: {
        name: serviceName,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get aggregated request metrics for the API service.
   */
  async getRequestMetrics(hours: number): Promise<RequestMetricsResult> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshots = await prisma.metricSnapshot.findMany({
      where: {
        name: 'API',
        createdAt: { gte: since },
      },
      orderBy: { value: 'asc' },
    });

    const totalRequests = snapshots.length;

    if (totalRequests === 0) {
      return {
        totalRequests: 0,
        errorCount: 0,
        errorRate: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        statusBreakdown: {},
      };
    }

    // Extract status from metadata JSON
    const errorCount = snapshots.filter((s) => {
      const meta = s.metadata ? JSON.parse(s.metadata) : {};
      return meta.status === 'red';
    }).length;
    const errorRate = (errorCount / totalRequests) * 100;

    const totalLatency = snapshots.reduce((sum, s) => sum + s.value, 0);
    const avgLatencyMs = Math.round(totalLatency / totalRequests);

    // p95: pick the value at the 95th percentile index (already sorted by value)
    const p95Index = Math.min(
      Math.ceil(totalRequests * 0.95) - 1,
      totalRequests - 1,
    );
    const p95LatencyMs = snapshots[p95Index].value;

    // Group by statusCode from metadata
    const statusBreakdown: Record<string, number> = {};
    for (const snap of snapshots) {
      const meta = snap.metadata ? JSON.parse(snap.metadata) : {};
      const code = meta.statusCode != null ? String(meta.statusCode) : 'unknown';
      statusBreakdown[code] = (statusBreakdown[code] ?? 0) + 1;
    }

    return {
      totalRequests,
      errorCount,
      errorRate: Math.round(errorRate * 100) / 100,
      avgLatencyMs,
      p95LatencyMs,
      statusBreakdown,
    };
  }

  /**
   * Delete events and metrics older than retentionDays.
   */
  async cleanupOldData(retentionDays: number = 7): Promise<CleanupResult> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [deletedEvents, deletedMetrics] = await Promise.all([
      prisma.systemEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      prisma.metricSnapshot.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
    ]);

    logger.info(
      {
        retentionDays,
        deletedEvents: deletedEvents.count,
        deletedMetrics: deletedMetrics.count,
      },
      'Cleaned up old monitoring data',
    );

    return {
      deletedEvents: deletedEvents.count,
      deletedMetrics: deletedMetrics.count,
    };
  }
}
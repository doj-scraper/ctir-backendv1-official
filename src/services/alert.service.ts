import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type {
  AlertRule,
  AlertNotification,
  MetricSnapshot,
  AlertStatus,
} from '@prisma/client';

export interface EvaluateResult {
  evaluated: number;
  fired: number;
}

export interface CreateRuleInput {
  name: string;
  description?: string;
  metric: string;
  operator: string;
  threshold: number;
  windowMinutes?: number;
  cooldownMinutes?: number;
}

export type UpdateRuleInput = Partial<{
  name: string;
  description: string;
  enabled: boolean;
  metric: string;
  operator: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
}>;

export class AlertService {
  /**
   * Evaluate all enabled AlertRules against recent MetricSnapshots.
   * Uses a transaction per fired alert to atomically create the notification
   * and update the rule's lastFiredAt timestamp.
   */
  async evaluateAlerts(): Promise<EvaluateResult> {
    const rules = await prisma.alertRule.findMany({
      where: { enabled: true },
    });

    let evaluated = 0;
    let fired = 0;
    const now = new Date();

    for (const rule of rules) {
      // Skip if within cooldown period
      if (rule.lastFiredAt) {
        const cooldownEnd = new Date(
          rule.lastFiredAt.getTime() + rule.cooldownMinutes * 60 * 1000,
        );
        if (now < cooldownEnd) {
          logger.debug({ ruleId: rule.id, name: rule.name }, 'Rule in cooldown, skipping');
          continue;
        }
      }

      evaluated++;

      const windowStart = new Date(
        now.getTime() - rule.windowMinutes * 60 * 1000,
      );

      const snapshots = await prisma.metricSnapshot.findMany({
        where: { recordedAt: { gte: windowStart } },
        orderBy: { latencyMs: 'asc' },
      });

      if (snapshots.length === 0) {
        logger.debug({ ruleId: rule.id }, 'No snapshots in window, skipping');
        continue;
      }

      const metricValue = this.calculateMetric(rule.metric, snapshots);
      const triggered = this.compare(metricValue, rule.operator, rule.threshold);

      if (triggered) {
        const message =
          `Alert "${rule.name}": ${rule.metric} = ${metricValue} ` +
          `${rule.operator} ${rule.threshold}`;

        await prisma.$transaction([
          prisma.alertNotification.create({
            data: {
              ruleId: rule.id,
              status: 'ACTIVE',
              message,
              metadata: {
                metric: rule.metric,
                value: metricValue,
                operator: rule.operator,
                threshold: rule.threshold,
                windowMinutes: rule.windowMinutes,
              },
              firedAt: now,
            },
          }),
          prisma.alertRule.update({
            where: { id: rule.id },
            data: { lastFiredAt: now },
          }),
        ]);

        fired++;
        logger.info(
          { ruleId: rule.id, name: rule.name, metricValue, threshold: rule.threshold },
          'Alert rule fired',
        );
      }
    }

    logger.info({ evaluated, fired }, 'Alert evaluation complete');
    return { evaluated, fired };
  }

  // ── CRUD for AlertRules ──────────────────────────────────────────────

  async createRule(data: CreateRuleInput): Promise<AlertRule> {
    const rule = await prisma.alertRule.create({ data });
    logger.info({ ruleId: rule.id, name: rule.name }, 'Alert rule created');
    return rule;
  }

  async updateRule(id: string, data: UpdateRuleInput): Promise<AlertRule> {
    const rule = await prisma.alertRule.update({ where: { id }, data });
    logger.info({ ruleId: rule.id }, 'Alert rule updated');
    return rule;
  }

  async deleteRule(id: string): Promise<void> {
    await prisma.alertRule.delete({ where: { id } });
    logger.info({ ruleId: id }, 'Alert rule deleted');
  }

  async getRules(): Promise<(AlertRule & { _count: { notifications: number } })[]> {
    return prisma.alertRule.findMany({
      include: {
        _count: {
          select: {
            notifications: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Alert notification management ────────────────────────────────────

  async getAlerts(status?: AlertStatus): Promise<AlertNotification[]> {
    return prisma.alertNotification.findMany({
      where: status ? { status } : undefined,
      include: { rule: true },
      orderBy: { firedAt: 'desc' },
    });
  }

  async getActiveAlerts(): Promise<AlertNotification[]> {
    return this.getAlerts('ACTIVE');
  }

  async acknowledgeAlert(id: string): Promise<AlertNotification> {
    const alert = await prisma.alertNotification.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
      },
      include: { rule: true },
    });
    logger.info({ alertId: id }, 'Alert acknowledged');
    return alert;
  }

  async resolveAlert(id: string): Promise<AlertNotification> {
    const alert = await prisma.alertNotification.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
      include: { rule: true },
    });
    logger.info({ alertId: id }, 'Alert resolved');
    return alert;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private compare(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'ne':
        return value !== threshold;
      default:
        logger.warn({ operator }, 'Unknown operator');
        return false;
    }
  }

  private calculateMetric(
    metric: string,
    snapshots: MetricSnapshot[],
  ): number {
    switch (metric) {
      case 'error_rate': {
        const apiSnapshots = snapshots.filter((s) => s.serviceName === 'API');
        if (apiSnapshots.length === 0) return 0;
        const redCount = apiSnapshots.filter((s) => s.status === 'red').length;
        return (redCount / apiSnapshots.length) * 100;
      }

      case 'latency_p95': {
        const apiSnapshots = snapshots
          .filter((s) => s.serviceName === 'API')
          .sort((a, b) => a.latencyMs - b.latencyMs);
        if (apiSnapshots.length === 0) return 0;
        const p95Index = Math.min(
          Math.ceil(apiSnapshots.length * 0.95) - 1,
          apiSnapshots.length - 1,
        );
        return apiSnapshots[p95Index].latencyMs;
      }

      case 'service_status': {
        return snapshots.filter((s) => s.status === 'red').length;
      }

      case 'avg_latency': {
        if (snapshots.length === 0) return 0;
        const total = snapshots.reduce((sum, s) => sum + s.latencyMs, 0);
        return Math.round(total / snapshots.length);
      }

      default:
        logger.warn({ metric }, 'Unknown metric type');
        return 0;
    }
  }
}

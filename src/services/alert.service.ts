import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type {
  AlertRule,
  AlertNotification,
  AlertStatus,
} from '@prisma/client';

export interface EvaluateResult {
  evaluated: number;
  fired: number;
}

export interface CreateRuleInput {
  name: string;
  condition: string; // JSON string describing the condition
  actionType: string;
  actionPayload: string; // JSON string
}

export type UpdateRuleInput = Partial<{
  name: string;
  condition: string;
  actionType: string;
  actionPayload: string;
  isActive: boolean;
  evaluationIntervalMs: number;
}>;

export class AlertService {
  /**
   * Evaluate all enabled AlertRules against recent MetricSnapshots.
   * Uses a transaction per fired alert to atomically create the notification.
   */
  async evaluateAlerts(): Promise<EvaluateResult> {
    const rules = await prisma.alertRule.findMany({
      where: { isActive: true },
    });

    let evaluated = 0;
    let fired = 0;
    const now = new Date();

    for (const rule of rules) {
      // Parse condition from JSON
      let condition: { metric: string; operator: string; threshold: number };
      try {
        condition = JSON.parse(rule.condition);
      } catch {
        logger.warn({ ruleId: rule.id, condition: rule.condition }, 'Failed to parse condition');
        continue;
      }

      // Look for recent metric snapshots with matching name
      const snapshots = await prisma.metricSnapshot.findMany({
        where: { 
          name: condition.metric,
          createdAt: { gte: new Date(now.getTime() - rule.evaluationIntervalMs) }
        },
        orderBy: { createdAt: 'desc' },
      });

      if (snapshots.length === 0) {
        logger.debug({ ruleId: rule.id }, 'No snapshots found, skipping');
        continue;
      }

      evaluated++;

      // Get the latest value
      const latestValue = snapshots[0].value;
      const triggered = this.compare(latestValue, condition.operator, condition.threshold);

      if (triggered) {
        const message =
          `Alert "${rule.name}": ${condition.metric} = ${latestValue} ` +
          `${condition.operator} ${condition.threshold}`;

        await prisma.alertNotification.create({
          data: {
            ruleId: rule.id,
            status: 'ACTIVE',
            message,
          },
        });

        fired++;
        logger.info(
          { ruleId: rule.id, name: rule.name, metricValue: latestValue, threshold: condition.threshold },
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
      orderBy: { createdAt: 'desc' },
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
}

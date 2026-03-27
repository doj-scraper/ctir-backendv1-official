import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { MetricsService } from '../services/metrics.service.js';
import { AlertService } from '../services/alert.service.js';
import type { EventCategory, EventSeverity, AlertStatus, Prisma } from '@prisma/client';

const router = Router();
const metricsService = new MetricsService();
const alertService = new AlertService();

// Valid enum values for runtime validation
const EVENT_CATEGORIES: EventCategory[] = ['SYSTEM', 'COMMERCE', 'AUTH', 'PERFORMANCE', 'INVENTORY'];
const EVENT_SEVERITIES: EventSeverity[] = ['INFO', 'WARN', 'ERROR', 'CRITICAL'];
const ALERT_STATUSES: AlertStatus[] = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'SILENCED'];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * GET /events — paginated, filterable list of SystemEvents
 */
router.get('/events', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const where: Prisma.SystemEventWhereInput = {};

    if (req.query.category) {
      const cat = String(req.query.category).toUpperCase() as EventCategory;
      if (!EVENT_CATEGORIES.includes(cat)) {
        res.status(400).json({ success: false, error: `Invalid category. Must be one of: ${EVENT_CATEGORIES.join(', ')}` });
        return;
      }
      where.category = cat;
    }

    if (req.query.severity) {
      const sev = String(req.query.severity).toUpperCase() as EventSeverity;
      if (!EVENT_SEVERITIES.includes(sev)) {
        res.status(400).json({ success: false, error: `Invalid severity. Must be one of: ${EVENT_SEVERITIES.join(', ')}` });
        return;
      }
      where.severity = sev;
    }

    if (req.query.source) {
      where.source = String(req.query.source);
    }

    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.createdAt.lte = new Date(String(req.query.to));
    }

    const [events, total] = await Promise.all([
      prisma.systemEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.systemEvent.count({ where }),
    ]);

    res.json({
      success: true,
      events,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list events');
    res.status(500).json({ success: false, error: 'Failed to list events' });
  }
});

/**
 * GET /events/stats — counts grouped by category and severity
 */
router.get('/events/stats', async (req: Request, res: Response) => {
  try {
    const hours = Math.max(1, Number(req.query.hours) || 24);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [byCategory, bySeverity, total] = await Promise.all([
      prisma.systemEvent.groupBy({
        by: ['category'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.systemEvent.groupBy({
        by: ['severity'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      prisma.systemEvent.count({ where: { createdAt: { gte: since } } }),
    ]);

    const categoryMap: Record<string, number> = {};
    for (const row of byCategory) categoryMap[row.category] = row._count;

    const severityMap: Record<string, number> = {};
    for (const row of bySeverity) severityMap[row.severity] = row._count;

    res.json({
      success: true,
      stats: { byCategory: categoryMap, bySeverity: severityMap, total },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get event stats');
    res.status(500).json({ success: false, error: 'Failed to get event stats' });
  }
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * GET /metrics/timeline — time-series for a service
 */
router.get('/metrics/timeline', async (req: Request, res: Response) => {
  try {
    const serviceName = String(req.query.serviceName ?? '');
    if (!serviceName) {
      res.status(400).json({ success: false, error: 'serviceName query parameter is required' });
      return;
    }
    const hours = Math.max(1, Number(req.query.hours) || 24);

    const timeline = await metricsService.getMetricsTimeline(serviceName, hours);
    res.json({ success: true, serviceName, timeline });
  } catch (err) {
    logger.error({ err }, 'Failed to get metrics timeline');
    res.status(500).json({ success: false, error: 'Failed to get metrics timeline' });
  }
});

/**
 * GET /metrics/request-stats — aggregated request metrics
 */
router.get('/metrics/request-stats', async (req: Request, res: Response) => {
  try {
    const hours = Math.max(1, Number(req.query.hours) || 24);
    const metrics = await metricsService.getRequestMetrics(hours);
    res.json({ success: true, metrics });
  } catch (err) {
    logger.error({ err }, 'Failed to get request metrics');
    res.status(500).json({ success: false, error: 'Failed to get request metrics' });
  }
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * GET /alerts — list alert notifications with optional status filter
 */
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    let status: AlertStatus | undefined;
    if (req.query.status) {
      const s = String(req.query.status).toUpperCase() as AlertStatus;
      if (!ALERT_STATUSES.includes(s)) {
        res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${ALERT_STATUSES.join(', ')}` });
        return;
      }
      status = s;
    }
    const alerts = await alertService.getAlerts(status);
    res.json({ success: true, alerts });
  } catch (err) {
    logger.error({ err }, 'Failed to list alerts');
    res.status(500).json({ success: false, error: 'Failed to list alerts' });
  }
});

/**
 * GET /alerts/rules — list all alert rules
 */
router.get('/alerts/rules', async (_req: Request, res: Response) => {
  try {
    const rules = await alertService.getRules();
    res.json({ success: true, rules });
  } catch (err) {
    logger.error({ err }, 'Failed to list alert rules');
    res.status(500).json({ success: false, error: 'Failed to list alert rules' });
  }
});

/**
 * POST /alerts/rules — create a new alert rule
 */
router.post('/alerts/rules', async (req: Request, res: Response) => {
  try {
    const { name, description, metric, operator, threshold, windowMinutes, cooldownMinutes } = req.body;

    if (!name || !metric || !operator || threshold == null) {
      res.status(400).json({ success: false, error: 'name, metric, operator, and threshold are required' });
      return;
    }

    const rule = await alertService.createRule({
      name,
      description,
      metric,
      operator,
      threshold: Number(threshold),
      windowMinutes: windowMinutes != null ? Number(windowMinutes) : undefined,
      cooldownMinutes: cooldownMinutes != null ? Number(cooldownMinutes) : undefined,
    });

    res.status(201).json({ success: true, rule });
  } catch (err) {
    logger.error({ err }, 'Failed to create alert rule');
    res.status(500).json({ success: false, error: 'Failed to create alert rule' });
  }
});

/**
 * PATCH /alerts/rules/:id — update or toggle a rule
 */
router.patch('/alerts/rules/:id', async (req: Request, res: Response) => {
  try {
    const rule = await alertService.updateRule(req.params.id, req.body);
    res.json({ success: true, rule });
  } catch (err) {
    logger.error({ err, ruleId: req.params.id }, 'Failed to update alert rule');
    res.status(500).json({ success: false, error: 'Failed to update alert rule' });
  }
});

/**
 * DELETE /alerts/rules/:id — delete a rule
 */
router.delete('/alerts/rules/:id', async (req: Request, res: Response) => {
  try {
    await alertService.deleteRule(req.params.id);
    res.json({ success: true, message: 'Rule deleted' });
  } catch (err) {
    logger.error({ err, ruleId: req.params.id }, 'Failed to delete alert rule');
    res.status(500).json({ success: false, error: 'Failed to delete alert rule' });
  }
});

/**
 * POST /alerts/:id/acknowledge — acknowledge an alert
 */
router.post('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const alert = await alertService.acknowledgeAlert(req.params.id);
    res.json({ success: true, alert });
  } catch (err) {
    logger.error({ err, alertId: req.params.id }, 'Failed to acknowledge alert');
    res.status(500).json({ success: false, error: 'Failed to acknowledge alert' });
  }
});

/**
 * POST /alerts/:id/resolve — resolve an alert
 */
router.post('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const alert = await alertService.resolveAlert(req.params.id);
    res.json({ success: true, alert });
  } catch (err) {
    logger.error({ err, alertId: req.params.id }, 'Failed to resolve alert');
    res.status(500).json({ success: false, error: 'Failed to resolve alert' });
  }
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * POST /cleanup — trigger retention cleanup
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const retentionDays = Math.max(1, Number(req.query.retentionDays) || 7);
    const result = await metricsService.cleanupOldData(retentionDays);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, 'Failed to run cleanup');
    res.status(500).json({ success: false, error: 'Failed to run cleanup' });
  }
});

/**
 * POST /snapshot — trigger immediate health snapshot
 */
router.post('/snapshot', async (_req: Request, res: Response) => {
  try {
    await metricsService.recordHealthSnapshot();
    res.json({ success: true, message: 'Health snapshot recorded' });
  } catch (err) {
    logger.error({ err }, 'Failed to record health snapshot');
    res.status(500).json({ success: false, error: 'Failed to record health snapshot' });
  }
});

export default router;

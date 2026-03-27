import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orderServiceMocks = vi.hoisted(() => ({
  listUserOrders: vi.fn(),
  getOrderDetail: vi.fn(),
}));

function attachAuthenticatedRequest(req: Request): void {
  const authorization = req.header('authorization')?.trim();

  if (!authorization) {
    const error = new Error('Authentication required') as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 401;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  req.user = {
    id: 'user-123',
    clerkId: 'user-123',
    email: 'buyer@example.com',
    role: 'BUYER',
  };
}

const authMiddlewareMocks = vi.hoisted(() => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireAuth: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    try {
      attachAuthenticatedRequest(req);
      next();
    } catch (error) {
      next(error);
    }
  }),
  requireTokenAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
  optionalAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
  requireRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

vi.mock('../services/order.service.js', () => ({
  OrderService: vi.fn().mockImplementation(() => orderServiceMocks),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: authMiddlewareMocks.authMiddleware,
  requireAuth: authMiddlewareMocks.requireAuth,
  requireTokenAuth: authMiddlewareMocks.requireTokenAuth,
  optionalAuth: authMiddlewareMocks.optionalAuth,
  requireRole: authMiddlewareMocks.requireRole,
}));

describe('orders routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-order-routes';

    const { createApp } = await import('../app.js');
    const app = createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const authHeaders = {
    Authorization: 'Bearer test-token',
  };

  it('serves the mounted /api/orders endpoint with pagination metadata', async () => {
    const orders = [
      {
        orderId: 'order_2',
        status: 'PAID',
        totalCents: 4897,
        itemCount: 3,
        createdAt: '2026-03-25T12:00:00.000Z',
        updatedAt: '2026-03-25T12:05:00.000Z',
      },
    ];
    const meta = {
      page: 2,
      limit: 1,
      total: 3,
      totalPages: 3,
    };

    orderServiceMocks.listUserOrders.mockResolvedValue({
      items: orders,
      meta,
    });

    const response = await fetch(`${baseUrl}/api/orders?page=2&limit=1&status=PAID`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: orders,
      meta,
    });
    expect(orderServiceMocks.listUserOrders).toHaveBeenCalledWith('user-123', {
      page: 2,
      limit: 1,
      status: 'PAID',
    });
  });

  it('supports the order history alias with the same pagination response contract', async () => {
    const orders = [
      {
        orderId: 'order_2',
        status: 'PAID',
        totalCents: 4897,
        itemCount: 3,
        createdAt: '2026-03-25T12:00:00.000Z',
        updatedAt: '2026-03-25T12:05:00.000Z',
      },
    ];
    const meta = {
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    };

    orderServiceMocks.listUserOrders.mockResolvedValue({
      items: orders,
      meta,
    });

    const response = await fetch(`${baseUrl}/api/orders/history`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: orders,
      meta,
    });
    expect(orderServiceMocks.listUserOrders).toHaveBeenCalledWith('user-123', {
      page: 1,
      limit: 20,
    });
  });

  it('requires authentication for order history access', async () => {
    const response = await fetch(`${baseUrl}/api/orders`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    expect(orderServiceMocks.listUserOrders).not.toHaveBeenCalled();
  });

  it('validates query params before calling the order history service', async () => {
    const response = await fetch(`${baseUrl}/api/orders?page=0&status=INVALID`, {
      headers: authHeaders,
    });

    const data = (await response.json()) as {
      success: boolean;
      error: string;
      details: Array<{ path: string; message: string }>;
    };

    expect(response.status).toBe(400);
    expect(data).toMatchObject({
      success: false,
      error: 'Validation failed',
    });
    expect(data.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringMatching(/^(page|status)$/),
        }),
      ])
    );
    expect(orderServiceMocks.listUserOrders).not.toHaveBeenCalled();
  });

  it('serves order detail through the mounted route and trims the order id param', async () => {
    const order = {
      orderId: 'order_1',
      status: 'PAID',
      totalCents: 4897,
      itemCount: 3,
      paymentIntentId: 'pi_1',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:05:00.000Z',
      lines: [
        {
          skuId: 'BAT-IP15',
          partName: 'Battery',
          category: 'Battery',
          qualityGrade: 'OEM',
          primaryModel: 'iPhone 15',
          quantity: 2,
          unitPriceCents: 1299,
          lineTotalCents: 2598,
        },
      ],
    };

    orderServiceMocks.getOrderDetail.mockResolvedValue(order);

    const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(' order_1 ')}`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: order,
    });
    expect(orderServiceMocks.getOrderDetail).toHaveBeenCalledWith('user-123', 'order_1');
  });

  it('supports the tracking alias for order detail lookups', async () => {
    const order = {
      orderId: 'order_1',
      status: 'PAID',
      totalCents: 4897,
      itemCount: 3,
      paymentIntentId: 'pi_1',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:05:00.000Z',
      lines: [],
    };

    orderServiceMocks.getOrderDetail.mockResolvedValue(order);

    const response = await fetch(`${baseUrl}/api/orders/${encodeURIComponent(' order_1 ')}/tracking`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: order,
    });
    expect(orderServiceMocks.getOrderDetail).toHaveBeenCalledWith('user-123', 'order_1');
  });

  it('surfaces ownership errors from the order detail service', async () => {
    const error = new Error('You do not have access to this order') as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 403;
    error.code = 'ORDER_ACCESS_DENIED';

    orderServiceMocks.getOrderDetail.mockRejectedValue(error);

    const response = await fetch(`${baseUrl}/api/orders/order_2`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'You do not have access to this order',
      code: 'ORDER_ACCESS_DENIED',
    });
  });
});

import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cartServiceMocks = vi.hoisted(() => ({
  getCart: vi.fn(),
  addOrUpdateItem: vi.fn(),
  syncCart: vi.fn(),
  validateCart: vi.fn(),
  updateItemQuantity: vi.fn(),
  removeItem: vi.fn(),
  clearCart: vi.fn(),
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

vi.mock('../services/cart.service.js', () => ({
  CartService: vi.fn().mockImplementation(() => cartServiceMocks),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: authMiddlewareMocks.authMiddleware,
  requireAuth: authMiddlewareMocks.requireAuth,
  requireTokenAuth: authMiddlewareMocks.requireTokenAuth,
  optionalAuth: authMiddlewareMocks.optionalAuth,
  requireRole: authMiddlewareMocks.requireRole,
}));

describe('cart routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-cart-routes';

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
    'Content-Type': 'application/json',
  };

  it('serves the mounted /api/cart endpoint with the cart summary response shape', async () => {
    const cart = {
      items: [{
        skuId: 'BAT-IP15',
        partName: 'Battery',
        category: 'Battery',
        qualityGrade: 'OEM',
        primaryModel: 'iPhone 15',
        quantity: 2,
        addedAt: '2026-03-24T00:00:00.000Z',
        unitPriceCents: 2999,
        lineTotalCents: 5998,
        stockAvailable: 18,
        available: true,
      }],
      subtotalCents: 5998,
      totalCents: 5998,
      itemCount: 2,
    };

    cartServiceMocks.getCart.mockResolvedValue(cart);

    const response = await fetch(`${baseUrl}/api/cart`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      ...cart,
    });
    expect(cartServiceMocks.getCart).toHaveBeenCalledWith('user-123');
  });

  it('requires authentication for cart access before calling the service', async () => {
    const response = await fetch(`${baseUrl}/api/cart`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    expect(cartServiceMocks.getCart).not.toHaveBeenCalled();
  });

  it('validates and forwards add-item requests with the authenticated user scope', async () => {
    const cart = {
      items: [{
        skuId: 'BAT-IP15',
        partName: 'Battery',
        category: 'Battery',
        qualityGrade: 'OEM',
        primaryModel: 'iPhone 15',
        quantity: 2,
        addedAt: '2026-03-24T00:00:00.000Z',
        unitPriceCents: 2999,
        lineTotalCents: 5998,
        stockAvailable: 18,
        available: true,
      }],
      subtotalCents: 5998,
      totalCents: 5998,
      itemCount: 2,
    };

    cartServiceMocks.addOrUpdateItem.mockResolvedValue(cart);

    const response = await fetch(`${baseUrl}/api/cart`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        skuId: ' BAT-IP15 ',
        quantity: '2',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      ...cart,
    });
    expect(cartServiceMocks.addOrUpdateItem).toHaveBeenCalledWith('user-123', {
      skuId: 'BAT-IP15',
      quantity: 2,
    });
  });

  it('rejects non-positive quantities before reaching the cart service', async () => {
    const response = await fetch(`${baseUrl}/api/cart`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        skuId: 'BAT-IP15',
        quantity: 0,
      }),
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
          path: 'quantity',
          message: 'quantity must be a positive integer',
        }),
      ])
    );
    expect(cartServiceMocks.addOrUpdateItem).not.toHaveBeenCalled();
  });

  it('syncs client cart payloads into the server cart with the standard summary response shape', async () => {
    const cart = {
      items: [{
        skuId: 'BAT-IP15',
        partName: 'Battery',
        category: 'Battery',
        qualityGrade: 'OEM',
        primaryModel: 'iPhone 15',
        quantity: 5,
        addedAt: '2026-03-24T00:00:00.000Z',
        unitPriceCents: 2999,
        lineTotalCents: 14995,
        stockAvailable: 18,
        available: true,
      }],
      subtotalCents: 14995,
      totalCents: 14995,
      itemCount: 5,
    };

    cartServiceMocks.syncCart.mockResolvedValue(cart);

    const response = await fetch(`${baseUrl}/api/cart/sync`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        items: [
          { skuId: ' BAT-IP15 ', quantity: '5' },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      ...cart,
    });
    expect(cartServiceMocks.syncCart).toHaveBeenCalledWith('user-123', [
      { skuId: 'BAT-IP15', quantity: 5 },
    ]);
  });

  it('validates carts through the dedicated endpoint without mutating the shared response contract', async () => {
    const validation = {
      items: [{
        skuId: 'BAT-IP15',
        partName: 'Battery',
        category: 'Battery',
        qualityGrade: 'OEM',
        primaryModel: 'iPhone 15',
        quantity: 5,
        addedAt: '2026-03-24T00:00:00.000Z',
        unitPriceCents: 2999,
        lineTotalCents: 14995,
        stockAvailable: 18,
        available: true,
      }],
      subtotalCents: 14995,
      totalCents: 14995,
      itemCount: 5,
      valid: true,
      issues: [],
    };

    cartServiceMocks.validateCart.mockResolvedValue(validation);

    const response = await fetch(`${baseUrl}/api/cart/validate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        items: [
          { skuId: 'BAT-IP15', quantity: 5 },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: validation,
    });
    expect(cartServiceMocks.validateCart).toHaveBeenCalledWith('user-123', [
      { skuId: 'BAT-IP15', quantity: 5 },
    ]);
  });

  it('validates skuId params and quantity bodies before updating cart items', async () => {
    const response = await fetch(`${baseUrl}/api/cart/items/${encodeURIComponent('   ')}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        quantity: 'not-a-number',
      }),
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
        expect.objectContaining({ path: 'skuId' }),
      ])
    );
    expect(cartServiceMocks.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('uses skuId item routes for removals and preserves the shared cart response shape', async () => {
    const cart = {
      items: [],
      subtotalCents: 0,
      totalCents: 0,
      itemCount: 0,
    };

    cartServiceMocks.removeItem.mockResolvedValue(cart);

    const response = await fetch(`${baseUrl}/api/cart/${encodeURIComponent(' BAT-IP15 ')}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      ...cart,
    });
    expect(cartServiceMocks.removeItem).toHaveBeenCalledWith('user-123', 'BAT-IP15');
  });
});

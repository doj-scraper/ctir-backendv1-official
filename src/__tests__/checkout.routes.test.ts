import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkoutServiceMocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

const stripeMocks = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
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

vi.mock('../services/checkout.service.js', () => ({
  CheckoutService: vi.fn().mockImplementation(() => checkoutServiceMocks),
}));

vi.mock('../lib/stripe.js', () => ({
  verifyWebhookSignature: stripeMocks.verifyWebhookSignature,
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: authMiddlewareMocks.authMiddleware,
  requireAuth: authMiddlewareMocks.requireAuth,
  requireTokenAuth: authMiddlewareMocks.requireTokenAuth,
  optionalAuth: authMiddlewareMocks.optionalAuth,
  requireRole: authMiddlewareMocks.requireRole,
}));

describe('checkout routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-checkout-routes';

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

  it('serves the mounted /api/checkout endpoint with the checkout response shape', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const checkout = {
      orderId: 'order_1',
      status: 'PENDING',
      totalCents: 4897,
      currency: 'usd',
      paymentIntentId: 'pi_1',
      clientSecret: 'secret_1',
      items: [
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
      createdAt,
    };

    checkoutServiceMocks.createCheckout.mockResolvedValue(checkout);

    const response = await fetch(`${baseUrl}/api/checkout`, {
      method: 'POST',
      headers: authHeaders,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        ...checkout,
        createdAt: createdAt.toISOString(),
      },
    });
    expect(checkoutServiceMocks.createCheckout).toHaveBeenCalledWith('user-123');
  });

  it('requires authentication for checkout creation before calling the service', async () => {
    const response = await fetch(`${baseUrl}/api/checkout`, {
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    expect(checkoutServiceMocks.createCheckout).not.toHaveBeenCalled();
  });

  it('rejects unexpected checkout request bodies before reaching the service', async () => {
    const response = await fetch(`${baseUrl}/api/checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        couponCode: 'SAVE10',
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
          message: expect.stringContaining('Unrecognized key(s) in object'),
        }),
      ])
    );
    expect(checkoutServiceMocks.createCheckout).not.toHaveBeenCalled();
  });

  it('supports the /api/checkout/create-intent alias with the same service wiring', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const checkout = {
      orderId: 'order_2',
      status: 'PENDING',
      totalCents: 2598,
      currency: 'usd',
      paymentIntentId: 'pi_2',
      clientSecret: 'secret_2',
      items: [],
      createdAt,
    };

    checkoutServiceMocks.createCheckout.mockResolvedValue(checkout);

    const response = await fetch(`${baseUrl}/api/checkout/create-intent`, {
      method: 'POST',
      headers: authHeaders,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        ...checkout,
        createdAt: createdAt.toISOString(),
      },
    });
    expect(checkoutServiceMocks.createCheckout).toHaveBeenCalledWith('user-123');
  });

  it('accepts webhook requests without auth and verifies the raw body before handing off to the service', async () => {
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
    });
    const event = {
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
        },
      },
    };
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:05:00.000Z');
    const orderState = {
      orderId: 'order_1',
      status: 'PAID',
      totalCents: 4897,
      paymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    };

    stripeMocks.verifyWebhookSignature.mockResolvedValue(event);
    checkoutServiceMocks.handleWebhookEvent.mockResolvedValue(orderState);

    const response = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 't=123,v1=abc',
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        ...orderState,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
    });
    expect(stripeMocks.verifyWebhookSignature).toHaveBeenCalledTimes(1);
    const [payload, signature] = stripeMocks.verifyWebhookSignature.mock.calls[0] as [unknown, string];
    expect(Buffer.isBuffer(payload)).toBe(true);
    expect((payload as Buffer).toString()).toBe(body);
    expect(signature).toBe('t=123,v1=abc');
    expect(checkoutServiceMocks.handleWebhookEvent).toHaveBeenCalledWith(event);
  });

  it('rejects malformed Stripe signature headers before verification', async () => {
    const response = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'not-a-valid-signature',
      },
      body: JSON.stringify({ id: 'evt_1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Invalid Stripe signature',
      code: 'INVALID_STRIPE_SIGNATURE',
    });
    expect(stripeMocks.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(checkoutServiceMocks.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('maps Stripe signature verification failures to an explicit invalid-signature response', async () => {
    stripeMocks.verifyWebhookSignature.mockRejectedValue(
      new Error('No signatures found matching the expected signature for payload')
    );

    const response = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 't=123,v1=bad',
      },
      body: JSON.stringify({ id: 'evt_1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Invalid Stripe signature',
      code: 'INVALID_STRIPE_SIGNATURE',
    });
    expect(stripeMocks.verifyWebhookSignature).toHaveBeenCalledTimes(1);
    expect(checkoutServiceMocks.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects webhook requests that do not include a Stripe signature header', async () => {
    const response = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'evt_1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Stripe signature header required',
      code: 'MISSING_STRIPE_SIGNATURE',
    });
    expect(stripeMocks.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(checkoutServiceMocks.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects webhook requests that bypass the raw JSON parser', async () => {
    const response = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'stripe-signature': 't=123,v1=abc',
      },
      body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Stripe webhook requires a raw request body',
      code: 'INVALID_WEBHOOK_PAYLOAD',
    });
    expect(stripeMocks.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(checkoutServiceMocks.handleWebhookEvent).not.toHaveBeenCalled();
  });
});

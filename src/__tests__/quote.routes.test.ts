import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const quoteServiceMocks = vi.hoisted(() => ({
  createQuoteRequest: vi.fn(),
  getQuoteRequest: vi.fn(),
}));

vi.mock('../services/quote.service.js', () => ({
  QuoteService: vi.fn().mockImplementation(() => quoteServiceMocks),
}));

const authMiddlewareMocks = vi.hoisted(() => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  optionalAuth: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    const authorization = req.header('authorization')?.trim();

    if (authorization) {
      req.user = {
        id: 'user-123',
        clerkId: 'user-123',
        email: 'buyer@example.com',
        role: 'BUYER',
      };
    }

    next();
  }),
  requireAuth: vi.fn((req: Request, _res: Response, next: NextFunction) => next()),
  requireTokenAuth: vi.fn((req: Request, _res: Response, next: NextFunction) => next()),
  requireRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../middleware/auth.js', () => authMiddlewareMocks);

describe('quote routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-quote-routes';

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

  it('accepts quote submissions with validated payloads', async () => {
    const quoteRequest = {
      quoteRequestId: 'quote_123',
      status: 'RECEIVED',
      email: 'buyer@example.com',
      company: 'CellTech Repair',
      contactName: 'Yen',
      phone: '555-0101',
      notes: 'Need mixed batteries and screens',
      items: [
        { skuId: 'BAT-IP15', quantity: 25 },
      ],
      submittedAt: '2026-03-26T12:00:00.000Z',
    };
    quoteServiceMocks.createQuoteRequest.mockResolvedValue(quoteRequest);

    const response = await fetch(`${baseUrl}/api/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'buyer@example.com',
        company: 'CellTech Repair',
        contactName: 'Yen',
        phone: '555-0101',
        notes: 'Need mixed batteries and screens',
        items: [
          { skuId: ' BAT-IP15 ', quantity: '25' },
        ],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: quoteRequest,
    });
    expect(quoteServiceMocks.createQuoteRequest).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      company: 'CellTech Repair',
      contactName: 'Yen',
      phone: '555-0101',
      notes: 'Need mixed batteries and screens',
      items: [
        { skuId: 'BAT-IP15', quantity: 25 },
      ],
    }, undefined);
  });

  it('associates authenticated quote submissions with the current user when a bearer token is present', async () => {
    const quoteRequest = {
      quoteRequestId: 'quote_456',
      userId: 'user-123',
      status: 'RECEIVED',
      email: 'buyer@example.com',
      notes: 'Authenticated quote',
      items: [],
      submittedAt: '2026-03-26T12:00:00.000Z',
      updatedAt: '2026-03-26T12:00:00.000Z',
    };
    quoteServiceMocks.createQuoteRequest.mockResolvedValue(quoteRequest);

    const response = await fetch(`${baseUrl}/api/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        email: 'buyer@example.com',
        notes: 'Authenticated quote',
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: quoteRequest,
    });
    expect(quoteServiceMocks.createQuoteRequest).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      notes: 'Authenticated quote',
    }, 'user-123');
  });

  it('validates quote payloads before reaching the service', async () => {
    const response = await fetch(`${baseUrl}/api/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'not-an-email',
        notes: '',
        items: [
          { quantity: 0 },
        ],
      }),
    });

    const data = await response.json() as {
      success: boolean;
      error: string;
      details: Array<{ path: string; message: string }>;
    };

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation failed');
    expect(data.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ path: 'notes' }),
      ])
    );
    expect(quoteServiceMocks.createQuoteRequest).not.toHaveBeenCalled();
  });

  it('serves quote status lookups by quote request id', async () => {
    const quoteRequest = {
      quoteRequestId: 'quote_123',
      status: 'RECEIVED',
      email: 'buyer@example.com',
      notes: 'Need mixed batteries and screens',
      items: [],
      submittedAt: '2026-03-26T12:00:00.000Z',
    };
    quoteServiceMocks.getQuoteRequest.mockResolvedValue(quoteRequest);

    const response = await fetch(`${baseUrl}/api/quote/${encodeURIComponent(' quote_123 ')}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: quoteRequest,
    });
    expect(quoteServiceMocks.getQuoteRequest).toHaveBeenCalledWith('quote_123');
  });
});

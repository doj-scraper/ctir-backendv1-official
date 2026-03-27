import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userServiceMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
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
  requireTokenAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  optionalAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../services/user.service.js', () => ({
  UserService: vi.fn().mockImplementation(() => userServiceMocks),
}));

vi.mock('../middleware/auth.js', () => authMiddlewareMocks);

describe('users routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-users-routes';

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

  it('serves the authenticated user profile', async () => {
    const profile = {
      id: 'user-123',
      email: 'buyer@example.com',
      name: 'Yen',
      company: 'CellTech Repair',
      phone: '555-0101',
      role: 'BUYER',
      createdAt: '2026-03-26T12:00:00.000Z',
      updatedAt: '2026-03-26T12:05:00.000Z',
    };
    userServiceMocks.getProfile.mockResolvedValue(profile);

    const response = await fetch(`${baseUrl}/api/users/profile`, {
      headers: authHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: profile,
    });
    expect(userServiceMocks.getProfile).toHaveBeenCalledWith('user-123');
  });

  it('updates the authenticated user profile', async () => {
    const profile = {
      id: 'user-123',
      email: 'buyer@example.com',
      name: 'Yen Distributor',
      company: 'CellTech Repair',
      phone: '555-0102',
      role: 'BUYER',
      createdAt: '2026-03-26T12:00:00.000Z',
      updatedAt: '2026-03-26T12:10:00.000Z',
    };
    userServiceMocks.updateProfile.mockResolvedValue(profile);

    const response = await fetch(`${baseUrl}/api/users/profile`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        name: ' Yen Distributor ',
        company: 'CellTech Repair',
        phone: '555-0102',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: profile,
    });
    expect(userServiceMocks.updateProfile).toHaveBeenCalledWith('user-123', {
      name: 'Yen Distributor',
      company: 'CellTech Repair',
      phone: '555-0102',
    });
  });

  it('requires authentication for profile access', async () => {
    const response = await fetch(`${baseUrl}/api/users/profile`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  });
});

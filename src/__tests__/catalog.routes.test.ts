import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogServiceMocks = vi.hoisted(() => ({
  getBrands: vi.fn(),
  getModels: vi.fn(),
  searchParts: vi.fn(),
  getHierarchy: vi.fn(),
}));

vi.mock('../services/catalog.service.js', () => ({
  CatalogService: vi.fn().mockImplementation(() => catalogServiceMocks),
}));

const authMiddlewareMocks = vi.hoisted(() => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  optionalAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../middleware/auth.js', () => authMiddlewareMocks);

describe('catalog routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-catalog-routes';

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

  it('serves brands through createApp with the legacy response shape', async () => {
    const brands = [{ id: 1, name: 'Apple' }];
    catalogServiceMocks.getBrands.mockResolvedValue(brands);

    const response = await fetch(`${baseUrl}/api/brands`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      brands,
    });
    expect(catalogServiceMocks.getBrands).toHaveBeenCalledTimes(1);
  });

  it('validates and forwards brandId queries for models', async () => {
    const models = [{
      id: 10,
      brandId: 1,
      modelNumber: 'A3106',
      marketingName: 'iPhone 15',
      releaseYear: 2023,
    }];
    catalogServiceMocks.getModels.mockResolvedValue(models);

    const response = await fetch(`${baseUrl}/api/models?brandId=1`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      models,
    });
    expect(catalogServiceMocks.getModels).toHaveBeenCalledWith(1);
  });

  it('serves the nested brand models alias with the same response contract', async () => {
    const models = [{
      id: 10,
      brandId: 1,
      modelNumber: 'A3106',
      marketingName: 'iPhone 15',
      releaseYear: 2023,
    }];
    catalogServiceMocks.getModels.mockResolvedValue(models);

    const response = await fetch(`${baseUrl}/api/brands/1/models`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      models,
    });
    expect(catalogServiceMocks.getModels).toHaveBeenCalledWith(1);
  });

  it('returns a validation error for invalid model queries', async () => {
    const response = await fetch(`${baseUrl}/api/models?brandId=invalid`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Validation failed',
      details: [{
        path: 'brandId',
      }],
    });
    expect(catalogServiceMocks.getModels).not.toHaveBeenCalled();
  });

  it('validates device queries and preserves the parts response contract', async () => {
    const parts = [{
      skuId: 'BAT-IP15',
      partName: 'Battery',
      category: 'Batteries',
      specifications: 'Capacity: 3349 mAh',
      price: 29.99,
      stock: 18,
      quality: 'OEM',
      primaryModel: 'iPhone 15',
    }];
    catalogServiceMocks.searchParts.mockResolvedValue(parts);

    const response = await fetch(`${baseUrl}/api/parts?device=%20iPhone%2015%20`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      parts,
    });
    expect(catalogServiceMocks.searchParts).toHaveBeenCalledWith('iPhone 15');
  });

  it('returns a validation error when parts requests omit device', async () => {
    const response = await fetch(`${baseUrl}/api/parts`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Validation failed',
      details: [{
        path: 'device',
      }],
    });
    expect(catalogServiceMocks.searchParts).not.toHaveBeenCalled();
  });

  it('serves hierarchy through the mounted /api endpoint', async () => {
    const hierarchy = [{
      id: 1,
      name: 'Apple',
      modelTypes: [{
        id: 5,
        brandId: 1,
        name: 'iPhone',
        generations: [{
          id: 9,
          name: '15',
          releaseYear: 2023,
          variants: [{
            id: 15,
            brandId: 1,
            modelNumber: 'A3106',
            marketingName: 'iPhone 15',
            releaseYear: 2023,
          }],
        }],
      }],
    }];
    catalogServiceMocks.getHierarchy.mockResolvedValue(hierarchy);

    const response = await fetch(`${baseUrl}/api/hierarchy`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      hierarchy,
    });
    expect(catalogServiceMocks.getHierarchy).toHaveBeenCalledTimes(1);
  });
});

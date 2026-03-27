import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inventoryServiceMocks = vi.hoisted(() => ({
  listInventory: vi.fn(),
  checkStock: vi.fn(),
  bulkCheckStock: vi.fn(),
  getInventoryByModel: vi.fn(),
  getInventoryByVariant: vi.fn(),
  getInventoryPart: vi.fn(),
  getInventorySpecifications: vi.fn(),
  getCompatibilityModels: vi.fn(),
}));

vi.mock('../services/inventory.service.js', () => ({
  InventoryService: vi.fn().mockImplementation(() => inventoryServiceMocks),
}));

const authMiddlewareMocks = vi.hoisted(() => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  optionalAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requireRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../middleware/auth.js', () => authMiddlewareMocks);

describe('inventory routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-inventory-routes';

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

  it('serves inventory through createApp with the legacy response shape', async () => {
    const inventory = [{
      skuId: 'BAT-IP15',
      partName: 'Battery',
      category: 'Battery',
      specifications: 'Capacity: 3349 mAh',
      price: 29.99,
      stock: 18,
      quality: 'OEM',
      primaryModel: 'iPhone 15',
    }];
    inventoryServiceMocks.listInventory.mockResolvedValue(inventory);

    const response = await fetch(`${baseUrl}/api/inventory`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      inventory,
      count: inventory.length,
    });
    expect(inventoryServiceMocks.listInventory).toHaveBeenCalledTimes(1);
  });

  it('normalizes sku params for stock lookups and preserves the stock response shape', async () => {
    const stock = {
      skuId: 'BAT-IP15',
      stock: 18,
      available: true,
    };
    inventoryServiceMocks.checkStock.mockResolvedValue(stock);

    const response = await fetch(`${baseUrl}/api/inventory/check/${encodeURIComponent(' BAT-IP15 ')}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      stock,
    });
    expect(inventoryServiceMocks.checkStock).toHaveBeenCalledWith('BAT-IP15');
  });

  it('validates bulk stock checks before calling the inventory service', async () => {
    const response = await fetch(`${baseUrl}/api/inventory/bulk-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skuIds: ['BAT-IP15', '   ', 42],
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
          path: expect.stringMatching(/^skuIds\./),
        }),
      ])
    );
    expect(inventoryServiceMocks.bulkCheckStock).not.toHaveBeenCalled();
  });

  it('serves model-filtered inventory before the sku catch-all route', async () => {
    const parts = [{
      skuId: 'BAT-IP15',
      partName: 'Battery',
      category: 'Battery',
      price: 29.99,
      stock: 18,
      quality: 'OEM',
      primaryModel: 'iPhone 15',
    }];
    inventoryServiceMocks.getInventoryByModel.mockResolvedValue(parts);

    const response = await fetch(`${baseUrl}/api/inventory/model/101`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      parts,
      count: parts.length,
    });
    expect(inventoryServiceMocks.getInventoryByModel).toHaveBeenCalledWith(101);
    expect(inventoryServiceMocks.getInventoryPart).not.toHaveBeenCalled();
  });

  it('validates model ids before loading model-filtered inventory', async () => {
    const response = await fetch(`${baseUrl}/api/inventory/model/not-a-number`);
    const data = (await response.json()) as {
      success: boolean;
      error: string;
      details: Array<{ path: string; message: string }>;
    };

    expect(response.status).toBe(400);
    expect(data).toMatchObject({
      success: false,
      error: 'Validation failed',
      details: [{
        path: 'modelId',
      }],
    });
    expect(inventoryServiceMocks.getInventoryByModel).not.toHaveBeenCalled();
  });

  it('serves variant-filtered inventory for the device explorer contract', async () => {
    const parts = [{
      skuId: 'BAT-IP15',
      partName: 'Battery',
      category: 'Battery',
      price: 29.99,
      stock: 18,
      quality: 'OEM',
      primaryModel: 'iPhone 15',
    }];
    inventoryServiceMocks.getInventoryByVariant.mockResolvedValue(parts);

    const response = await fetch(`${baseUrl}/api/inventory/variants/101/parts`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      parts,
      count: parts.length,
    });
    expect(inventoryServiceMocks.getInventoryByVariant).toHaveBeenCalledWith(101);
    expect(inventoryServiceMocks.getInventoryPart).not.toHaveBeenCalled();
  });

  it('returns part details through the mounted inventory route', async () => {
    const part = {
      skuId: 'BAT-IP15',
      partName: 'Battery',
      category: 'Battery',
      price: 29.99,
      stock: 18,
      quality: 'OEM',
      primaryModel: 'iPhone 15',
      compatibleModels: [{
        id: 101,
        brandId: 1,
        modelNumber: 'A3106',
        marketingName: 'iPhone 15',
        releaseYear: 2023,
      }],
    };
    inventoryServiceMocks.getInventoryPart.mockResolvedValue(part);

    const response = await fetch(`${baseUrl}/api/inventory/${encodeURIComponent(' BAT-IP15 ')}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      part,
    });
    expect(inventoryServiceMocks.getInventoryPart).toHaveBeenCalledWith('BAT-IP15');
  });

  it('serves normalized part specifications before the sku detail catch-all route', async () => {
    const specifications = [
      { label: 'Capacity', value: '3349 mAh' },
      { label: 'Voltage', value: '3.87V' },
    ];
    inventoryServiceMocks.getInventorySpecifications.mockResolvedValue(specifications);

    const response = await fetch(`${baseUrl}/api/inventory/${encodeURIComponent(' BAT-IP15 ')}/specs`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      skuId: 'BAT-IP15',
      specifications,
      count: specifications.length,
    });
    expect(inventoryServiceMocks.getInventorySpecifications).toHaveBeenCalledWith('BAT-IP15');
    expect(inventoryServiceMocks.getInventoryPart).not.toHaveBeenCalled();
  });

  it('serves compatibility with the backward-compatible isDirectPart flag', async () => {
    const compatibleModels = [
      {
        id: 101,
        brandId: 1,
        modelNumber: 'A3106',
        marketingName: 'iPhone 15',
        releaseYear: 2023,
      },
      {
        id: 102,
        brandId: 1,
        modelNumber: 'A2849',
        marketingName: 'iPhone 15 Plus',
        releaseYear: 2023,
      },
    ];
    inventoryServiceMocks.getCompatibilityModels.mockResolvedValue(compatibleModels);

    const response = await fetch(`${baseUrl}/api/compatibility/${encodeURIComponent(' BAT-IP15 ')}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      skuId: 'BAT-IP15',
      isDirectPart: false,
      compatibleModels,
      count: compatibleModels.length,
    });
    expect(inventoryServiceMocks.getCompatibilityModels).toHaveBeenCalledWith('BAT-IP15');
  });
});

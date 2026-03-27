import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock.prisma,
}));

describe('OrderService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-order-service';
  });

  it('lists the current user orders with pagination metadata and status filters', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:05:00.000Z');

    prismaMock.prisma.order.findMany.mockResolvedValue([
      {
        id: 'order_2',
        status: 'PAID',
        totalCents: 4897,
        createdAt,
        updatedAt,
        lines: [
          { quantity: 2 },
          { quantity: 1 },
        ],
      },
    ]);
    prismaMock.prisma.order.count.mockResolvedValue(3);

    const { OrderService } = await import('../services/order.service.js');
    const service = new OrderService();

    const result = await service.listUserOrders('user_1', {
      page: 2,
      limit: 1,
      status: 'PAID',
    });

    expect(prismaMock.prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        status: 'PAID',
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip: 1,
      take: 1,
      select: {
        id: true,
        status: true,
        totalCents: true,
        createdAt: true,
        updatedAt: true,
        lines: {
          select: {
            quantity: true,
          },
        },
      },
    });
    expect(prismaMock.prisma.order.count).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        status: 'PAID',
      },
    });
    expect(result).toEqual({
      items: [
        {
          orderId: 'order_2',
          status: 'PAID',
          totalCents: 4897,
          itemCount: 3,
          createdAt,
          updatedAt,
        },
      ],
      meta: {
        page: 2,
        limit: 1,
        total: 3,
        totalPages: 3,
      },
    });
  });

  it('returns order detail lines with product metadata and purchase totals', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:05:00.000Z');

    prismaMock.prisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PAID',
      totalCents: 4897,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
      lines: [
        {
          skuId: 'BAT-IP15',
          quantity: 2,
          unitPriceAtPurchase: 1299,
          inventory: {
            partName: 'Battery',
            qualityGrade: 'OEM',
            category: {
              name: 'Battery',
            },
            variant: {
              marketingName: 'iPhone 15',
            },
          },
        },
        {
          skuId: 'SCR-IP15',
          quantity: 1,
          unitPriceAtPurchase: 2299,
          inventory: {
            partName: 'Screen',
            qualityGrade: 'Premium',
            category: {
              name: 'Display',
            },
            variant: null,
          },
        },
      ],
    });

    const { OrderService } = await import('../services/order.service.js');
    const service = new OrderService();

    const result = await service.getOrderDetail('user_1', 'order_1');

    expect(prismaMock.prisma.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      select: {
        id: true,
        userId: true,
        status: true,
        totalCents: true,
        stripePaymentIntentId: true,
        createdAt: true,
        updatedAt: true,
        lines: {
          orderBy: [
            { id: 'asc' },
          ],
          select: {
            skuId: true,
            quantity: true,
            unitPriceAtPurchase: true,
            inventory: {
              select: {
                partName: true,
                qualityGrade: true,
                category: {
                  select: {
                    name: true,
                  },
                },
                variant: {
                  select: {
                    marketingName: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(result).toEqual({
      orderId: 'order_1',
      status: 'PAID',
      totalCents: 4897,
      itemCount: 3,
      paymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
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
        {
          skuId: 'SCR-IP15',
          partName: 'Screen',
          category: 'Display',
          qualityGrade: 'Premium',
          primaryModel: undefined,
          quantity: 1,
          unitPriceCents: 2299,
          lineTotalCents: 2299,
        },
      ],
    });
  });

  it('rejects access to another user order before returning any details', async () => {
    prismaMock.prisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_2',
      status: 'PAID',
      totalCents: 4897,
      stripePaymentIntentId: 'pi_1',
      createdAt: new Date('2026-03-25T12:00:00.000Z'),
      updatedAt: new Date('2026-03-25T12:05:00.000Z'),
      lines: [],
    });

    const { OrderService } = await import('../services/order.service.js');
    const service = new OrderService();

    await expect(service.getOrderDetail('user_1', 'order_1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORDER_ACCESS_DENIED',
    });
  });
});

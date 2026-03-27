import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => {
  const tx = {
    cart: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    order: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    inventory: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  return {
    tx,
    prisma: {
      cart: {
        findMany: vi.fn(),
      },
      order: {
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
});

const stripeMock = vi.hoisted(() => ({
  paymentIntents: {
    create: vi.fn(),
    cancel: vi.fn(),
  },
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: prismaMock.prisma,
}));

vi.mock('../lib/stripe.js', () => ({
  stripe: stripeMock,
}));

vi.mock('../lib/logger.js', () => ({
  logger: loggerMock,
}));

describe('CheckoutService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://celltech:celltech@localhost:5432/celltech_test';
    process.env.JWT_SECRET = 'test-secret-for-checkout-service';

    prismaMock.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock.tx) => Promise<unknown>) => callback(prismaMock.tx)
    );
  });

  it('creates a pending order in the database before creating and linking the payment intent', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:00:01.000Z');
    const cartItems = [
      {
        skuId: 'BAT-IP15',
        quantity: 2,
        addedAt: new Date('2026-03-25T11:00:00.000Z'),
        inventory: {
          skuId: 'BAT-IP15',
          partName: 'Battery',
          qualityGrade: 'OEM',
          wholesalePrice: 1299,
          stockLevel: 5,
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
        addedAt: new Date('2026-03-25T11:05:00.000Z'),
        inventory: {
          skuId: 'SCR-IP15',
          partName: 'Screen',
          qualityGrade: 'Premium',
          wholesalePrice: 2299,
          stockLevel: 3,
          category: {
            name: 'Display',
          },
          variant: {
            marketingName: 'iPhone 15',
          },
        },
      },
    ];

    prismaMock.prisma.cart.findMany.mockResolvedValue(cartItems);
    prismaMock.tx.cart.findMany.mockResolvedValue(cartItems);
    prismaMock.tx.order.create.mockResolvedValue({
      id: 'order_1',
      status: 'PENDING',
      totalCents: 4897,
      stripePaymentIntentId: null,
      createdAt,
      updatedAt,
    });
    prismaMock.tx.cart.deleteMany.mockResolvedValue({ count: 2 });
    stripeMock.paymentIntents.create.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'secret_1',
      currency: 'usd',
    });
    prismaMock.prisma.order.update.mockResolvedValue({
      id: 'order_1',
      status: 'PENDING',
      totalCents: 4897,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    });

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    const result = await service.createCheckout('user_1');

    expect(prismaMock.tx.order.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        status: 'PENDING',
        totalCents: 4897,
        lines: {
          create: [
             {
               skuId: 'BAT-IP15',
               quantity: 2,
               unitPriceAtPurchase: 1299,
               partNameSnapshot: 'Battery',
               qualityGradeSnapshot: 'OEM',
               variantMarketingNameSnapshot: 'iPhone 15',
             },
             {
               skuId: 'SCR-IP15',
               quantity: 1,
               unitPriceAtPurchase: 2299,
               partNameSnapshot: 'Screen',
               qualityGradeSnapshot: 'Premium',
               variantMarketingNameSnapshot: 'iPhone 15',
             },
           ],
         },
       },
      select: {
        id: true,
        status: true,
        totalCents: true,
        stripePaymentIntentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(prismaMock.tx.cart.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
      },
    });

    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 4897,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          userId: 'user_1',
          orderId: 'order_1',
        },
      },
      {
        idempotencyKey: 'checkout-order:order_1',
      }
    );
    expect(prismaMock.prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: {
        stripePaymentIntentId: 'pi_1',
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        stripePaymentIntentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(prismaMock.tx.inventory.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.tx.order.create.mock.invocationCallOrder[0]).toBeLessThan(
      stripeMock.paymentIntents.create.mock.invocationCallOrder[0]
    );

    expect(result).toEqual({
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
        {
          skuId: 'SCR-IP15',
          partName: 'Screen',
          category: 'Display',
          qualityGrade: 'Premium',
          primaryModel: 'iPhone 15',
          quantity: 1,
          unitPriceCents: 2299,
          lineTotalCents: 2299,
        },
      ],
      createdAt,
    });
  });

  it('restores the cart and cancels the pending order if payment intent creation fails', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:00:01.000Z');
    const cartItems = [
      {
        skuId: 'BAT-IP15',
        quantity: 2,
        addedAt: new Date('2026-03-25T11:00:00.000Z'),
        inventory: {
          skuId: 'BAT-IP15',
          partName: 'Battery',
          qualityGrade: 'OEM',
          wholesalePrice: 1299,
          stockLevel: 5,
          category: {
            name: 'Battery',
          },
          variant: {
            marketingName: 'iPhone 15',
          },
        },
      },
    ];
    const stripeError = new Error('Stripe unavailable');

    prismaMock.prisma.cart.findMany.mockResolvedValue(cartItems);
    prismaMock.tx.cart.findMany.mockResolvedValue(cartItems);
    prismaMock.tx.order.create.mockResolvedValue({
      id: 'order_1',
      status: 'PENDING',
      totalCents: 2598,
      stripePaymentIntentId: null,
      createdAt,
      updatedAt,
    });
    prismaMock.tx.cart.deleteMany.mockResolvedValue({ count: 1 });
    stripeMock.paymentIntents.create.mockRejectedValue(stripeError);
    prismaMock.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PENDING',
      totalCents: 2598,
      stripePaymentIntentId: null,
      createdAt,
      updatedAt,
      lines: [
        {
          skuId: 'BAT-IP15',
          quantity: 2,
          unitPriceAtPurchase: 1299,
        },
      ],
    });
    prismaMock.tx.cart.upsert.mockResolvedValue({
      userId: 'user_1',
      skuId: 'BAT-IP15',
      quantity: 2,
    });
    prismaMock.tx.order.update.mockResolvedValue({
      id: 'order_1',
      status: 'CANCELLED',
      totalCents: 2598,
      stripePaymentIntentId: null,
      createdAt,
      updatedAt,
    });

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    await expect(service.createCheckout('user_1')).rejects.toBe(stripeError);

    expect(prismaMock.tx.cart.upsert).toHaveBeenCalledWith({
      where: {
        userId_skuId: {
          userId: 'user_1',
          skuId: 'BAT-IP15',
        },
      },
      update: {
        quantity: {
          increment: 2,
        },
      },
      create: {
        userId: 'user_1',
        skuId: 'BAT-IP15',
        quantity: 2,
      },
    });
    expect(prismaMock.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: {
        status: 'CANCELLED',
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        stripePaymentIntentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
  });

  it('rejects checkout when the cart is empty before creating the order or payment intent', async () => {
    prismaMock.prisma.cart.findMany.mockResolvedValue([]);

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    await expect(service.createCheckout('user_1')).rejects.toMatchObject({
      statusCode: 400,
      code: 'EMPTY_CART',
    });

    expect(prismaMock.tx.order.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('rejects a zero-dollar checkout total before creating the order or payment intent', async () => {
    prismaMock.prisma.cart.findMany.mockResolvedValue([
      {
        skuId: 'TOOL-FREE',
        quantity: 1,
        addedAt: new Date('2026-03-25T11:00:00.000Z'),
        inventory: {
          skuId: 'TOOL-FREE',
          partName: 'Promo Tool',
          qualityGrade: 'NA',
          wholesalePrice: 0,
          stockLevel: 10,
          category: {
            name: 'Tools',
          },
          variant: null,
        },
      },
    ]);

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    await expect(service.createCheckout('user_1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_CHECKOUT_TOTAL',
    });

    expect(prismaMock.tx.order.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('decrements stock and marks the order paid when the payment intent succeeds', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:05:00.000Z');

    prismaMock.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PENDING',
      totalCents: 2598,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
      lines: [
        {
          skuId: 'BAT-IP15',
          quantity: 2,
          unitPriceAtPurchase: 1299,
        },
      ],
    });
    prismaMock.tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.tx.order.update.mockResolvedValue({
      id: 'order_1',
      status: 'PAID',
      totalCents: 2598,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    });

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    const result = await service.confirmPaymentIntent('pi_1');

    expect(prismaMock.tx.inventory.updateMany).toHaveBeenCalledWith({
      where: {
        skuId: 'BAT-IP15',
        stockLevel: {
          gte: 2,
        },
      },
      data: {
        stockLevel: {
          decrement: 2,
        },
      },
    });
    expect(prismaMock.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: {
        status: 'PAID',
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        stripePaymentIntentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual({
      orderId: 'order_1',
      status: 'PAID',
      totalCents: 2598,
      paymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    });
  });

  it('treats repeated successful payment webhooks as idempotent', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:05:00.000Z');

    prismaMock.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PAID',
      totalCents: 2598,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
      lines: [
        {
          skuId: 'BAT-IP15',
          quantity: 2,
          unitPriceAtPurchase: 1299,
        },
      ],
    });

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    const result = await service.confirmPaymentIntent('pi_1');

    expect(prismaMock.tx.inventory.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.tx.order.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      orderId: 'order_1',
      status: 'PAID',
      totalCents: 2598,
      paymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    });
  });

  it('restores the cart and cancels the order when the payment intent fails', async () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');
    const updatedAt = new Date('2026-03-25T12:05:00.000Z');

    prismaMock.tx.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      status: 'PENDING',
      totalCents: 2598,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
      lines: [
        {
          skuId: 'BAT-IP15',
          quantity: 2,
          unitPriceAtPurchase: 1299,
        },
      ],
    });
    prismaMock.tx.cart.upsert.mockResolvedValue({
      userId: 'user_1',
      skuId: 'BAT-IP15',
      quantity: 2,
    });
    prismaMock.tx.order.update.mockResolvedValue({
      id: 'order_1',
      status: 'CANCELLED',
      totalCents: 2598,
      stripePaymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    });

    const { CheckoutService } = await import('../services/checkout.service.js');
    const service = new CheckoutService();

    const result = await service.cancelPendingCheckout('pi_1');

    expect(prismaMock.tx.cart.upsert).toHaveBeenCalledWith({
      where: {
        userId_skuId: {
          userId: 'user_1',
          skuId: 'BAT-IP15',
        },
      },
      update: {
        quantity: {
          increment: 2,
        },
      },
      create: {
        userId: 'user_1',
        skuId: 'BAT-IP15',
        quantity: 2,
      },
    });
    expect(prismaMock.tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: {
        status: 'CANCELLED',
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        stripePaymentIntentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual({
      orderId: 'order_1',
      status: 'CANCELLED',
      totalCents: 2598,
      paymentIntentId: 'pi_1',
      createdAt,
      updatedAt,
    });
  });
});

import { OrderStatus, Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { HttpError } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { CartItemDto, CartService, CartSummaryDto } from './cart.service.js';
import { logEvent } from './event-logger.service.js';

const CHECKOUT_CURRENCY = 'usd';

const cartService = new CartService();

const orderStatusSelect = {
  id: true,
  status: true,
  totalCents: true,
  stripePaymentIntentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const pendingOrderInclude = {
  lines: {
    select: {
      skuId: true,
      quantity: true,
      unitPriceAtPurchase: true,
    },
  },
} as const;

type OrderStatusRecord = Prisma.OrderGetPayload<{
  select: typeof orderStatusSelect;
}>;

type PendingOrderRecord = Prisma.OrderGetPayload<{
  include: typeof pendingOrderInclude;
}>;

type CheckoutSnapshot = {
  items: CheckoutLineDto[];
  totalCents: number;
  fingerprint: string;
};

type PendingCheckoutCreation = {
  order: OrderStatusRecord;
  snapshot: CheckoutSnapshot;
};

export type CheckoutLineDto = Omit<CartItemDto, 'addedAt' | 'stockAvailable' | 'available'>;

export type CheckoutResultDto = {
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  paymentIntentId: string;
  clientSecret: string | null;
  items: CheckoutLineDto[];
  createdAt: Date;
};

export type CheckoutOrderStateDto = {
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  paymentIntentId?: string;
  createdAt: Date;
  updatedAt: Date;
};

function getStripeClient(): Stripe {
  if (!stripe) {
    throw new HttpError(503, 'Stripe is not configured', 'STRIPE_NOT_CONFIGURED');
  }

  return stripe;
}

function createInsufficientStockError(skuId: string, stockLevel: number): HttpError {
  return new HttpError(
    422,
    `Only ${stockLevel} unit${stockLevel === 1 ? '' : 's'} available for ${skuId}`,
    'INSUFFICIENT_STOCK'
  );
}

function ensureCartNotEmpty(cart: CartSummaryDto): void {
  if (cart.items.length === 0) {
    throw new HttpError(400, 'Cart is empty', 'EMPTY_CART');
  }
}

function ensureValidMoneyAmount(amountCents: number, code: string, message: string): void {
  if (!Number.isInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(amountCents)) {
    throw new HttpError(500, message, code);
  }
}

function ensureChargeableTotal(totalCents: number): void {
  if (totalCents <= 0) {
    throw new HttpError(422, 'Checkout total must be greater than zero', 'INVALID_CHECKOUT_TOTAL');
  }
}

function mapCheckoutLine(item: CartItemDto): CheckoutLineDto {
  return {
    skuId: item.skuId,
    partName: item.partName,
    category: item.category,
    qualityGrade: item.qualityGrade,
    primaryModel: item.primaryModel,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.lineTotalCents,
  };
}

function buildCheckoutFingerprint(cart: CartSummaryDto): string {
  return cart.items
    .map((item) => `${item.skuId}:${item.quantity}:${item.unitPriceCents}`)
    .join('|');
}

function buildCheckoutSnapshot(cart: CartSummaryDto): CheckoutSnapshot {
  ensureCartNotEmpty(cart);
  ensureValidMoneyAmount(cart.totalCents, 'INVALID_ORDER_TOTAL', 'Cart total exceeds supported amount');
  ensureChargeableTotal(cart.totalCents);

  const items = cart.items.map((item) => {
    ensureValidMoneyAmount(item.unitPriceCents, 'INVALID_PRICE_AMOUNT', 'Cart contains an invalid price');
    ensureValidMoneyAmount(item.lineTotalCents, 'INVALID_LINE_TOTAL', 'Cart contains an invalid line total');
    return mapCheckoutLine(item);
  });

  return {
    items,
    totalCents: cart.totalCents,
    fingerprint: buildCheckoutFingerprint(cart),
  };
}

function ensureStockAvailable(item: CartItemDto): void {
  if (!item.available || item.quantity > item.stockAvailable) {
    throw createInsufficientStockError(item.skuId, item.stockAvailable);
  }
}

function mapOrderState(order: OrderStatusRecord): CheckoutOrderStateDto {
  return {
    orderId: order.id,
    status: order.status,
    totalCents: order.totalCents,
    paymentIntentId: order.stripePaymentIntentId ?? undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

async function loadOrderByPaymentIntentOrThrow(
  tx: Prisma.TransactionClient,
  paymentIntentId: string
): Promise<PendingOrderRecord> {
  const order = await tx.order.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    include: pendingOrderInclude,
  });

  if (!order) {
    throw new HttpError(404, 'Order not found for payment intent', 'ORDER_NOT_FOUND');
  }

  return order;
}

async function decrementInventoryOrThrow(
  tx: Prisma.TransactionClient,
  item: PendingOrderRecord['lines'][number]
): Promise<void> {
  const result = await tx.inventory.updateMany({
    where: {
      skuId: item.skuId,
      stockLevel: {
        gte: item.quantity,
      },
    },
    data: {
      stockLevel: {
        decrement: item.quantity,
      },
    },
  });

  if (result.count === 1) {
    return;
  }

  const inventory = await tx.inventory.findUnique({
    where: { skuId: item.skuId },
    select: {
      stockLevel: true,
    },
  });

  throw createInsufficientStockError(item.skuId, inventory?.stockLevel ?? 0);
}

async function restoreCartLine(
  tx: Prisma.TransactionClient,
  userId: string,
  item: PendingOrderRecord['lines'][number]
): Promise<void> {
  await tx.cart.upsert({
    where: {
      userId_skuId: {
        userId,
        skuId: item.skuId,
      },
    },
    update: {
      quantity: {
        increment: item.quantity,
      },
    },
    create: {
      userId,
      skuId: item.skuId,
      quantity: item.quantity,
    },
  });
}

async function createPendingOrderFromCart(
  tx: Prisma.TransactionClient,
  userId: string,
  initialSnapshot: CheckoutSnapshot
): Promise<PendingCheckoutCreation> {
  const currentCart = await cartService.getCart(userId, tx);
  const currentSnapshot = buildCheckoutSnapshot(currentCart);

  if (currentSnapshot.fingerprint !== initialSnapshot.fingerprint) {
    throw new HttpError(
      409,
      'Cart changed during checkout. Please review your cart and try again.',
      'CART_CHANGED_DURING_CHECKOUT'
    );
  }

  for (const item of currentCart.items) {
    ensureStockAvailable(item);
  }

  const order = await tx.order.create({
    data: {
      userId,
      status: OrderStatus.PENDING,
      totalCents: currentSnapshot.totalCents,
      lines: {
        create: currentSnapshot.items.map((item) => ({
          skuId: item.skuId,
          quantity: item.quantity,
          unitPriceAtPurchase: item.unitPriceCents,
          partNameSnapshot: item.partName,
          qualityGradeSnapshot: item.qualityGrade as any,
          variantMarketingNameSnapshot: item.primaryModel ?? null,
        })),
      },
    },
    select: orderStatusSelect,
  });

  await cartService.clearCart(userId, tx);

  return {
    order,
    snapshot: currentSnapshot,
  };
}

async function cancelPaymentIntentOnFailure(
  stripeClient: Stripe,
  paymentIntentId: string
): Promise<void> {
  try {
    await stripeClient.paymentIntents.cancel(paymentIntentId);
  } catch (error) {
    logger.error(
      {
        err: error,
        paymentIntentId,
      },
      'Failed to cancel payment intent during checkout rollback'
    );
  }
}

export class CheckoutService {
  private async restoreCartAndCancelOrder(orderId: string): Promise<CheckoutOrderStateDto | null> {
    return prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: pendingOrderInclude,
        });

        if (!order) {
          return null;
        }

        if (order.status !== OrderStatus.PENDING) {
          return mapOrderState(order);
        }

        for (const line of order.lines) {
          await restoreCartLine(tx, order.userId, line);
        }

        const cancelledOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
          },
          select: orderStatusSelect,
        });

        return mapOrderState(cancelledOrder);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  }

  async createCheckout(userId: string): Promise<CheckoutResultDto> {
    const stripeClient = getStripeClient();
    const initialCart = await cartService.getCart(userId);
    const initialSnapshot = buildCheckoutSnapshot(initialCart);

    const pendingCheckout = await prisma.$transaction(
      (tx) => createPendingOrderFromCart(tx, userId, initialSnapshot),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    let paymentIntent: Stripe.PaymentIntent | null = null;

    try {
      paymentIntent = await stripeClient.paymentIntents.create(
        {
          amount: pendingCheckout.snapshot.totalCents,
          currency: CHECKOUT_CURRENCY,
          automatic_payment_methods: {
            enabled: true,
          },
          metadata: {
            userId,
            orderId: pendingCheckout.order.id,
          },
        },
        {
          idempotencyKey: `checkout-order:${pendingCheckout.order.id}`,
        }
      );

      const linkedOrder = await prisma.order.update({
        where: { id: pendingCheckout.order.id },
        data: {
          stripePaymentIntentId: paymentIntent.id,
        },
        select: orderStatusSelect,
      });

      logEvent('COMMERCE', 'INFO', 'CheckoutService.createCheckout', 'Order created successfully', { orderId: linkedOrder.id, userId, totalCents: linkedOrder.totalCents });

      return {
        orderId: linkedOrder.id,
        status: linkedOrder.status,
        totalCents: linkedOrder.totalCents,
        currency: paymentIntent.currency,
        paymentIntentId: linkedOrder.stripePaymentIntentId ?? paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        items: pendingCheckout.snapshot.items,
        createdAt: linkedOrder.createdAt,
      };
    } catch (error) {
      logEvent('COMMERCE', 'ERROR', 'CheckoutService.createCheckout', 'Payment failed during checkout', { orderId: pendingCheckout.order.id, userId });

      if (paymentIntent) {
        await cancelPaymentIntentOnFailure(stripeClient, paymentIntent.id);
      }

      try {
        await this.restoreCartAndCancelOrder(pendingCheckout.order.id);
      } catch (rollbackError) {
        logger.error(
          {
            err: rollbackError,
            orderId: pendingCheckout.order.id,
          },
          'Failed to restore cart after checkout setup failure'
        );
      }

      throw error;
    }
  }

  async confirmPaymentIntent(paymentIntentId: string): Promise<CheckoutOrderStateDto> {
    return prisma.$transaction(
      async (tx) => {
        const order = await loadOrderByPaymentIntentOrThrow(tx, paymentIntentId);

        if (order.status !== OrderStatus.PENDING) {
          return mapOrderState(order);
        }

        for (const line of order.lines) {
          await decrementInventoryOrThrow(tx, line);
        }

        const paidOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.PAID,
          },
          select: orderStatusSelect,
        });

        return mapOrderState(paidOrder);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  }

  async cancelPendingCheckout(paymentIntentId: string): Promise<CheckoutOrderStateDto> {
    return prisma.$transaction(
      async (tx) => {
        const order = await loadOrderByPaymentIntentOrThrow(tx, paymentIntentId);

        if (order.status !== OrderStatus.PENDING) {
          return mapOrderState(order);
        }

        for (const line of order.lines) {
          await restoreCartLine(tx, order.userId, line);
        }

        const cancelledOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
          },
          select: orderStatusSelect,
        });

        return mapOrderState(cancelledOrder);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<CheckoutOrderStateDto | null> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.confirmPaymentIntent(event.data.object.id);
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        return this.cancelPendingCheckout(event.data.object.id);
      default:
        return null;
    }
  }
}

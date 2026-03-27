import { OrderStatus, Prisma } from '@prisma/client';
import { HttpError } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const orderSummarySelect = {
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
} satisfies Prisma.OrderSelect;

const orderDetailSelect = {
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
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderSummaryRecord = Prisma.OrderGetPayload<{
  select: typeof orderSummarySelect;
}>;

type OrderDetailRecord = Prisma.OrderGetPayload<{
  select: typeof orderDetailSelect;
}>;

export type ListUserOrdersInput = {
  page: number;
  limit: number;
  status?: OrderStatus;
};

export type OrderLineDetailDto = {
  skuId: string;
  partName: string;
  category: string;
  qualityGrade: string;
  primaryModel?: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type OrderSummaryDto = {
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderDetailDto = OrderSummaryDto & {
  paymentIntentId?: string;
  lines: OrderLineDetailDto[];
};

export type OrderListMetaDto = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ListUserOrdersResultDto = {
  items: OrderSummaryDto[];
  meta: OrderListMetaDto;
};

function createOrderNotFoundError(): HttpError {
  return new HttpError(404, 'Order not found', 'ORDER_NOT_FOUND');
}

function createOrderAccessDeniedError(): HttpError {
  return new HttpError(403, 'You do not have access to this order', 'ORDER_ACCESS_DENIED');
}

function calculateItemCount(lines: Array<{ quantity: number }>): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

function calculateLineTotalCents(quantity: number, unitPriceCents: number): number {
  return quantity * unitPriceCents;
}

function mapOrderSummary(order: OrderSummaryRecord): OrderSummaryDto {
  return {
    orderId: order.id,
    status: order.status,
    totalCents: order.totalCents,
    itemCount: calculateItemCount(order.lines),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function mapOrderLine(line: OrderDetailRecord['lines'][number]): OrderLineDetailDto {
  return {
    skuId: line.skuId,
    partName: line.inventory.partName,
    category: line.inventory.category.name,
    qualityGrade: line.inventory.qualityGrade,
    primaryModel: undefined,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceAtPurchase,
    lineTotalCents: calculateLineTotalCents(line.quantity, line.unitPriceAtPurchase),
  };
}

function mapOrderDetail(order: OrderDetailRecord): OrderDetailDto {
  const lines = order.lines.map(mapOrderLine);

  return {
    orderId: order.id,
    status: order.status,
    totalCents: order.totalCents,
    itemCount: calculateItemCount(order.lines),
    paymentIntentId: order.stripePaymentIntentId ?? undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    lines,
  };
}

export class OrderService {
  async listUserOrders(userId: string, input: ListUserOrdersInput): Promise<ListUserOrdersResultDto> {
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(input.status ? { status: input.status } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: orderSummarySelect,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      items: orders.map(mapOrderSummary),
      meta: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  async getOrderDetail(userId: string, orderId: string): Promise<OrderDetailDto> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: orderDetailSelect,
    });

    if (!order) {
      throw createOrderNotFoundError();
    }

    if (order.userId !== userId) {
      throw createOrderAccessDeniedError();
    }

    return mapOrderDetail(order);
  }
}

import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { logEvent } from './event-logger.service.js';

const cartItemInclude = {
  inventory: {
    select: {
      skuId: true,
      partName: true,
      qualityGrade: true,
      wholesalePrice: true,
      stockLevel: true,
      category: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartRecord = Prisma.CartGetPayload<{
  include: typeof cartItemInclude;
}>;

type DbClient = typeof prisma | Prisma.TransactionClient;

export type CartItemDto = {
  skuId: string;
  partName: string;
  category: string;
  qualityGrade: string;
  primaryModel?: string;
  quantity: number;
  addedAt: Date;
  unitPriceCents: number;
  lineTotalCents: number;
  stockAvailable: number;
  available: boolean;
};

export type CartSummaryDto = {
  items: CartItemDto[];
  subtotalCents: number;
  totalCents: number;
  itemCount: number;
};

export type AddOrUpdateCartItemInput = {
  skuId: string;
  quantity: number;
};

export type CartValidationIssueDto = {
  skuId: string;
  code: 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'PRICE_UNAVAILABLE';
  message: string;
};

export type CartValidationDto = CartSummaryDto & {
  valid: boolean;
  issues: CartValidationIssueDto[];
};

function createEmptyCart(): CartSummaryDto {
  return {
    items: [],
    subtotalCents: 0,
    totalCents: 0,
    itemCount: 0,
  };
}

function ensureValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpError(422, 'Quantity must be a positive integer', 'INVALID_CART_QUANTITY');
  }
}

function ensureStockAvailable(skuId: string, requestedQuantity: number, stockLevel: number): void {
  if (requestedQuantity > stockLevel) {
    throw new HttpError(
      422,
      `Only ${stockLevel} unit${stockLevel === 1 ? '' : 's'} available for ${skuId}`,
      'INSUFFICIENT_STOCK'
    );
  }
}

function mapCartItem(item: CartRecord): CartItemDto {
  const lineTotalCents = item.quantity * item.inventory.wholesalePrice;
  const available = item.quantity <= item.inventory.stockLevel && item.inventory.stockLevel > 0;

  return {
    skuId: item.skuId,
    partName: item.inventory.partName,
    category: item.inventory.category.name,
    qualityGrade: item.inventory.qualityGrade,
    primaryModel: undefined,
    quantity: item.quantity,
    addedAt: item.addedAt,
    unitPriceCents: item.inventory.wholesalePrice,
    lineTotalCents,
    stockAvailable: item.inventory.stockLevel,
    available,
  };
}

function buildCartSummary(items: CartRecord[]): CartSummaryDto {
  if (items.length === 0) {
    return createEmptyCart();
  }

  return summarizeMappedItems(items.map(mapCartItem));
}

function summarizeMappedItems(mappedItems: CartItemDto[]): CartSummaryDto {
  const subtotalCents = mappedItems.reduce((total, item) => total + item.lineTotalCents, 0);
  const itemCount = mappedItems.reduce((total, item) => total + item.quantity, 0);

  return {
    items: mappedItems,
    subtotalCents,
    totalCents: subtotalCents,
    itemCount,
  };
}

function createValidationIssue(item: CartItemDto): CartValidationIssueDto[] {
  const issues: CartValidationIssueDto[] = [];

  if (item.unitPriceCents <= 0) {
    issues.push({
      skuId: item.skuId,
      code: 'PRICE_UNAVAILABLE',
      message: `Pricing is unavailable for ${item.skuId}`,
    });
  }

  if (item.stockAvailable <= 0) {
    issues.push({
      skuId: item.skuId,
      code: 'OUT_OF_STOCK',
      message: `${item.skuId} is out of stock`,
    });
  } else if (item.quantity > item.stockAvailable) {
    issues.push({
      skuId: item.skuId,
      code: 'INSUFFICIENT_STOCK',
      message: `Only ${item.stockAvailable} unit${item.stockAvailable === 1 ? '' : 's'} available for ${item.skuId}`,
    });
  }

  return issues;
}

function buildValidationSummary(items: CartRecord[]): CartValidationDto {
  return buildValidationSummaryFromMappedItems(items.map(mapCartItem));
}

function buildValidationSummaryFromMappedItems(items: CartItemDto[]): CartValidationDto {
  const summary = summarizeMappedItems(items);
  const issues = summary.items.flatMap(createValidationIssue);

  return {
    ...summary,
    valid: issues.length === 0,
    issues,
  };
}

function aggregateItems(items: AddOrUpdateCartItemInput[]): AddOrUpdateCartItemInput[] {
  const aggregated = new Map<string, number>();

  for (const item of items) {
    ensureValidQuantity(item.quantity);
    aggregated.set(item.skuId, (aggregated.get(item.skuId) ?? 0) + item.quantity);
  }

  return [...aggregated.entries()].map(([skuId, quantity]) => ({ skuId, quantity }));
}

async function loadInventoryOrThrow(db: DbClient, skuId: string) {
  const inventory = await db.inventory.findUnique({
    where: { skuId },
    select: {
      skuId: true,
      stockLevel: true,
    },
  });

  if (!inventory) {
    throw new HttpError(404, 'Inventory item not found', 'INVENTORY_ITEM_NOT_FOUND');
  }

  return inventory;
}

async function loadCartItems(db: DbClient, userId: string): Promise<CartRecord[]> {
  return db.cart.findMany({
    where: { userId },
    orderBy: [
      { addedAt: 'asc' },
      { skuId: 'asc' },
    ],
    include: cartItemInclude,
  });
}

export class CartService {
  async getCart(userId: string, db: DbClient = prisma): Promise<CartSummaryDto> {
    const items = await loadCartItems(db, userId);
    return buildCartSummary(items);
  }

  async addOrUpdateItem(userId: string, input: AddOrUpdateCartItemInput): Promise<CartSummaryDto> {
    ensureValidQuantity(input.quantity);

    const items = await prisma.$transaction(async (tx) => {
      const [inventory, existingCartItem] = await Promise.all([
        loadInventoryOrThrow(tx, input.skuId),
        tx.cart.findUnique({
          where: {
            userId_skuId: {
              userId,
              skuId: input.skuId,
            },
          },
          select: {
            quantity: true,
          },
        }),
      ]);

      ensureStockAvailable(
        input.skuId,
        (existingCartItem?.quantity ?? 0) + input.quantity,
        inventory.stockLevel
      );

      const cartItem = await tx.cart.upsert({
        where: {
          userId_skuId: {
            userId,
            skuId: input.skuId,
          },
        },
        update: {
          quantity: {
            increment: input.quantity,
          },
        },
        create: {
          userId,
          skuId: input.skuId,
          quantity: input.quantity,
        },
        include: cartItemInclude,
      });

      ensureStockAvailable(input.skuId, cartItem.quantity, cartItem.inventory.stockLevel);

      return loadCartItems(tx, userId);
    });

    logEvent('COMMERCE', 'INFO', 'CartService.addOrUpdateItem', 'Item added to cart', { userId, skuId: input.skuId, quantity: input.quantity });

    return buildCartSummary(items);
  }

  async syncCart(userId: string, items: AddOrUpdateCartItemInput[]): Promise<CartSummaryDto> {
    const aggregatedItems = aggregateItems(items);

    const syncedItems = await prisma.$transaction(async (tx) => {
      await tx.cart.deleteMany({
        where: { userId },
      });

      for (const item of aggregatedItems) {
        const inventory = await loadInventoryOrThrow(tx, item.skuId);
        ensureStockAvailable(item.skuId, item.quantity, inventory.stockLevel);

        await tx.cart.create({
          data: {
            userId,
            skuId: item.skuId,
            quantity: item.quantity,
          },
        });
      }

      return loadCartItems(tx, userId);
    });

    return buildCartSummary(syncedItems);
  }

  async validateCart(userId: string, items?: AddOrUpdateCartItemInput[]): Promise<CartValidationDto> {
    if (items) {
      const previewItems = await this.buildPreviewItems(items);
      return buildValidationSummaryFromMappedItems(previewItems);
    }

    const cartItems = await loadCartItems(prisma, userId);
    return buildValidationSummary(cartItems);
  }

  private async buildPreviewItems(items: AddOrUpdateCartItemInput[]): Promise<CartItemDto[]> {
    const aggregatedItems = aggregateItems(items);
    const inventoryRows = await prisma.inventory.findMany({
      where: {
        skuId: {
          in: aggregatedItems.map((item) => item.skuId),
        },
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });
    const inventoryBySkuId = new Map(inventoryRows.map((row) => [row.skuId, row]));

    return aggregatedItems.map((item) => {
      const inventory = inventoryBySkuId.get(item.skuId);

      if (!inventory) {
        throw new HttpError(404, 'Inventory item not found', 'INVENTORY_ITEM_NOT_FOUND');
      }

      const lineTotalCents = item.quantity * inventory.wholesalePrice;

      return {
        skuId: item.skuId,
        partName: inventory.partName,
        category: inventory.category.name,
        qualityGrade: inventory.qualityGrade,
        primaryModel: undefined,
        quantity: item.quantity,
        addedAt: new Date(),
        unitPriceCents: inventory.wholesalePrice,
        lineTotalCents,
        stockAvailable: inventory.stockLevel,
        available: item.quantity <= inventory.stockLevel && inventory.stockLevel > 0,
      };
    });
  }

  async updateItemQuantity(userId: string, skuId: string, quantity: number): Promise<CartSummaryDto> {
    ensureValidQuantity(quantity);

    const items = await prisma.$transaction(async (tx) => {
      const cartItem = await tx.cart.findUnique({
        where: {
          userId_skuId: {
            userId,
            skuId,
          },
        },
        include: cartItemInclude,
      });

      if (!cartItem) {
        throw new HttpError(404, 'Cart item not found', 'CART_ITEM_NOT_FOUND');
      }

      ensureStockAvailable(skuId, quantity, cartItem.inventory.stockLevel);

      await tx.cart.update({
        where: {
          userId_skuId: {
            userId,
            skuId,
          },
        },
        data: {
          quantity,
        },
      });

      return loadCartItems(tx, userId);
    });

    return buildCartSummary(items);
  }

  async removeItem(userId: string, skuId: string): Promise<CartSummaryDto> {
    const items = await prisma.$transaction(async (tx) => {
      await tx.cart.delete({
        where: {
          userId_skuId: {
            userId,
            skuId,
          },
        },
      });

      return loadCartItems(tx, userId);
    });

    logEvent('COMMERCE', 'INFO', 'CartService.removeItem', 'Item removed from cart', { userId, skuId });

    return buildCartSummary(items);
  }

  async clearCart(userId: string, db: DbClient = prisma): Promise<CartSummaryDto> {
    await db.cart.deleteMany({
      where: { userId },
    });

    return createEmptyCart();
  }
}

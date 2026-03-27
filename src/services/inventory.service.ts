// Phase 3 — inventory service
// Inventory service: stock checks, availability, reservation logic

import { prisma } from '../lib/prisma.js';

type BrandDto = {
  id: number;
  name: string;
};

type ModelDto = {
  id: number;
  brandId: number;
  modelNumber: string;
  marketingName: string;
  releaseYear: number;
  brand?: BrandDto;
};

export type InventoryPartDto = {
  skuId: string;
  partName: string;
  specifications?: string;
  category: string;
  quality?: string;
  price?: number;
  stock: number;
  primaryModel?: string;
  compatibleModels?: ModelDto[];
};

export type InventorySpecificationDto = {
  label: string;
  value: string;
};

export type StockCheckDto = {
  skuId: string;
  stock: number;
  available: boolean;
};

type BrandRecord = {
  id: number;
  name: string;
};

type VariantRecord = {
  id: number;
  modelNumber: string;
  marketingName: string;
  generation: {
    releaseYear: number | null;
    modelType: {
      brandId: number;
      brand: BrandRecord;
    };
  };
};

type InventoryDetails = {
  skuId: string;
  partName: string;
  qualityGrade: string;
  wholesalePrice: number;
  stockLevel: number;
  category: {
    name: string;
  };
  variant: VariantRecord | null;
  specifications: Array<{
    label: string;
    value: string;
  }>;
  compatibilities: Array<{
    variant: VariantRecord;
  }>;
};

const relationInclude = {
  include: {
    generation: {
      include: {
        modelType: {
          include: {
            brand: true,
          },
        },
      },
    },
  },
} as const;

const inventoryInclude = {
  category: true,
  variant: relationInclude,
  specifications: {
    orderBy: {
      label: 'asc',
    },
  },
  compatibilities: {
    include: {
      variant: relationInclude,
    },
  },
} as const;

function mapBrand(brand: BrandRecord): BrandDto {
  return {
    id: brand.id,
    name: brand.name,
  };
}

function mapModel(variant: VariantRecord): ModelDto {
  const brand = variant.generation.modelType.brand;

  return {
    id: variant.id,
    brandId: variant.generation.modelType.brandId,
    modelNumber: variant.modelNumber,
    marketingName: variant.marketingName,
    releaseYear: variant.generation.releaseYear ?? 0,
    brand: brand ? mapBrand(brand) : undefined,
  };
}

function mapCompatibilityModels(details: InventoryDetails, includePrimaryModel = false): ModelDto[] {
  const models = new Map<number, ModelDto>();

  if (includePrimaryModel && details.variant) {
    const primary = mapModel(details.variant);
    models.set(primary.id, primary);
  }

  for (const compatibility of details.compatibilities) {
    const model = mapModel(compatibility.variant);
    models.set(model.id, model);
  }

  return [...models.values()];
}

function buildSpecificationString(
  specifications: InventoryDetails['specifications']
): string | undefined {
  if (specifications.length === 0) {
    return undefined;
  }

  return specifications
    .map((specification) => `${specification.label}: ${specification.value}`)
    .join(', ');
}

function mapInventoryPart(details: InventoryDetails): InventoryPartDto {
  const compatibleModels = mapCompatibilityModels(details);

  return {
    skuId: details.skuId,
    partName: details.partName,
    specifications: buildSpecificationString(details.specifications),
    category: details.category.name,
    quality: details.qualityGrade,
    price: details.wholesalePrice / 100,
    stock: details.stockLevel,
    primaryModel: details.variant?.marketingName,
    compatibleModels: compatibleModels.length > 0 ? compatibleModels : undefined,
  };
}

async function loadInventoryDetails(skuId: string) {
  return prisma.inventory.findUnique({
    where: { skuId },
    include: inventoryInclude,
  }) as Promise<InventoryDetails | null>;
}

export class InventoryService {
  async listInventory(): Promise<InventoryPartDto[]> {
    const inventory = await prisma.inventory.findMany({
      orderBy: {
        skuId: 'asc',
      },
      include: inventoryInclude,
    }) as InventoryDetails[];

    return inventory.map(mapInventoryPart);
  }

  async getInventoryByModel(modelId: number): Promise<InventoryPartDto[]> {
    const inventory = await prisma.inventory.findMany({
      where: {
        OR: [
          {
            variantId: modelId,
          },
          {
            compatibilities: {
              some: {
                variantId: modelId,
              },
            },
          },
        ],
      },
      orderBy: {
        skuId: 'asc',
      },
      include: inventoryInclude,
    }) as InventoryDetails[];

    return inventory.map(mapInventoryPart);
  }

  async getInventoryByVariant(variantId: number): Promise<InventoryPartDto[]> {
    return this.getInventoryByModel(variantId);
  }

  async getInventoryPart(skuId: string): Promise<InventoryPartDto | null> {
    const inventory = await loadInventoryDetails(skuId);

    if (!inventory) {
      return null;
    }

    return mapInventoryPart(inventory);
  }

  async getCompatibilityModels(skuId: string): Promise<ModelDto[] | null> {
    const inventory = await loadInventoryDetails(skuId);

    if (!inventory) {
      return null;
    }

    return mapCompatibilityModels(inventory, true);
  }

  async getInventorySpecifications(skuId: string): Promise<InventorySpecificationDto[] | null> {
    const inventory = await loadInventoryDetails(skuId);

    if (!inventory) {
      return null;
    }

    return inventory.specifications.map((specification) => ({
      label: specification.label,
      value: specification.value,
    }));
  }

  async checkStock(skuId: string): Promise<StockCheckDto | null> {
    const inventory = await prisma.inventory.findUnique({
      where: { skuId },
      select: {
        skuId: true,
        stockLevel: true,
      },
    });

    if (!inventory) {
      return null;
    }

    return {
      skuId: inventory.skuId,
      stock: inventory.stockLevel,
      available: inventory.stockLevel > 0,
    };
  }

  async bulkCheckStock(skuIds: string[]): Promise<StockCheckDto[]> {
    if (skuIds.length === 0) {
      return [];
    }

    const inventory = await prisma.inventory.findMany({
      where: {
        skuId: {
          in: skuIds,
        },
      },
      select: {
        skuId: true,
        stockLevel: true,
      },
      orderBy: {
        skuId: 'asc',
      },
    });

    return inventory.map((item: { skuId: string; stockLevel: number }) => ({
      skuId: item.skuId,
      stock: item.stockLevel,
      available: item.stockLevel > 0,
    }));
  }

  async reserveInventory(skuId: string, quantity: number): Promise<StockCheckDto | null> {
    if (quantity <= 0) {
      throw new Error('Reservation quantity must be greater than zero');
    }

    const inventory = await prisma.inventory.findUnique({
      where: { skuId },
      select: {
        skuId: true,
        stockLevel: true,
      },
    });

    if (!inventory) {
      return null;
    }

    if (inventory.stockLevel < quantity) {
      throw new Error(`Insufficient stock for ${skuId}`);
    }

    const updated = await prisma.inventory.update({
      where: { skuId },
      data: {
        stockLevel: {
          decrement: quantity,
        },
      },
      select: {
        skuId: true,
        stockLevel: true,
      },
    });

    return {
      skuId: updated.skuId,
      stock: updated.stockLevel,
      available: updated.stockLevel > 0,
    };
  }

  async releaseInventory(skuId: string, quantity: number): Promise<StockCheckDto | null> {
    if (quantity <= 0) {
      throw new Error('Release quantity must be greater than zero');
    }

    const inventory = await prisma.inventory.findUnique({
      where: { skuId },
      select: {
        skuId: true,
        stockLevel: true,
      },
    });

    if (!inventory) {
      return null;
    }

    const updated = await prisma.inventory.update({
      where: { skuId },
      data: {
        stockLevel: {
          increment: quantity,
        },
      },
      select: {
        skuId: true,
        stockLevel: true,
      },
    });

    return {
      skuId: updated.skuId,
      stock: updated.stockLevel,
      available: updated.stockLevel > 0,
    };
  }
}

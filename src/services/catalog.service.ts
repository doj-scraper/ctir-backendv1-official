import { prisma } from '../lib/prisma.js';

export interface CatalogBrand {
  id: number;
  name: string;
}

export interface CatalogModel {
  id: number;
  brandId: number;
  modelNumber: string;
  marketingName: string;
  releaseYear: number;
  brand?: CatalogBrand;
}

export interface CatalogHierarchyVariant extends CatalogModel {}

export interface CatalogHierarchyGeneration {
  id: number;
  name: string;
  releaseYear: number | null;
  variants: CatalogHierarchyVariant[];
}

export interface CatalogHierarchyModelType {
  id: number;
  brandId: number;
  name: string;
  generations: CatalogHierarchyGeneration[];
}

export interface CatalogHierarchyBrand extends CatalogBrand {
  modelTypes: CatalogHierarchyModelType[];
}

export interface CatalogPart {
  skuId: string;
  partName: string;
  category: string;
  specifications?: string;
  price: number;
  stock: number;
  quality: string;
  primaryModel?: string;
  compatibleModels?: CatalogModel[];
}

type CatalogVariantRecord = {
  id: number;
  modelNumber: string;
  marketingName: string;
  generation: {
    releaseYear: number | null;
    modelType: {
      brandId: number;
      brand: CatalogBrand;
    };
  };
};

type CatalogCompatibilityRecord = {
  variant: CatalogVariantRecord;
};

type CatalogHierarchyBrandRecord = CatalogBrand & {
  modelTypes: Array<{
    id: number;
    brandId: number;
    name: string;
    generations: Array<{
      id: number;
      name: string;
      releaseYear: number | null;
      variants: CatalogVariantRecord[];
    }>;
  }>;
};

type CatalogInventoryRecord = {
  skuId: string;
  partName: string;
  wholesalePrice: number;
  stockLevel: number;
  qualityGrade: string;
  category: {
    name: string;
  };
  variant: CatalogVariantRecord | null;
  specifications: Array<{ label: string; value: string }>;
  compatibilities: CatalogCompatibilityRecord[];
};

function mapVariantToModel(variant: CatalogVariantRecord): CatalogModel {
  return {
    id: variant.id,
    brandId: variant.generation.modelType.brandId,
    modelNumber: variant.modelNumber,
    marketingName: variant.marketingName,
    releaseYear: variant.generation.releaseYear ?? 0,
    brand: variant.generation.modelType.brand,
  };
}

function buildSpecificationString(
  specifications: Array<{ label: string; value: string }>
): string | undefined {
  if (specifications.length === 0) {
    return undefined;
  }

  return specifications.map(({ label, value }) => `${label}: ${value}`).join(', ');
}

function mapCompatibilityModels(
  compatibilities: CatalogCompatibilityRecord[]
): CatalogModel[] {
  const models = compatibilities.map(({ variant }) => mapVariantToModel(variant));
  const uniqueById = new Map<number, CatalogModel>();

  for (const model of models) {
    uniqueById.set(model.id, model);
  }

  return [...uniqueById.values()];
}

function mapInventoryToPart(item: CatalogInventoryRecord): CatalogPart {
  return {
    skuId: item.skuId,
    partName: item.partName,
    category: item.category.name,
    specifications: buildSpecificationString(item.specifications),
    price: item.wholesalePrice / 100,
    stock: item.stockLevel,
    quality: item.qualityGrade,
    primaryModel: item.variant?.marketingName,
    compatibleModels: item.compatibilities.length > 0
      ? mapCompatibilityModels(item.compatibilities)
      : undefined,
  };
}

export class CatalogService {
  async getBrands(): Promise<CatalogBrand[]> {
    return prisma.brand.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
      },
    });
  }

  async getModels(brandId?: number): Promise<CatalogModel[]> {
    const variants = await prisma.variant.findMany({
      where: brandId
        ? {
            generation: {
              modelType: {
                brandId,
              },
            },
          }
        : undefined,
      orderBy: { marketingName: 'asc' },
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
    }) as CatalogVariantRecord[];

    return variants.map(mapVariantToModel);
  }

  async getHierarchy(): Promise<CatalogHierarchyBrand[]> {
    const brands = await prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: {
        modelTypes: {
          orderBy: { name: 'asc' },
          include: {
            generations: {
              orderBy: { name: 'asc' },
              include: {
                variants: {
                  orderBy: { marketingName: 'asc' },
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
                },
              },
            },
          },
        },
      },
    }) as CatalogHierarchyBrandRecord[];

    return brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
      modelTypes: brand.modelTypes.map((modelType) => ({
        id: modelType.id,
        brandId: modelType.brandId,
        name: modelType.name,
        generations: modelType.generations.map((generation) => ({
          id: generation.id,
          name: generation.name,
          releaseYear: generation.releaseYear,
          variants: generation.variants.map(mapVariantToModel),
        })),
      })),
    }));
  }

  async getPartsForVariant(variantId: number): Promise<CatalogPart[]> {
    const inventory = await prisma.inventory.findMany({
      where: {
        compatibilities: {
          some: {
            variantId,
          },
        },
      },
      include: {
        category: true,
        variant: {
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
        },
        specifications: {
          orderBy: { label: 'asc' },
          select: {
            label: true,
            value: true,
          },
        },
        compatibilities: {
          include: {
            variant: {
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
            },
          },
        },
      },
      orderBy: [
        { partName: 'asc' },
        { skuId: 'asc' },
      ],
    }) as CatalogInventoryRecord[];

    return inventory.map(mapInventoryToPart);
  }

  async searchParts(device: string): Promise<CatalogPart[]> {
    const normalizedDevice = device.trim();

    const inventory = await prisma.inventory.findMany({
      where: {
        OR: [
          {
            partName: {
              contains: normalizedDevice,
              mode: 'insensitive',
            },
          },
          {
            category: {
              name: {
                contains: normalizedDevice,
                mode: 'insensitive',
              },
            },
          },
          {
            variant: {
              is: {
                OR: [
                  {
                    modelNumber: {
                      contains: normalizedDevice,
                      mode: 'insensitive',
                    },
                  },
                  {
                    marketingName: {
                      contains: normalizedDevice,
                      mode: 'insensitive',
                    },
                  },
                  {
                    generation: {
                      name: {
                        contains: normalizedDevice,
                        mode: 'insensitive',
                      },
                    },
                  },
                  {
                    generation: {
                      modelType: {
                        name: {
                          contains: normalizedDevice,
                          mode: 'insensitive',
                        },
                      },
                    },
                  },
                  {
                    generation: {
                      modelType: {
                        brand: {
                          name: {
                            contains: normalizedDevice,
                            mode: 'insensitive',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            compatibilities: {
              some: {
                variant: {
                  OR: [
                    {
                      modelNumber: {
                        contains: normalizedDevice,
                        mode: 'insensitive',
                      },
                    },
                    {
                      marketingName: {
                        contains: normalizedDevice,
                        mode: 'insensitive',
                      },
                    },
                    {
                      generation: {
                        name: {
                          contains: normalizedDevice,
                          mode: 'insensitive',
                        },
                      },
                    },
                    {
                      generation: {
                        modelType: {
                          name: {
                            contains: normalizedDevice,
                            mode: 'insensitive',
                          },
                        },
                      },
                    },
                    {
                      generation: {
                        modelType: {
                          brand: {
                            name: {
                              contains: normalizedDevice,
                              mode: 'insensitive',
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
      include: {
        category: true,
        variant: {
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
        },
        specifications: {
          orderBy: { label: 'asc' },
          select: {
            label: true,
            value: true,
          },
        },
        compatibilities: {
          include: {
            variant: {
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
            },
          },
        },
      },
      orderBy: [
        { partName: 'asc' },
        { skuId: 'asc' },
      ],
    }) as CatalogInventoryRecord[];

    return inventory.map(mapInventoryToPart);
  }
}

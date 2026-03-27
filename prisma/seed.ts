import { PrismaClient, QualityGrade } from "@prisma/client";

const prisma = new PrismaClient();

type VariantSeed = {
  modelNumber: string;
  marketingName: string;
  colorway?: string;
  storage?: string;
};

type HierarchySeed = {
  brand: string;
  modelType: string;
  generation: string;
  releaseYear?: number;
  variants: VariantSeed[];
};

type InventorySeed = {
  skuId: string;
  category: string;
  variantModelNumber?: string;
  partName?: string;
  qualityGrade?: QualityGrade;
  wholesalePrice?: number;
  stockLevel?: number;
  specificationString?: string;
  compatibleModelNumbers?: string[];
};

const hierarchySeed: HierarchySeed[] = [
  {
    brand: "Apple",
    modelType: "iPhone",
    generation: "17 Pro Max",
    releaseYear: 2025,
    variants: [{ modelNumber: "A3257", marketingName: "iPhone 17 Pro Max" }],
  },
  {
    brand: "Apple",
    modelType: "iPhone",
    generation: "17 Pro",
    releaseYear: 2025,
    variants: [{ modelNumber: "A3256", marketingName: "iPhone 17 Pro" }],
  },
  {
    brand: "Apple",
    modelType: "iPhone",
    generation: "17",
    releaseYear: 2025,
    variants: [{ modelNumber: "A3258", marketingName: "iPhone 17" }],
  },
  {
    brand: "Apple",
    modelType: "iPhone",
    generation: "16 Pro Max",
    releaseYear: 2024,
    variants: [{ modelNumber: "A3084", marketingName: "iPhone 16 Pro Max" }],
  },
  {
    brand: "Apple",
    modelType: "iPhone",
    generation: "13",
    releaseYear: 2021,
    variants: [{ modelNumber: "A2482", marketingName: "iPhone 13" }],
  },
  {
    brand: "Apple",
    modelType: "iPhone",
    generation: "14",
    releaseYear: 2022,
    variants: [{ modelNumber: "A2649", marketingName: "iPhone 14" }],
  },
  {
    brand: "Samsung",
    modelType: "Galaxy S",
    generation: "S25 Ultra",
    releaseYear: 2025,
    variants: [{ modelNumber: "SM-S928", marketingName: "Galaxy S25 Ultra" }],
  },
  {
    brand: "Samsung",
    modelType: "Galaxy S",
    generation: "S25",
    releaseYear: 2025,
    variants: [{ modelNumber: "SM-S921", marketingName: "Galaxy S25" }],
  },
  {
    brand: "Samsung",
    modelType: "Galaxy Z",
    generation: "Fold 6",
    releaseYear: 2024,
    variants: [{ modelNumber: "SM-F956", marketingName: "Galaxy Z Fold 6" }],
  },
];

const inventorySeed: InventorySeed[] = [
  {
    skuId: "IF17PrM-3-MOD-BAT",
    category: "Battery",
    variantModelNumber: "A3257",
    partName: "Replacement Battery",
    qualityGrade: QualityGrade.Premium,
    wholesalePrice: 2500,
    stockLevel: 150,
    specificationString: "Type: Lithium-Ion, Adhesive|Capacity: Not specified|Playback: 37 hours",
  },
  {
    skuId: "IF17PrM-3-MOD-CHG",
    category: "Charging Port",
    variantModelNumber: "A3257",
    partName: "Charge Port Assembly",
    qualityGrade: QualityGrade.OEM,
    wholesalePrice: 1800,
    stockLevel: 200,
    specificationString: "Type: USB-C|Specs: USB 3.0",
  },
  {
    skuId: "IF17PrM-3-MOD-CAM",
    category: "Camera",
    variantModelNumber: "A3257",
    partName: "Camera Array",
    qualityGrade: QualityGrade.OEM,
    wholesalePrice: 9500,
    stockLevel: 75,
    specificationString: "Rear: 48MP Fusion Main + 48MP Ultra Wide + 48MP Telephoto|Front: 18MP",
  },
  {
    skuId: "IF16PrM-3-MOD-BAT",
    category: "Battery",
    variantModelNumber: "A3084",
    partName: "Replacement Battery",
    qualityGrade: QualityGrade.Premium,
    wholesalePrice: 2200,
    stockLevel: 120,
    specificationString: "Type: Lithium-Ion, Adhesive|Capacity: 4685 mAh|Playback: 33 hours",
  },
  {
    skuId: "IF13-14-1-DIS-OLED",
    category: "Display",
    partName: "OLED Display Assembly",
    qualityGrade: QualityGrade.Aftermarket,
    wholesalePrice: 4500,
    stockLevel: 300,
    specificationString: "Size: 6.1\"|Type: Super Retina XDR OLED|Refresh Rate: 60Hz|Compatibility: Cross-Compatible",
    compatibleModelNumbers: ["A2482", "A2649"],
  },
  {
    skuId: "SGP25U-3-MOD-BAT",
    category: "Battery",
    variantModelNumber: "SM-S928",
    partName: "Replacement Battery",
    qualityGrade: QualityGrade.Premium,
    wholesalePrice: 2200,
    stockLevel: 180,
    specificationString: "Type: Lithium-Ion|Capacity: 5000 mAh|Fast Charging: 45W",
  },
  {
    skuId: "SZF6-3-MOD-BAT",
    category: "Battery",
    variantModelNumber: "SM-F956",
    partName: "Replacement Battery",
    qualityGrade: QualityGrade.Premium,
    wholesalePrice: 2800,
    stockLevel: 60,
    specificationString: "Type: Lithium-Ion (Dual Cell)|Capacity: 4400 mAh|Fast Charging: 25W",
  },
];

function derivePartNameFromSku(skuId: string, fallbackCategory: string): string {
  const normalized = skuId.toUpperCase();

  if (normalized.endsWith("-BAT")) return "Replacement Battery";
  if (normalized.endsWith("-CHG")) return "Charge Port Assembly";
  if (normalized.endsWith("-CAM")) return "Camera Array";
  if (normalized.includes("-DIS-")) return "Display Assembly";

  return fallbackCategory + " Part";
}

function parseLegacySpecificationString(raw: string | undefined) {
  if (!raw) {
    return [] as Array<{ label: string; value: string; displayOrder: number }>;
  }

  return raw
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment, index) => {
      const separatorIndex = segment.indexOf(":");
      if (separatorIndex === -1) {
        return null;
      }

      const label = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      if (!label || !value) {
        return null;
      }

      return { label, value, displayOrder: index };
    })
    .filter((value): value is { label: string; value: string; displayOrder: number } => Boolean(value));
}

async function upsertHierarchy() {
  const variantIds = new Map<string, number>();

  for (const entry of hierarchySeed) {
    const brand = await prisma.brand.upsert({
      where: { name: entry.brand },
      update: {},
      create: { name: entry.brand },
    });

    const modelType = await prisma.modelType.upsert({
      where: { brandId_name: { brandId: brand.id, name: entry.modelType } },
      update: {},
      create: { brandId: brand.id, name: entry.modelType },
    });

    const generation = await prisma.generation.upsert({
      where: { modelTypeId_name: { modelTypeId: modelType.id, name: entry.generation } },
      update: { releaseYear: entry.releaseYear },
      create: {
        modelTypeId: modelType.id,
        name: entry.generation,
        releaseYear: entry.releaseYear,
      },
    });

    for (const variant of entry.variants) {
      const savedVariant = await prisma.variant.upsert({
        where: { modelNumber: variant.modelNumber },
        update: {
          generationId: generation.id,
          marketingName: variant.marketingName,
          colorway: variant.colorway,
          storage: variant.storage,
        },
        create: {
          generationId: generation.id,
          modelNumber: variant.modelNumber,
          marketingName: variant.marketingName,
          colorway: variant.colorway,
          storage: variant.storage,
        },
      });

      variantIds.set(savedVariant.modelNumber, savedVariant.id);
    }
  }

  return variantIds;
}

async function main() {
  console.log("🌱 Starting Clerk-oriented Smart SKU seed...");

  const categories = ["Battery", "Charging Port", "Camera", "Display"];
  const categoryIds = new Map<string, number>();

  for (const name of categories) {
    const category = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });

    categoryIds.set(name, category.id);
  }

  const variantIds = await upsertHierarchy();

  for (const item of inventorySeed) {
    const categoryId = categoryIds.get(item.category);
    if (!categoryId) {
      throw new Error("Missing category for seed item " + item.skuId);
    }

    const variantId = item.variantModelNumber
      ? variantIds.get(item.variantModelNumber) ?? null
      : null;

    const partName = item.partName ?? derivePartNameFromSku(item.skuId, item.category);

    await prisma.inventory.upsert({
      where: { skuId: item.skuId },
      update: {
        variantId,
        categoryId,
        partName,
        qualityGrade: item.qualityGrade ?? QualityGrade.Aftermarket,
        wholesalePrice: item.wholesalePrice ?? 0,
        stockLevel: item.stockLevel ?? 0,
      },
      create: {
        skuId: item.skuId,
        variantId,
        categoryId,
        partName,
        qualityGrade: item.qualityGrade ?? QualityGrade.Aftermarket,
        wholesalePrice: item.wholesalePrice ?? 0,
        stockLevel: item.stockLevel ?? 0,
      },
    });

    for (const specification of parseLegacySpecificationString(item.specificationString)) {
      await prisma.specification.upsert({
        where: { skuId_label: { skuId: item.skuId, label: specification.label } },
        update: {
          value: specification.value,
          displayOrder: specification.displayOrder,
        },
        create: {
          skuId: item.skuId,
          label: specification.label,
          value: specification.value,
          displayOrder: specification.displayOrder,
        },
      });
    }

    for (const modelNumber of item.compatibleModelNumbers ?? []) {
      const compatibleVariantId = variantIds.get(modelNumber);
      if (!compatibleVariantId) {
        throw new Error("Missing compatible variant " + modelNumber + " for " + item.skuId);
      }

      await prisma.compatibilityMap.upsert({
        where: { skuId_variantId: { skuId: item.skuId, variantId: compatibleVariantId } },
        update: {},
        create: { skuId: item.skuId, variantId: compatibleVariantId },
      });
    }
  }

  const [brandCount, modelTypeCount, generationCount, variantCount, categoryCount, inventoryCount, specificationCount, compatibilityCount] =
    await prisma.$transaction([
      prisma.brand.count(),
      prisma.modelType.count(),
      prisma.generation.count(),
      prisma.variant.count(),
      prisma.category.count(),
      prisma.inventory.count(),
      prisma.specification.count(),
      prisma.compatibilityMap.count(),
    ]);

  console.log("✅ Seed complete");
  console.log("📦 Smart SKU bucket format documented on Inventory.skuId comments (not enforced yet).");
  console.log("📊 Summary:", {
    brands: brandCount,
    modelTypes: modelTypeCount,
    generations: generationCount,
    variants: variantCount,
    categories: categoryCount,
    inventory: inventoryCount,
    specifications: specificationCount,
    compatibilityMappings: compatibilityCount,
  });
}

main()
  .catch((error) => {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

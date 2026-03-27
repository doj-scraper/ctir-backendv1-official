import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const quote = String.fromCharCode(39);
const emptySqlString = quote + quote;
const publicSchema = quote + "public" + quote;
const aftermarket = quote + "Aftermarket" + quote;

type LegacyModelRow = Record<string, unknown> & {
  id?: number | string;
  name?: string;
  marketingName?: string;
  modelNumber?: string;
  brandName?: string;
  releaseYear?: number | null;
};

type HierarchyShape = {
  brand: string;
  modelType: string;
  generation: string;
  marketingName: string;
  modelNumber: string;
  releaseYear?: number | null;
};

function parseLegacySpecificationString(raw: string | null | undefined) {
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

function inferHierarchyFromLegacyModel(row: LegacyModelRow): HierarchyShape {
  const marketingName = String(row.marketingName ?? row.name ?? row.modelNumber ?? "Unknown Device").trim();
  const fallbackModelNumber = "LEGACY-" + String(row.id ?? marketingName.replace(/\s+/g, "-"));
  const modelNumber = String(row.modelNumber ?? fallbackModelNumber).trim();
  const releaseYear = typeof row.releaseYear === "number" ? row.releaseYear : null;

  if (/iphone/i.test(marketingName)) {
    return {
      brand: "Apple",
      modelType: "iPhone",
      generation: marketingName.replace(/^iphone\s*/i, "").trim() || "Unknown",
      marketingName,
      modelNumber,
      releaseYear,
    };
  }

  if (/galaxy\s+z/i.test(marketingName)) {
    return {
      brand: "Samsung",
      modelType: "Galaxy Z",
      generation: marketingName.replace(/^galaxy\s+z\s*/i, "").trim() || "Unknown",
      marketingName,
      modelNumber,
      releaseYear,
    };
  }

  if (/galaxy\s+s/i.test(marketingName)) {
    return {
      brand: "Samsung",
      modelType: "Galaxy S",
      generation: marketingName.replace(/^galaxy\s+/i, "").trim() || "Unknown",
      marketingName,
      modelNumber,
      releaseYear,
    };
  }

  const brand = String(row.brandName ?? marketingName.split(/\s+/)[0] ?? "Unknown").trim() || "Unknown";
  const generation = marketingName.replace(new RegExp("^" + brand + "\\s*", "i"), "").trim() || marketingName;

  return {
    brand,
    modelType: brand,
    generation,
    marketingName,
    modelNumber,
    releaseYear,
  };
}

async function tableExists(tableName: string) {
  const sql = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ${publicSchema} AND table_name = ${quote}${tableName}${quote}) AS "exists"`;
  const result = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(sql);
  return Boolean(result[0]?.exists);
}

async function columnExists(tableName: string, columnName: string) {
  const sql = `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ${publicSchema} AND table_name = ${quote}${tableName}${quote} AND column_name = ${quote}${columnName}${quote}) AS "exists"`;
  const result = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(sql);
  return Boolean(result[0]?.exists);
}

async function backfillInventoryNullables() {
  await prisma.$executeRawUnsafe(
    `UPDATE "Inventory" SET "partName" = COALESCE(NULLIF(BTRIM("partName"), ${emptySqlString}), "skuId") WHERE "partName" IS NULL OR BTRIM("partName") = ${emptySqlString}`,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "Inventory" SET "qualityGrade" = COALESCE("qualityGrade", ${aftermarket}) WHERE "qualityGrade" IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "Inventory" SET "wholesalePrice" = COALESCE("wholesalePrice", 0) WHERE "wholesalePrice" IS NULL`,
  );
}

async function migrateLegacySpecifications() {
  if (!(await columnExists("Inventory", "specifications"))) {
    return;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ skuId: string; specifications: string | null }>>(
    `SELECT "skuId", "specifications" FROM "Inventory" WHERE "specifications" IS NOT NULL AND BTRIM("specifications") <> ${emptySqlString}`,
  );

  for (const row of rows) {
    for (const specification of parseLegacySpecificationString(row.specifications)) {
      await prisma.specification.upsert({
        where: { skuId_label: { skuId: row.skuId, label: specification.label } },
        update: {
          value: specification.value,
          displayOrder: specification.displayOrder,
        },
        create: {
          skuId: row.skuId,
          label: specification.label,
          value: specification.value,
          displayOrder: specification.displayOrder,
        },
      });
    }
  }
}

async function migrateLegacyModels() {
  if (!(await tableExists("Model"))) {
    return;
  }

  const legacyModels = await prisma.$queryRawUnsafe<LegacyModelRow[]>(`SELECT * FROM "Model"`);
  const variantByLegacyId = new Map<number, number>();

  for (const legacyModel of legacyModels) {
    const hierarchy = inferHierarchyFromLegacyModel(legacyModel);

    const brand = await prisma.brand.upsert({
      where: { name: hierarchy.brand },
      update: {},
      create: { name: hierarchy.brand },
    });

    const modelType = await prisma.modelType.upsert({
      where: { brandId_name: { brandId: brand.id, name: hierarchy.modelType } },
      update: {},
      create: { brandId: brand.id, name: hierarchy.modelType },
    });

    const generation = await prisma.generation.upsert({
      where: { modelTypeId_name: { modelTypeId: modelType.id, name: hierarchy.generation } },
      update: { releaseYear: hierarchy.releaseYear ?? undefined },
      create: {
        modelTypeId: modelType.id,
        name: hierarchy.generation,
        releaseYear: hierarchy.releaseYear ?? undefined,
      },
    });

    const variant = await prisma.variant.upsert({
      where: { modelNumber: hierarchy.modelNumber },
      update: { generationId: generation.id, marketingName: hierarchy.marketingName },
      create: {
        generationId: generation.id,
        modelNumber: hierarchy.modelNumber,
        marketingName: hierarchy.marketingName,
      },
    });

    const legacyId = Number(legacyModel.id);
    if (Number.isFinite(legacyId)) {
      variantByLegacyId.set(legacyId, variant.id);
    }
  }

  if (!(await columnExists("Inventory", "modelId"))) {
    return;
  }

  for (const [legacyId, variantId] of Array.from(variantByLegacyId.entries())) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Inventory" SET "variantId" = ${variantId}, "partName" = COALESCE(NULLIF(BTRIM("partName"), ${emptySqlString}), "skuId") WHERE "modelId" = ${legacyId} AND "variantId" IS NULL`,
    );
  }
}

async function main() {
  console.log("🔄 Running schema backfill for partName, specifications, and legacy model hierarchy...");

  await backfillInventoryNullables();
  await migrateLegacySpecifications();
  await migrateLegacyModels();

  const remaining = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM "Inventory" WHERE "partName" IS NULL OR BTRIM("partName") = ${emptySqlString}`,
  );

  console.log("✅ Backfill complete");
  console.log("📦 Smart SKU bucket format remains documentation-only at this stage.");
  console.log("📊 Remaining inventory rows without partName:", Number(remaining[0]?.count ?? 0));
}

main()
  .catch((error) => {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

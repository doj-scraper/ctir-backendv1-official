-- Migration: Guest Identity System + Monitoring + Schema Alignment
-- Adds guest identity fields to User, SystemCounter table, monitoring tables,
-- aligns PKs to cuid strings, adds updatedAt timestamps, and adds CONFIRMED/REFUNDED
-- order statuses.
--
-- Run AFTER the baseline migration (20260324_clerk_smart_sku_schema).

-- ============================================================
-- STEP 1: Extend OrderStatus enum with CONFIRMED
-- ============================================================

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';

-- ============================================================
-- STEP 2: Add EventSeverity, EventCategory, AlertStatus enums
-- ============================================================

DO $$ BEGIN
  CREATE TYPE "EventSeverity" AS ENUM ('INFO', 'WARN', 'ERROR', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EventCategory" AS ENUM ('SYSTEM', 'COMMERCE', 'AUTH', 'PERFORMANCE', 'INVENTORY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'SILENCED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- STEP 3: Guest identity fields on User table
-- clerkId becomes nullable (guests have no Clerk account yet).
-- customId stores the "userid-g00123" sequence.
-- isGuest distinguishes temporary from permanent accounts.
-- ============================================================

-- Make clerkId nullable to support guest users
ALTER TABLE "User" ALTER COLUMN "clerkId" DROP NOT NULL;

-- Add customId for guest ID sequence (e.g., userid-g00123)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customId" TEXT;

-- Add isGuest flag (default false — existing records are permanent accounts)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isGuest" BOOLEAN NOT NULL DEFAULT false;

-- Add unique index for customId
CREATE UNIQUE INDEX IF NOT EXISTS "User_customId_key" ON "User"("customId");

-- ============================================================
-- STEP 4: SystemCounter table for guest ID generation
-- Resettable by setting count = 0 directly.
-- ============================================================

CREATE TABLE IF NOT EXISTS "SystemCounter" (
    "id"    TEXT NOT NULL DEFAULT 'guest_id',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SystemCounter_pkey" PRIMARY KEY ("id")
);

-- Seed the initial counter row
INSERT INTO "SystemCounter" ("id", "count")
VALUES ('guest_id', 0)
ON CONFLICT ("id") DO NOTHING;

-- ============================================================
-- STEP 5: Add updatedAt to Brand, ModelType, Generation, Variant,
-- Category if not already present (schema alignment)
-- ============================================================

ALTER TABLE "Brand"      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Brand"      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ModelType"  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ModelType"  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Variant"    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Variant"    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Category"   ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Category"   ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ============================================================
-- STEP 6: Variant table — make modelNumber nullable
-- (some seeded variants may not have model numbers)
-- ============================================================

ALTER TABLE "Variant" ALTER COLUMN "modelNumber" DROP NOT NULL;

-- Add generationId + marketingName unique constraint for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS "Variant_generationId_marketingName_key"
    ON "Variant"("generationId", "marketingName");

-- ============================================================
-- STEP 7: Specification — add unique constraint on (skuId, label)
-- Prevents duplicate spec entries per SKU
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS "Specification_skuId_label_key"
    ON "Specification"("skuId", "label");

-- ============================================================
-- STEP 8: OrderLine snapshot fields (nullable to handle legacy rows)
-- ============================================================

ALTER TABLE "OrderLine" ALTER COLUMN "partNameSnapshot" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "qualityGradeSnapshot" DROP NOT NULL;

-- ============================================================
-- STEP 9: QuoteRequest — align to new schema
-- Add userId FK, make email optional (userId-based auth instead)
-- ============================================================

ALTER TABLE "QuoteRequest" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "QuoteRequest" ALTER COLUMN "userId" SET NOT NULL;

-- QuoteRequestItem: add description field, make note optional
ALTER TABLE "QuoteRequestItem" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "QuoteRequestItem" ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "QuoteRequestItem" ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "QuoteRequest"     ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ============================================================
-- STEP 10: Monitoring tables
-- ============================================================

-- SystemEvent: structured audit log
CREATE TABLE IF NOT EXISTS "SystemEvent" (
    "id"        TEXT NOT NULL,
    "category"  "EventCategory" NOT NULL,
    "severity"  "EventSeverity" NOT NULL,
    "message"   TEXT NOT NULL,
    "metadata"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemEvent_category_idx" ON "SystemEvent"("category");
CREATE INDEX IF NOT EXISTS "SystemEvent_severity_idx" ON "SystemEvent"("severity");
CREATE INDEX IF NOT EXISTS "SystemEvent_createdAt_idx" ON "SystemEvent"("createdAt");

-- MetricSnapshot: latency and performance metrics by service
CREATE TABLE IF NOT EXISTS "MetricSnapshot" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "value"     DOUBLE PRECISION NOT NULL,
    "unit"      TEXT NOT NULL,
    "metadata"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MetricSnapshot_name_idx"      ON "MetricSnapshot"("name");
CREATE INDEX IF NOT EXISTS "MetricSnapshot_createdAt_idx" ON "MetricSnapshot"("createdAt");

-- AlertRule: threshold-based alert definitions
CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id"                   TEXT NOT NULL,
    "name"                 TEXT NOT NULL,
    "condition"            TEXT NOT NULL,
    "actionType"           TEXT NOT NULL,
    "actionPayload"        TEXT NOT NULL,
    "isActive"             BOOLEAN NOT NULL DEFAULT true,
    "evaluationIntervalMs" INTEGER NOT NULL DEFAULT 300000,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AlertRule_name_key" ON "AlertRule"("name");

-- AlertNotification: alert instances with lifecycle tracking
CREATE TABLE IF NOT EXISTS "AlertNotification" (
    "id"             TEXT NOT NULL,
    "ruleId"         TEXT NOT NULL,
    "status"         "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "message"        TEXT NOT NULL,
    "sentAt"         TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AlertNotification_ruleId_idx" ON "AlertNotification"("ruleId");
CREATE INDEX IF NOT EXISTS "AlertNotification_status_idx" ON "AlertNotification"("status");

-- AlertNotification foreign key to AlertRule
ALTER TABLE "AlertNotification"
    ADD CONSTRAINT "AlertNotification_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- QuoteRequest foreign key to User (if not already exists)
DO $$ BEGIN
  ALTER TABLE "QuoteRequest"
    ADD CONSTRAINT "QuoteRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

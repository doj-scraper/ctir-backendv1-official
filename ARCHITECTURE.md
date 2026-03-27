# CellTech Backend — Architecture

## Overview

The backend is an **Express.js REST API** written in TypeScript, deployed as a **Vercel serverless function** (`api/index.ts`). It uses **Neon PostgreSQL** (via the Neon serverless adapter + Prisma ORM) and **Upstash Redis** for caching. Authentication is fully delegated to **Clerk**; payments are handled by **Stripe**.

---

## Project Structure

```
ctir-backendv1-official/
├── api/
│   └── index.ts               # Vercel serverless entry point
├── prisma/
│   ├── schema.prisma           # Single source of truth for the data model
│   ├── seed.ts                 # Database seeder (hierarchy + Smart SKU inventory)
│   └── migrations/
│       ├── 20260324_clerk_smart_sku_schema/   # Baseline migration
│       └── 20260327_guest_identity_monitoring/ # Guest identity + monitoring
├── src/
│   ├── app.ts                  # Express app factory (middleware + route mounting)
│   ├── index.ts                # HTTP server + graceful shutdown
│   ├── config/
│   │   ├── env.ts              # Zod-validated environment variables
│   │   └── cors.ts             # CORS configuration
│   ├── lib/
│   │   ├── prisma.ts           # Prisma client singleton (Neon adapter)
│   │   ├── redis.ts            # Upstash Redis client + helpers
│   │   ├── clerk.ts            # Clerk SDK helpers (pingClerk)
│   │   ├── stripe.ts           # Stripe client + webhook verification
│   │   ├── auth.ts             # HttpError class + auth types
│   │   ├── health.ts           # Basic health check primitives
│   │   ├── logger.ts           # Pino logger instance
│   │   ├── runtime-cache.ts    # In-process LRU cache (fallback when Redis unavailable)
│   │   └── guest-id.ts         # Guest ID generation (userid-gXXXXX format, resettable)
│   ├── middleware/
│   │   ├── auth.ts             # Clerk auth middleware (requireAuth, optionalAuth, requireRole)
│   │   ├── errorHandler.ts     # Centralised error → JSON response
│   │   ├── metrics.ts          # Request metrics tracking
│   │   ├── rateLimit.ts        # Configurable rate limiter
│   │   └── validate.ts         # Zod schema validation (body / query / params)
│   ├── routes/                 # Thin HTTP layer — validation → service → response
│   ├── services/               # Business logic — one class per domain
│   └── types/
│       ├── api.ts              # ApiResponse, PaginationMeta, etc.
│       └── auth.ts             # Express request augmentation (req.auth, req.user)
```

---

## Data Model

### 4-Level Device Hierarchy

```
Brand → ModelType → Generation → Variant
Apple    iPhone      iPhone 15    iPhone 15 Pro (A3101)
Samsung  Galaxy S    Galaxy S24   Galaxy S24 Ultra (SM-S928B)
```

Every `Variant` has an optional `modelNumber` (e.g. `A3101`) and a required `marketingName`.

### Smart SKU Format

```
[Bucket]-[Subcategory]-[Grade]-[Device]

Examples:
  3-B-O-IP13    → Battery / OEM / iPhone 13
  1-S-O-IP14P   → Screen / OEM / iPhone 14 Pro
  2-C-O-IP13    → Charging Port / OEM / iPhone 13
```

`skuId` is the **primary key** on the `Inventory` table — no surrogate integer ID.

### Quality Grades

| Code | Meaning |
|---|---|
| `OEM` | Original Equipment Manufacturer |
| `Premium` | High-quality aftermarket |
| `Aftermarket` | Standard aftermarket |
| `U` | Unknown / unverified |
| `NA` | Not Applicable |

### Compatibility Mapping

`CompatibilityMap` is a pure junction table with a **composite primary key** `(skuId, variantId)`. A single SKU can be compatible with multiple variants (e.g., a Lightning port compatible with all four iPhone 13 variants).

### Prices

All monetary values are stored as **cents (Int)**.  
`wholesalePrice = 0` is the sentinel for "Contact for Price" — never display `$0.00` to the customer.

---

## Authentication & Identity

### Clerk (Primary)

```
Frontend (Clerk session) → Bearer JWT → Clerk SDK (authMiddleware)
  → req.auth.userId → prisma.user.findUnique({ where: { clerkId } })
  → req.user = { id, email, role, clerkId }
```

`clerkId` on the `User` model is **nullable** to support guest users.

### Guest Identity

When a user checks out without a Clerk account:

1. Backend looks up `User` by email.
2. If no record → creates a `User` with `isGuest: true` and a generated `customId` (e.g. `userid-g00042`).
3. `customId` is returned to the frontend for order tracking (`/checkout/success`).
4. When the guest later registers via Clerk → `user.created` webhook fires → backend finds the matching email, sets `clerkId`, flips `isGuest = false`. **All order history is preserved.**

### Guest ID Counter

The `SystemCounter` table holds a single `"guest_id"` row. Each guest checkout atomically increments `count` and pads it to 5 digits. The counter is **resettable** — just `UPDATE "SystemCounter" SET count = 0 WHERE id = 'guest_id'` (or call `resetGuestIdCounter()` from `src/lib/guest-id.ts`).

### Middleware Stack

```
Request
  → cors
  → express.raw (Stripe + Clerk webhook routes only)
  → express.json
  → requestMetrics
  → authMiddleware (Clerk — populates req.auth on all routes)
  → route handler
      → requireAuth (throws 401 if no Clerk session)
      → requireRole('ADMIN') (throws 403 if wrong role)
  → errorHandler
```

---

## Key Services

| Service | Responsibility |
|---|---|
| `CatalogService` | Brand/model hierarchy queries, part search, hierarchy tree |
| `InventoryService` | SKU lookup, stock checks, specs, bulk check, compatibility |
| `CartService` | Add/update/remove/clear/validate/sync cart items |
| `CheckoutService` | Create Stripe PaymentIntent, create Order + OrderLines, handle webhook events |
| `OrderService` | Order history, order detail, status transitions |
| `QuoteService` | RFQ creation and lookup |
| `UserService` | Profile read/update |
| `HealthService` | Detailed service health (DB, Redis, Clerk, Stripe) with latency |
| `MetricsService` | Record + query MetricSnapshot, request stats, cleanup |
| `AlertService` | CRUD alert rules, acknowledge/resolve notifications |
| `EventLoggerService` | Write structured SystemEvent records |

---

## Health Dashboard

`GET /api/health/detailed` (ADMIN only) returns:

```json
{
  "status": "DEGRADED",
  "timestamp": "2026-03-27T05:00:00Z",
  "environment": "production",
  "services": {
    "database": { "name": "PostgreSQL (Prisma)", "status": "UP", "latencyMs": 42, "message": "Connected" },
    "cache":    { "name": "Redis (Upstash)",     "status": "UP", "latencyMs": 14, "message": "Connected" },
    "auth":     { "name": "Clerk API",           "status": "UP", "latencyMs": 850, "message": "High latency detected" },
    "payments": { "name": "Stripe API",          "status": "DOWN", "latencyMs": null, "message": "Connection timeout" }
  }
}
```

**Status logic:**
- 🟢 `UP` + latency < 500ms → GREEN
- 🟡 `UP` + latency ≥ 500ms → YELLOW (high latency)
- 🔴 `DOWN` → RED

---

## Caching Strategy

Redis (Upstash) is used for:
- Catalog queries (brands, models, hierarchy)
- Inventory lookups

Cache degrades gracefully — if Redis is unavailable, an in-process `runtime-cache.ts` (LRU) is used as fallback. The API never fails due to a missing Redis connection.

---

## Error Handling

All errors flow through `src/middleware/errorHandler.ts`. The `HttpError` class (`src/lib/auth.ts`) carries a `statusCode` and `code` string.

Standard error response shape:
```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

Prisma `P2025` (not found) and `P2002` (unique constraint) are mapped to 404 and 409 respectively.

---

## Observability Stack

```
SystemEvent      → Structured audit log (AUTH, COMMERCE, SYSTEM, PERFORMANCE, INVENTORY)
MetricSnapshot   → Latency time-series by service name
AlertRule        → Threshold-based alert definitions with cooldown
AlertNotification → Alert instances with lifecycle (ACTIVE → ACKNOWLEDGED → RESOLVED)
```

All monitoring data is queryable via `/api/monitoring/*`.

---

## Deployment Architecture

```
GitHub (main branch)
  → Vercel CI
  → prisma generate + tsc
  → Vercel Serverless Function (api/index.ts)
       ↓
  Neon PostgreSQL (serverless, connection pooling)
  Upstash Redis (HTTP-based, serverless-compatible)
  Clerk (auth — edge network)
  Stripe (payments)
```

Vercel routes all `/*` requests to `api/index.ts`, which calls `createApp()` from `src/app.ts`.

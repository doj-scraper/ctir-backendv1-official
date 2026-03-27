# AGENTS.md — AI Agent Guidelines for `ctir-backendv1-official`

This document provides context and rules for AI coding agents (Rovo Dev, GitHub Copilot, etc.) working in this repository.

---

## Repository Purpose

This is the **CellTech wholesale parts distribution backend**. It is a production Express.js REST API deployed on Vercel, backed by Neon PostgreSQL and Upstash Redis. Authentication is handled entirely by **Clerk** — there are no passwords, sessions, or NextAuth artifacts in this codebase.

---

## Critical Conventions — Read Before Making Changes

### 1. Prices are Always Cents (Int)

**Never use `Float` for monetary values.** All prices (`wholesalePrice`, `unitPriceAtPurchase`, `totalCents`) are stored as `Int` in the database representing **cents**.

- `wholesalePrice = 0` means **"Contact for Price"** — never render `$0.00`.
- Divide by 100 only at the presentation layer (frontend).

### 2. `skuId` is the Inventory Primary Key

The `Inventory` model uses `skuId String @id` — the Smart SKU string IS the primary key. There is no separate `id` column on `Inventory`. Queries must use `where: { skuId: "..." }`.

### 3. Smart SKU Format

```
[Bucket]-[Subcategory]-[Grade]-[Device]
Example: 3-B-O-IP13 (Battery / OEM / iPhone 13)
```

This is a string identifier only — the backend does not parse or validate the format segments at runtime.

### 4. Clerk Auth — `clerkId` is Nullable

`User.clerkId` is `String? @unique` — it is **nullable** for guest users. Do not assume `clerkId` is always set. Use `where: { clerkId }` only when you know the user is a registered Clerk user.

### 5. Guest Identity Flow

```
Guest checkout → generateGuestId() → userid-g00042
  → User created with isGuest: true, clerkId: null
  → Later: Clerk webhook user.created → merge by email → clerkId set, isGuest: false
```

The merge logic lives in `src/routes/webhooks.routes.ts`. Never create a duplicate user — always check by email first.

### 6. Response Shape

Every route returns this envelope:

```typescript
{ success: boolean, data?: T, error?: string, meta?: PaginationMeta }
```

Use `next(error)` for error propagation — never `res.status(500).send(...)` directly from a route handler (except in the error handler itself).

### 7. Field Names — Use These Exactly

| ❌ Old (do not use) | ✅ Current |
|---|---|
| `unitPrice` / `price` | `wholesalePrice` (Int, cents) |
| `quantity` (on Inventory) | `stockLevel` |
| `pricePerUnit` | `unitPriceAtPurchase` (Int, cents) |
| `totalPrice` | `totalCents` (Int, cents) |
| `inventoryId` (FK) | `skuId` (FK — points to `Inventory.skuId`) |
| `key` (on Specification) | `label` |
| `externalId` | `clerkId` |

---

## Architecture Boundaries

| Layer | Rule |
|---|---|
| **Routes** | Validation (Zod) → call service → return response. No business logic here. |
| **Services** | All business logic lives here. Services call Prisma, Redis, Stripe, Clerk. |
| **Middleware** | Auth, error handling, rate limiting, metrics only. |
| **Lib** | Singleton clients (Prisma, Redis, Stripe, Clerk, Logger). No business logic. |

---

## What NOT to Do

- ❌ Do not add `password`, `passwordHash`, `Account`, or `Session` models — Clerk handles all of this.
- ❌ Do not add a surrogate `id` column to `Inventory` — `skuId` is the PK.
- ❌ Do not use `Float` for prices — use `Int` (cents).
- ❌ Do not use `variantId` as a direct FK on `Inventory` — use `CompatibilityMap`.
- ❌ Do not render `$0.00` — treat `wholesalePrice === 0` as "Contact for Price".
- ❌ Do not skip the Svix signature check on Clerk webhooks.
- ❌ Do not skip the Stripe signature check on Stripe webhooks.
- ❌ Do not call `prisma.$disconnect()` in route handlers — the singleton manages the connection.

---

## Adding a New Route

1. Create `src/routes/my-feature.routes.ts` — thin handler, Zod validation, call service.
2. Create `src/services/my-feature.service.ts` — business logic class.
3. Mount in `src/app.ts`: `app.use('/api/my-feature', myFeatureRoutes)`.
4. Add the route to `README.md` API reference table.
5. Add a test in `src/__tests__/my-feature.routes.test.ts`.

## Adding a New Schema Model

1. Edit `prisma/schema.prisma`.
2. Run `npm run prisma:migrate` to generate a migration file.
3. Run `npm run prisma:generate` to regenerate the Prisma client.
4. Update `ARCHITECTURE.md` if the model is significant.
5. Update `prisma/seed.ts` if sample data is needed.

---

## Testing

Tests live in `src/__tests__/` and use **Vitest**. Mock Prisma and external services — never call real external APIs in tests.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

---

## Environment Variables

All env vars are validated at startup via Zod in `src/config/env.ts`. If a required variable is missing, the server **will not start**. Add new env vars there first, then to `.env.example`.

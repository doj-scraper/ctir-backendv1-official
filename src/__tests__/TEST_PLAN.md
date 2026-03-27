# Backend Reset — Comprehensive Test Plan

**Tester:** Saul  
**Created:** 2026-03-24  
**Status:** Anticipatory (built while implementation is in progress)  
**Framework:** Vitest  
**Risk Level:** High — Full backend rewrite with backwards compatibility requirements

---

## Overview

This test plan covers all 6 phases of the backend reset:
1. Schema & Seed validation
2. Core infrastructure (env, error handling, middleware)
3. Catalog & inventory endpoints (backwards compatible)
4. Authentication & authorization
5. Commerce (cart, checkout, orders, Stripe)
6. Integration & deployment

### Backwards Compatibility Targets

The new backend **must** preserve the response shape of 6 existing endpoints:
- `GET /api/parts?device={string}` — Search by device name
- `GET /api/inventory/:skuId` — Get part by SKU
- `GET /api/compatibility/:skuId` — Get compatible models
- `GET /api/brands` — List all brands
- `GET /api/models?brandId={int}` — List models (filtered by brand)
- `GET /api/health` — Health check

### Data Migration Requirements

The new schema transforms:
- **Flat models** → **4-level hierarchy** (Brand → ModelType → Generation → Variant)
- **9 old models** → **9 new variants** (data preserved)
- **Pipe-delimited specifications** → **Specification table** (structured)
- **CompatibilityMap id** → **Composite key** (no auto-increment)
- **Nullable price/quality** → **Defaults enforced** (wholesalePrice default 0, qualityGrade default Aftermarket)

---

## Phase 1: Schema & Seed Tests

| ID | Description | Priority | Dependencies | Edge Cases |
|----|-------------|----------|--------------|------------|
| **S1.1** | Prisma schema validates (`prisma validate`) | P0 | None | Invalid types, missing relations |
| **S1.2** | Seed runs without errors on empty database | P0 | S1.1 | Constraint violations, type mismatches |
| **S1.3** | Seed runs idempotently (can run twice without errors) | P0 | S1.2 | Upsert conflicts, duplicate keys |
| **S1.4** | All 4 hierarchy levels exist after seed: Brand → ModelType → Generation → Variant | P0 | S1.3 | Missing relationships, orphaned records |
| **S1.5** | All original data preserved: 2 brands (Apple, Samsung) | P0 | S1.3 | Brand names differ, count mismatch |
| **S1.6** | All 9 models migrated as variants with correct hierarchy | P0 | S1.4 | Data loss, incorrect parent references |
| **S1.7** | All 4 categories preserved: Battery, Charging Port, Camera, Display | P0 | S1.3 | Category names differ, count mismatch |
| **S1.8** | All 7+ inventory items exist with non-zero stock | P0 | S1.3 | Missing items, zero stock defaults |
| **S1.9** | 2 compatibility mappings exist (IF13-14 cross-compatible screen) | P0 | S1.3 | Missing mappings, incorrect relationships |
| **S1.10** | Nullable fixes enforced: `wholesalePrice` has default 0 | P1 | S1.3 | NULL values allowed, default not applied |
| **S1.11** | Nullable fixes enforced: `qualityGrade` has default Aftermarket | P1 | S1.3 | NULL values allowed, default not applied |
| **S1.12** | Nullable fixes enforced: `partName` required (non-nullable) | P1 | S1.3 | NULL values allowed, validation missing |
| **S1.13** | Specification table contains parsed data from old pipe-delimited strings | P1 | S1.3 | Empty specs, unparsed strings, incorrect parsing |
| **S1.14** | CompatibilityMap uses composite key `@@unique([skuId, compatibleModelId])` | P1 | S1.3 | Auto-increment id exists, duplicates allowed |
| **S1.15** | QualityGrade enum includes: OEM, Premium, Aftermarket, U, NA | P1 | S1.3 | Missing enum values, incorrect casing |
| **S1.16** | Role enum includes: BUYER, ADMIN | P1 | S1.3 | Missing enum values, extra values |
| **S1.17** | OrderStatus enum includes: PENDING, PAID, SHIPPED, DELIVERED, CANCELLED | P1 | S1.3 | Missing enum values, incorrect names |

### Edge Cases (Phase 1)
- **Seed on existing data:** Should upsert, not create duplicates
- **Orphaned records:** Variants without Generation, Generation without ModelType, etc.
- **Case sensitivity:** Brand names should be case-insensitive unique
- **Specification parsing:** Handle edge cases like empty strings, missing pipes, extra pipes

---

## Phase 2: Core Infrastructure Tests

| ID | Description | Priority | Dependencies | Edge Cases |
|----|-------------|----------|--------------|------------|
| **I2.1** | Zod env validation rejects missing required variables | P0 | None | Partial env, empty strings |
| **I2.2** | Zod env validation accepts valid configuration | P0 | I2.1 | All required + optional vars present |
| **I2.3** | Zod env validation applies defaults for optional variables | P1 | I2.1 | Missing optional vars use defaults |
| **I2.4** | PrismaClient singleton returns same instance on multiple imports | P0 | None | Multiple client instances, memory leak |
| **I2.5** | Express app factory returns configured Express app | P0 | None | Missing middleware, incorrect config |
| **I2.6** | Error handler: Zod validation errors return 400 with field details | P0 | None | Generic error message, missing fields |
| **I2.7** | Error handler: Prisma P2002 (unique constraint) returns 409 Conflict | P0 | None | 500 instead of 409, missing detail |
| **I2.8** | Error handler: Prisma P2025 (not found) returns 404 Not Found | P0 | None | 500 instead of 404, generic message |
| **I2.9** | Error handler: Unknown errors return 500 Internal Server Error | P0 | None | Exposing stack traces, leaking internals |
| **I2.10** | Validation middleware rejects invalid request body (Zod) | P0 | None | Accepts invalid data, missing validation |
| **I2.11** | Validation middleware passes valid request body to handler | P0 | I2.10 | Blocks valid requests, modifies data |
| **I2.12** | Health endpoint returns 200 with timestamp | P0 | None | Wrong status code, missing timestamp |
| **I2.13** | Health endpoint includes database connectivity check | P1 | I2.12 | Returns 200 even if DB is down |
| **I2.14** | Logger outputs structured JSON in production mode | P1 | None | Pretty logs in production, missing fields |
| **I2.15** | Logger outputs pretty format in development mode | P2 | None | JSON in dev, hard to read |

### Edge Cases (Phase 2)
- **Environment variables:** Empty strings should fail validation (not treated as valid)
- **Error stack traces:** Should NOT be exposed in production responses
- **Database health:** Should timeout gracefully (not hang forever)
- **Concurrent requests:** Multiple simultaneous requests should share Prisma instance

---

## Phase 3: Catalog & Inventory Tests

| ID | Description | Priority | Dependencies | Edge Cases |
|----|-------------|----------|--------------|------------|
| **C3.1** | `GET /api/brands` returns all brands sorted by name (asc) | P0 | S1.5 | Empty result, unsorted |
| **C3.2** | `GET /api/models?brandId=X` filters by brand (backwards compatible shape) | P0 | S1.6 | Wrong brand, no results, invalid brandId |
| **C3.3** | `GET /api/models` (no query) returns all models | P1 | S1.6 | Empty result, missing models |
| **C3.4** | `GET /api/parts?device=iPhone` searches across hierarchy (backwards compatible) | P0 | S1.4, S1.8 | Case sensitivity, partial match, no results |
| **C3.5** | `GET /api/parts?device=Galaxy` finds Samsung devices | P0 | S1.8 | No results, wrong brand |
| **C3.6** | `GET /api/parts` (missing device param) returns 400 Bad Request | P0 | None | Returns 200, empty array |
| **C3.7** | `GET /api/inventory/:skuId` returns part with specifications and compatibility | P0 | S1.8, S1.13 | Invalid SKU, missing specs |
| **C3.8** | `GET /api/inventory/:skuId` for invalid SKU returns 404 Not Found | P0 | None | Returns 500, returns empty object |
| **C3.9** | `GET /api/compatibility/:skuId` returns compatible variants (hierarchy-aware) | P0 | S1.9 | No compatibilities, direct part only |
| **C3.10** | `GET /api/compatibility/:skuId` for direct part returns primary model | P0 | S1.8 | Returns 404, missing primary model |
| **C3.11** | Pagination on list endpoints (page, perPage query params) | P1 | C3.1 | Invalid page numbers, negative values |
| **C3.12** | Empty result sets return proper shape: `{ success: true, count: 0, items: [] }` | P1 | None | Returns null, returns 404 |
| **C3.13** | Search is case-insensitive (iPhone = iphone = IPHONE) | P0 | C3.4 | Case-sensitive search fails |
| **C3.14** | Search handles partial matches ("iPhone 17" matches "iPhone 17 Pro Max") | P1 | C3.4 | Exact match only, no results |
| **C3.15** | Cross-compatible parts appear in search for all compatible models | P0 | S1.9, C3.4 | Missing from some models, appears for wrong models |

### Edge Cases (Phase 3)
- **Special characters in search:** Should handle quotes, apostrophes, hyphens
- **Empty device name:** Should return 400, not 500
- **Invalid SKU format:** Should return 404, not crash
- **Multiple compatibility mappings:** Should return all compatible models
- **Price formatting:** wholesalePrice stored in cents, returned in dollars

---

## Phase 4: Auth Tests

| ID | Description | Priority | Dependencies | Edge Cases |
|----|-------------|----------|--------------|------------|
| **A4.1** | `POST /api/auth/register` creates user with hashed password | P0 | None | Password stored as plaintext, weak hash |
| **A4.2** | `POST /api/auth/register` rejects duplicate email (409 Conflict) | P0 | A4.1 | Allows duplicates, crashes |
| **A4.3** | `POST /api/auth/register` validates email format (Zod) | P0 | None | Accepts invalid emails, allows empty |
| **A4.4** | `POST /api/auth/register` enforces password complexity requirements | P1 | None | Accepts weak passwords, no validation |
| **A4.5** | `POST /api/auth/login` returns JWT token for valid credentials | P0 | A4.1 | No token, wrong format, expired token |
| **A4.6** | `POST /api/auth/login` rejects invalid credentials (401 Unauthorized) | P0 | A4.1 | Returns 200, leaks user existence |
| **A4.7** | `POST /api/auth/login` compares hashed password (not plaintext) | P0 | A4.1 | Plaintext comparison, timing attack |
| **A4.8** | `POST /api/auth/logout` blacklists token in Redis | P0 | A4.5 | Token still works, no blacklist |
| **A4.9** | Protected routes reject requests with missing Authorization header (401) | P0 | None | Allows unauthenticated access |
| **A4.10** | Protected routes reject expired tokens (401 Unauthorized) | P0 | A4.5 | Accepts expired tokens, no expiry check |
| **A4.11** | Protected routes reject blacklisted tokens (401 Unauthorized) | P0 | A4.8 | Accepts blacklisted tokens, no Redis check |
| **A4.12** | Protected routes reject malformed tokens (401 Unauthorized) | P0 | None | Crashes, returns 500 |
| **A4.13** | Rate limiting: 429 Too Many Requests after threshold | P1 | None | No rate limiting, unlimited requests |
| **A4.14** | Role-based access: ADMIN-only routes reject BUYER tokens (403 Forbidden) | P0 | None | Allows access, no role check |
| **A4.15** | Password hashing: stored hash ≠ plaintext (verify with bcrypt.compare) | P0 | A4.1 | Plaintext storage, reversible hash |
| **A4.16** | JWT includes userId and role claims | P0 | A4.5 | Missing claims, wrong claims |
| **A4.17** | JWT is signed with secret (verify signature) | P0 | A4.5 | Unsigned token, wrong secret |

### Edge Cases (Phase 4)
- **Timing attacks:** Login should take same time for valid/invalid users
- **Token expiry:** Should reject tokens 1 second after expiry, not 1 second before
- **Redis down:** Should fail closed (reject all requests), not fail open
- **Password hash cost:** Should use bcrypt cost ≥ 10 (not too fast)
- **Email case sensitivity:** Should be case-insensitive (user@example.com = USER@EXAMPLE.COM)

---

## Phase 5: Commerce Tests

| ID | Description | Priority | Dependencies | Edge Cases |
|----|-------------|----------|--------------|------------|
| **M5.1** | `POST /api/cart` adds item to cart (creates or increments quantity) | P0 | A4.1, S1.8 | Negative quantity, zero quantity |
| **M5.2** | `POST /api/cart` enforces `@@unique([userId, skuId])` (upserts, not duplicates) | P0 | M5.1 | Allows duplicates, creates multiple rows |
| **M5.3** | `POST /api/cart` rejects invalid skuId (404 Not Found) | P0 | None | Accepts invalid SKU, crashes |
| **M5.4** | `POST /api/cart` requires authentication (401 if not logged in) | P0 | M5.1 | Allows unauthenticated cart access |
| **M5.5** | `GET /api/cart` returns user's cart with item details | P0 | M5.1 | Returns other users' carts, missing details |
| **M5.6** | `GET /api/cart` for empty cart returns `{ success: true, items: [] }` | P1 | None | Returns 404, returns null |
| **M5.7** | `DELETE /api/cart/:skuId` removes item from cart | P0 | M5.1 | Removes from other users' carts, doesn't delete |
| **M5.8** | `DELETE /api/cart/:skuId` for non-existent item returns 404 | P0 | None | Returns 200, doesn't fail |
| **M5.9** | `POST /api/checkout` creates Stripe PaymentIntent with correct amount | P0 | M5.1 | Wrong amount, wrong currency |
| **M5.10** | `POST /api/checkout` snapshots `unitPriceAtPurchase` from current price | P0 | M5.9 | Uses live price, no snapshot |
| **M5.11** | `POST /api/checkout` creates Order with status PENDING | P0 | M5.9 | Wrong status, no order created |
| **M5.12** | `POST /api/checkout` creates OrderLine for each cart item | P0 | M5.9 | Missing lines, wrong quantities |
| **M5.13** | `POST /api/checkout` clears cart after order created | P1 | M5.9 | Cart not cleared, items duplicated |
| **M5.14** | `POST /api/checkout` for empty cart returns 400 Bad Request | P0 | None | Creates empty order, crashes |
| **M5.15** | `GET /api/orders` returns user's orders (sorted by createdAt desc) | P0 | M5.11 | Returns other users' orders, unsorted |
| **M5.16** | `GET /api/orders/:id` returns order with lines (includes product details) | P0 | M5.11 | Missing lines, missing product info |
| **M5.17** | `GET /api/orders/:id` for other user's order returns 403 Forbidden | P0 | M5.16 | Allows access to other users' orders |
| **M5.18** | Order status transitions: PENDING → PAID → SHIPPED → DELIVERED | P0 | M5.11 | Invalid transitions, missing states |
| **M5.19** | Order status transitions: cannot go backwards (PAID → PENDING = error) | P1 | M5.18 | Allows backwards transition, no validation |
| **M5.20** | Stripe webhook: `payment_intent.succeeded` updates order to PAID | P0 | M5.11 | Order not updated, wrong status |
| **M5.21** | Stripe webhook: validates signature (rejects invalid webhooks) | P0 | M5.20 | Accepts forged webhooks, no validation |
| **M5.22** | Stripe webhook: idempotent (can receive same event twice) | P1 | M5.20 | Processes twice, duplicates state |
| **M5.23** | Price snapshot: changing inventory price doesn't affect existing orders | P0 | M5.10 | Uses live price, wrong amount billed |

### Edge Cases (Phase 5)
- **Concurrent cart updates:** Two simultaneous adds should increment, not overwrite
- **Out of stock:** Should checkout succeed even if stock becomes 0? (business decision)
- **Negative prices:** Should reject or clamp to 0
- **Stripe errors:** Should return 500 with safe error message, not expose Stripe internals
- **Webhook replay attacks:** Should use Stripe signature + timestamp validation
- **Order total calculation:** Sum of lines should match Stripe amount (test for rounding errors)

---

## Phase 6: Integration / Deployment Tests

| ID | Description | Priority | Dependencies | Edge Cases |
|----|-------------|----------|--------------|------------|
| **D6.1** | TypeScript compiles without errors (`tsc --noEmit`) | P0 | All phases | Type errors, missing types |
| **D6.2** | All imports resolve (no missing modules) | P0 | D6.1 | Module not found, wrong paths |
| **D6.3** | Vercel build succeeds (`vercel build` or equivalent) | P0 | D6.1 | Build fails, missing dependencies |
| **D6.4** | No circular dependencies (static analysis) | P1 | D6.1 | Circular imports, runtime errors |
| **D6.5** | `.env.example` documents all required environment variables | P0 | None | Missing vars, undocumented secrets |
| **D6.6** | Production build size is reasonable (< 10MB) | P2 | D6.3 | Huge bundle, unused dependencies |
| **D6.7** | All tests pass in CI environment | P0 | All phases | CI-only failures, flaky tests |
| **D6.8** | Database migrations apply cleanly from empty state | P0 | S1.1 | Migration fails, manual intervention needed |
| **D6.9** | API responds to requests within 500ms (p95 latency) | P2 | All phases | Slow queries, N+1 problems |

---

## Regression Risks

**High Risk:**
- **Search backwards compatibility:** New hierarchy must produce same results as old flat models
- **Price calculations:** Stored in cents, returned in dollars — off-by-100 errors likely
- **Specification parsing:** Pipe-delimited → structured — parser bugs will surface
- **Compatibility mappings:** Composite key change — existing queries may break

**Medium Risk:**
- **Auth token format:** JWT claims must match what frontend expects
- **Order snapshots:** If price snapshot logic fails, orders will charge wrong amounts later
- **Idempotency:** Seed and webhooks must be truly idempotent (not just "works the first time")

**Low Risk:**
- **Enum casing:** QualityGrade = "OEM" vs "Oem" — case sensitivity issues
- **Empty result sets:** Should return `{ items: [] }` not `null` — frontend may crash
- **Pagination edge cases:** Last page, page beyond total, page 0

---

## Test Data Requirements

- **Users:**
  - BUYER role: `buyer@example.com` / `password123`
  - ADMIN role: `admin@example.com` / `admin123`
  
- **Inventory:**
  - 2 brands (Apple, Samsung)
  - 9 variants across 4 hierarchy levels
  - 7+ inventory items with varied stock levels
  - 2 cross-compatible parts (IF13-14 screen)

- **Orders:**
  - At least 1 order in each status (PENDING, PAID, SHIPPED, DELIVERED, CANCELLED)
  - Orders with multiple lines
  - Order where price changed after purchase (snapshot test)

- **Edge Cases:**
  - Empty cart
  - Out-of-stock item
  - Invalid SKU
  - Expired JWT
  - Blacklisted JWT

---

## Test Execution Strategy

1. **Unit Tests:** Infrastructure (env, errors, middleware) — fast, isolated
2. **Integration Tests:** Endpoints with real Prisma + test DB — slower, realistic
3. **E2E Tests:** Full flows (register → login → add to cart → checkout) — slowest, most valuable

**Test Database:**
- Use separate test DB (not production!)
- Reset before each test suite
- Seed minimal data (not full production seed)

**Mocking Strategy:**
- Mock Stripe API (use fixtures, not real API calls)
- Mock Redis (use in-memory implementation for tests)
- Do NOT mock Prisma (use real test DB for integration tests)

**CI/CD:**
- Run all tests on every PR
- Fail build on any test failure
- Run linter before tests (fail fast)

---

## Priority Definitions

- **P0 (Critical):** Must pass before ANY deployment. Failure = production outage.
- **P1 (High):** Must pass before release. Failure = broken feature or security issue.
- **P2 (Medium):** Should pass. Failure = degraded experience or tech debt.

---

## Test Coverage Goals

- **Statements:** ≥ 80%
- **Branches:** ≥ 75%
- **Functions:** ≥ 80%
- **Lines:** ≥ 80%

Focus coverage on:
- Auth logic (100% — security-critical)
- Price calculations (100% — money is involved)
- Error handlers (100% — prevents 500s)
- Validation middleware (≥ 90%)

Lower priority for:
- Static content routes
- Health check endpoints
- Logging utilities

---

## Checklist Before Deployment

- [ ] All P0 tests pass
- [ ] All P1 tests pass
- [ ] TypeScript compiles without errors
- [ ] No circular dependencies detected
- [ ] `.env.example` is up to date
- [ ] Database migrations tested on staging
- [ ] Vercel build succeeds
- [ ] Manual smoke test: register → login → search → checkout
- [ ] Backwards compatibility verified: old endpoints return same shape
- [ ] Performance: p95 latency < 500ms

---

**End of Test Plan**

**Next Steps:**
1. Implement test stubs (health, env, middleware)
2. Wait for Linus to finalize infrastructure routes
3. Write actual test implementations
4. Run full test suite against staging
5. Fix any failures
6. Deploy to production with confidence

**If it can break, assume it eventually will. Test everything.**  
— Saul, Tester

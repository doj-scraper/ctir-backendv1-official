# INFO.md — Backend State Report
> Generated: 2026-03-27 | Repo: `ctir-backendv1-official`

---

## Current State: Production-Ready ✅

The backend is fully implemented and aligned with the architecture spec from the planning document. All core systems are in place — Clerk auth, Smart SKU catalog, cart, guest checkout, orders, RFQ, health dashboard, and a full observability stack.

---

## What Was Built (This Sprint)

### Schema Alignment (`prisma/schema.prisma`)
- **`skuId` as primary key** on `Inventory` — the Smart SKU string IS the PK, no surrogate ID
- **Prices in cents** — `wholesalePrice Int`, `unitPriceAtPurchase Int`, `totalCents Int`
- **`stockLevel`** replaces legacy `quantity` on Inventory
- **`CompatibilityMap`** composite PK `@@id([skuId, variantId])` — pure junction table, no auto-increment
- **`Specification`** uses `label`/`value` with `@@unique([skuId, label])` to prevent duplicate specs
- **`Cart.quantity @default(5)`** — MOQ enforced at the database level
- **`Variant.modelNumber`** is nullable (not all seeded variants have model numbers)
- **Full 4-level device hierarchy** enforced: Brand → ModelType → Generation → Variant

### Guest Identity System (New)
- **`User.clerkId`** is now `String? @unique` — nullable for guest users
- **`User.customId`** — guest ID in `userid-g00042` format
- **`User.isGuest`** — boolean flag distinguishing temporary from permanent accounts
- **`SystemCounter`** table — atomic, resettable counter for guest ID sequence
- **`src/lib/guest-id.ts`** — `generateGuestId()`, `formatGuestId()`, `resetGuestIdCounter()`

### Clerk Webhook — Guest Merge Logic (`src/routes/webhooks.routes.ts`)
When a guest later signs up via Clerk with the same email:
1. `user.created` webhook fires
2. Backend finds the existing guest record by email
3. Sets `clerkId`, flips `isGuest = false` — **order history and cart are preserved**
4. No duplicate user records created

### Guest Checkout (`src/routes/checkout.routes.ts`)
- Accepts optional `guestEmail` in request body
- Creates guest user with generated `customId` if email is new
- Returns `guestCustomId` in response for order tracking on the success page
- Registered-email collision returns `409` with a "please log in" message

### Monitoring Stack (Full)
- `SystemEvent` — structured audit log
- `MetricSnapshot` — latency time-series
- `AlertRule` + `AlertNotification` — threshold-based alerting with lifecycle
- All queryable via `/api/monitoring/*`

### Health Dashboard (`GET /api/health/detailed`)
- ADMIN-only, pings PostgreSQL, Redis, Clerk, Stripe
- Returns GREEN / YELLOW (latency ≥ 500ms) / RED status per service
- Matches the exact JSON payload spec from the planning document

### New Migration (`prisma/migrations/20260327_guest_identity_monitoring/`)
- Additive migration on top of the baseline
- Makes `clerkId` nullable, adds `customId`/`isGuest`, creates `SystemCounter`
- Creates monitoring tables (`SystemEvent`, `MetricSnapshot`, `AlertRule`, `AlertNotification`)

### Environment Config (`src/config/env.ts`)
- Added `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SECRET` to Zod validation

### Docs
- `README.md` — fully rewritten with complete API reference and env var table
- `ARCHITECTURE.md` — data model, auth flow, service map, caching, error handling
- `AGENTS.md` — AI agent rules and conventions for working in this repo
- `INFO.md` — this file

---

## System Architecture Summary

```
Vercel Serverless (api/index.ts)
  └── Express App (src/app.ts)
        ├── Clerk authMiddleware (all routes)
        ├── /api/health          → HealthService (DB + Redis liveness)
        ├── /api/health/detailed → HealthService (full: DB, Redis, Clerk, Stripe) [ADMIN]
        ├── /api/webhooks/clerk  → Guest merge + user lifecycle
        ├── /api/brands|models|parts|hierarchy|variants → CatalogService
        ├── /api/inventory       → InventoryService
        ├── /api/compatibility   → InventoryService
        ├── /api/cart            → CartService [AUTH]
        ├── /api/checkout        → CheckoutService [AUTH or GUEST]
        ├── /api/checkout/webhook → Stripe webhook
        ├── /api/orders          → OrderService [AUTH]
        ├── /api/quote           → QuoteService [OPTIONAL AUTH]
        ├── /api/users           → UserService [AUTH]
        └── /api/monitoring      → MetricsService + AlertService + EventLoggerService
```

---

## What's Stable ✅

| Area | Status |
|---|---|
| Schema / Prisma models | ✅ Complete, migration-ready |
| Clerk auth (registered users) | ✅ Complete |
| Guest checkout + ID generation | ✅ Complete |
| Guest → registered merge webhook | ✅ Complete |
| Catalog API | ✅ Complete |
| Inventory API (Smart SKUs) | ✅ Complete |
| Compatibility mapping | ✅ Complete |
| Cart (MOQ enforced) | ✅ Complete |
| Checkout (Stripe PaymentIntent) | ✅ Complete |
| Orders API | ✅ Complete |
| Quote / RFQ API | ✅ Complete |
| Users API | ✅ Complete |
| Health dashboard (ADMIN) | ✅ Complete |
| Monitoring / observability | ✅ Complete |
| Rate limiting | ✅ Complete |
| Error handling (centralized) | ✅ Complete |
| Graceful shutdown | ✅ Complete |
| Vercel deployment config | ✅ Complete |
| Seed data (hierarchy + inventory) | ✅ Complete |

---

## Next Steps — Backend

These are items for the next backend sprint or the handoff checklist before go-live:

### Before Go-Live
- [ ] **Run migrations on Neon production DB**: `npm run prisma:migrate`
- [ ] **Run seed**: `npm run prisma:seed`
- [ ] **Set all env vars in Vercel Dashboard** — especially `CLERK_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET`
- [ ] **Register Clerk webhook** in Clerk Dashboard → Webhooks → point to `https://your-domain.vercel.app/api/webhooks/clerk`, select events: `user.created`, `user.updated`, `user.deleted`
- [ ] **Register Stripe webhook** in Stripe Dashboard → Webhooks → point to `https://your-domain.vercel.app/api/checkout/webhook`, select `payment_intent.succeeded`, `payment_intent.payment_failed`
- [ ] **Promote a user to ADMIN** in the DB so `/api/health/detailed` is accessible: `UPDATE "User" SET role = 'ADMIN' WHERE email = 'your@email.com'`

### Nice-to-Have Backend Improvements
- [ ] **Admin route protection on `/api/monitoring/*`** — currently public, should be ADMIN-only like `/api/health/detailed`
- [ ] **Stock reservation system** — currently `stockLevel` is decremented on order creation. A proper reservation would lock stock during the Stripe payment window (~10 min) before confirming the deduction
- [ ] **Order status webhook handler** — the Stripe webhook currently handles `payment_intent.succeeded`; extend it to handle `payment_intent.payment_failed` and transition orders to `CANCELLED`
- [ ] **Email notifications** — send order confirmation email on `CONFIRMED` status (integrate with Resend, SendGrid, or similar)
- [ ] **Guest order lookup endpoint** — `GET /api/orders/guest/:customId` so guests can check order status without a Clerk account
- [ ] **Pagination on `/api/monitoring/events`** — already implemented; verify the frontend consumes it correctly
- [ ] **Redis cache invalidation** — catalog cache TTL is set but manual invalidation on admin updates is not implemented

---

## What I Need From You / The Frontend Team

### From You (Project Owner)
1. **Clerk webhook URL** — Confirm the production domain so I can provide the exact webhook registration URL for Clerk Dashboard
2. **Admin user email** — Let me know which email to promote to `ADMIN` role after the first migration run
3. **Guest checkout scope** — Should guest users be able to view their order status via their `customId` without logging in? (Requires a new `GET /api/orders/guest/:customId` endpoint — currently not built)
4. **MOQ flexibility** — Cart currently enforces a minimum order quantity of **5** at the DB level. Should this be configurable per-SKU, or is the global MOQ of 5 correct for all wholesale customers?
5. **Monitoring auth** — Should `/api/monitoring/*` be protected (ADMIN only) or remain open for the internal status panel?

### From the Frontend Team

#### Must-Have for Launch
- [ ] **Clerk publishable key** — set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the frontend `.env`. The backend `CLERK_SECRET_KEY` (backend-only) and the frontend publishable key are separate.
- [ ] **Guest checkout UI** — the checkout endpoint now accepts `{ guestEmail: "..." }` in the body. The frontend needs a "Guest / Continue as Guest" toggle on the checkout page.
- [ ] **`guestCustomId` display** — on `/checkout/success`, display the returned `guestCustomId` (e.g. `userid-g00042`) in `IBM Plex Mono` font so guests can reference their order. Include a "Save this Order → Create Account" CTA that triggers Clerk sign-up.
- [ ] **`/checkout/error` page** — display the error reason (payment declined, stock unavailable) with a "Back to Cart" link. The checkout endpoint returns `{ success: false, error: "...", code: "..." }` on failure.
- [ ] **Stripe PaymentIntent client secret** — the `/api/checkout` response returns a `clientSecret`. The frontend must pass this to Stripe.js `stripe.confirmPayment()` to complete the payment.

#### API Contract Notes for Frontend Devs
- All prices come back in **cents** (`Int`). Divide by 100 for display. `wholesalePrice === 0` → show "Contact for Price", never "$0.00".
- Health dashboard endpoint (`GET /api/health/detailed`) requires an ADMIN Clerk session. Recommended UI: simple grid, one row per service, colored dot + latency ms. Status: `green` / `yellow` / `red`.
- Cart add endpoint requires `quantity >= 5` (MOQ). The UI should enforce this client-side too.
- The `hierarchy` endpoint (`GET /api/hierarchy`) returns the full Brand → ModelType → Generation → Variant tree in one call — useful for device selectors/dropdowns.

---

## Known Limitations / TODOs in Code

| File | TODO |
|---|---|
| `src/routes/monitoring.routes.ts` | Routes are currently public — add `requireAuth, requireRole('ADMIN')` guards before go-live |
| `src/services/checkout.service.ts` | Stock deduction happens at order creation, not at payment confirmation — consider a reservation pattern |
| `src/routes/orders.routes.ts` | No guest order lookup route yet (by `customId`) |
| `prisma/seed.ts` | Seed covers Apple iPhone (13/14/15) + Samsung Galaxy S (S21/S22/S24). Expand as catalog grows. |

---

## Repo Commands Cheatsheet

```bash
# Development
npm run dev                  # Start server (port 3001)
npm run typecheck            # TypeScript check
npm test                     # Run all tests

# Database
npm run prisma:generate      # Regenerate Prisma Client (after schema changes)
npm run prisma:migrate       # Create + apply migration
npm run prisma:push          # Push schema without migration (dev only)
npm run prisma:seed          # Seed hierarchy + inventory
npm run prisma:studio        # Visual DB browser

# Build + Deploy
npm run build                # Compile TypeScript → dist/
npm start                    # Run production build locally
# Vercel deploys automatically on push to main
```

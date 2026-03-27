# CellTech Backend API (`ctir-backendv1-official`)

> Wholesale cellphone parts distribution backend — Clerk auth, Smart SKU catalog, cart, checkout with guest support, orders, RFQ, and a full observability stack.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express.js 4 |
| Database | Neon PostgreSQL (serverless) |
| ORM | Prisma 6 |
| Auth | Clerk (`@clerk/express`) |
| Cache | Upstash Redis |
| Payments | Stripe |
| Validation | Zod |
| Logging | Pino (JSON in prod, pretty in dev) |
| Testing | Vitest |
| Deployment | Vercel (serverless functions) |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Fill in: DATABASE_URL, DIRECT_URL, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET,
#           STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, REDIS_URL

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run migrations (against your Neon DB)
npm run prisma:migrate

# 5. Seed the database
npm run prisma:seed

# 6. Start dev server
npm run dev
# → http://localhost:3001
```

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with auto-reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run prisma:generate` | Regenerate Prisma Client after schema changes |
| `npm run prisma:migrate` | Create and apply a new migration |
| `npm run prisma:push` | Push schema changes directly (no migration file) |
| `npm run prisma:studio` | Open Prisma Studio (visual DB browser) |
| `npm run prisma:seed` | Seed DB with device hierarchy + Smart SKU inventory |
| `npm test` | Run test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck` | Type-check without emitting files |
| `npm run lint` | Lint source code |

---

## API Reference

All endpoints return `{ success: boolean, data?, error?, meta? }`.  
Prices are always in **cents** (Int). Divide by 100 for display.

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Liveness probe (DB + Redis) |
| `GET` | `/api/health/detailed` | ADMIN | Full service health (DB, Redis, Clerk, Stripe) with latency + RED/YELLOW/GREEN status |

### Catalog
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/brands` | Public | All brands |
| `GET` | `/api/models?brandId=` | Public | Models, optionally filtered by brand |
| `GET` | `/api/brands/:brandId/models` | Public | Models for a specific brand |
| `GET` | `/api/parts?device=` | Public | Search parts by device name |
| `GET` | `/api/variants/:variantId/parts` | Public | Parts for a specific device variant |
| `GET` | `/api/hierarchy` | Public | Full Brand → ModelType → Generation → Variant tree |

### Inventory
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/inventory` | Public | List all inventory |
| `GET` | `/api/inventory/:skuId` | Public | Part detail by Smart SKU |
| `GET` | `/api/inventory/:skuId/specs` | Public | Specifications for a SKU |
| `GET` | `/api/inventory/check/:skuId` | Public | Real-time stock level |
| `POST` | `/api/inventory/bulk-check` | Public | Bulk stock check (up to 100 SKUs) |
| `GET` | `/api/inventory/model/:modelId` | Public | Inventory by model |
| `GET` | `/api/inventory/variants/:variantId/parts` | Public | Inventory by variant |

### Compatibility
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/compatibility/:skuId` | Public | Compatible device variants for a SKU |

### Cart
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/cart` | Required | Retrieve user's cart |
| `POST` | `/api/cart` | Required | Add item (min quantity: 5 — MOQ) |
| `POST` | `/api/cart/sync` | Required | Replace server cart with client snapshot |
| `POST` | `/api/cart/validate` | Required | Validate stock/pricing for current cart |
| `PATCH` | `/api/cart/:skuId` | Required | Update item quantity |
| `DELETE` | `/api/cart/:skuId` | Required | Remove item |
| `DELETE` | `/api/cart` | Required | Clear cart |

### Checkout
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/checkout` | Required **or** Guest | Create order + Stripe PaymentIntent. Pass `guestEmail` in body for guest checkout — returns `guestCustomId` (e.g. `userid-g00042`) for order tracking. |
| `POST` | `/api/checkout/create-intent` | Required **or** Guest | Alias for the above |
| `POST` | `/api/checkout/webhook` | Stripe signature | Stripe webhook — reconciles payment state |

### Orders
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/orders` | Required | Paginated order list |
| `GET` | `/api/orders/history` | Required | Alias for order history |
| `GET` | `/api/orders/:id` | Required | Order detail + tracking |
| `GET` | `/api/orders/:id/tracking` | Required | Alias for tracking |

### Quote Requests (RFQ)
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/quote` | Optional | Submit RFQ (anonymous or authenticated) |
| `GET` | `/api/quote/:quoteRequestId` | Public | Look up a quote request by ID |

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/users/profile` | Required | Get authenticated user's profile |
| `PUT` | `/api/users/profile` | Required | Update profile (name, company, phone) |

### Webhooks
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/webhooks/clerk` | Svix signature | Clerk user lifecycle — creates, merges, updates, deletes users |

### Monitoring
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/monitoring/events` | Public | Paginated system event log (filterable) |
| `GET` | `/api/monitoring/events/stats` | Public | Event counts by category/severity |
| `GET` | `/api/monitoring/metrics/timeline` | Public | Latency time-series by service |
| `GET` | `/api/monitoring/metrics/request-stats` | Public | Aggregated request metrics |
| `GET` | `/api/monitoring/alerts` | Public | List alert notifications |
| `GET` | `/api/monitoring/alerts/rules` | Public | List alert rules |
| `POST` | `/api/monitoring/alerts/rules` | Public | Create alert rule |
| `PATCH` | `/api/monitoring/alerts/rules/:id` | Public | Update/toggle alert rule |
| `DELETE` | `/api/monitoring/alerts/rules/:id` | Public | Delete alert rule |
| `POST` | `/api/monitoring/alerts/:id/acknowledge` | Public | Acknowledge alert |
| `POST` | `/api/monitoring/alerts/:id/resolve` | Public | Resolve alert |
| `POST` | `/api/monitoring/cleanup` | Public | Purge old metric data |
| `POST` | `/api/monitoring/snapshot` | Public | Trigger immediate health snapshot |

---

## Environment Variables

Copy `.env.example` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string (pooled) |
| `DIRECT_URL` | ✅ | Neon direct connection (for migrations) |
| `CLERK_SECRET_KEY` | ✅ | Clerk backend secret key (`sk_...`) |
| `CLERK_WEBHOOK_SECRET` | ✅ | Clerk webhook signing secret (`whsec_...`) |
| `STRIPE_SECRET_KEY` | ✅ | Stripe backend secret key (`sk_...`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret (`whsec_...`) |
| `REDIS_URL` | ⚠️ Optional | Upstash Redis URL (caching — degrades gracefully if absent) |
| `PORT` | Optional | Default `3001` |
| `NODE_ENV` | Optional | `development` / `production` / `test` |
| `CORS_ORIGIN` | Optional | Allowed frontend origin (default `http://localhost:3000`) |
| `JWT_SECRET` | Optional | Legacy JWT fallback (min 32 chars in prod) |

---

## Deployment

Deployed to **Vercel** via GitHub integration (`api/index.ts` as the serverless entry point).

- Push to `main` → production deployment
- All PRs → preview deployment
- Set all env vars in Vercel Dashboard → Settings → Environment Variables

---

## Database Migrations

Two migrations ship with this repo:

| Migration | Description |
|---|---|
| `20260324_clerk_smart_sku_schema` | Baseline — Clerk auth + Smart SKU inventory schema |
| `20260327_guest_identity_monitoring` | Guest identity (`customId`, `isGuest`), `SystemCounter`, monitoring tables |

Run both against your Neon DB:
```bash
npm run prisma:migrate
```

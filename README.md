# CellTech Backend API

Wholesale cellphone parts distribution backend — catalog, inventory, auth, cart, checkout, and order management.

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** Neon PostgreSQL (via Prisma ORM)
- **Cache:** Upstash Redis
- **Auth:** JWT (bcryptjs + jsonwebtoken)
- **Payments:** Stripe
- **Validation:** Zod
- **Logging:** Pino
- **Testing:** Vitest
- **Deployment:** Vercel

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials (Neon DB, Redis, Stripe, JWT secret)
   ```

3. **Generate Prisma client:**
   ```bash
   npm run prisma:generate
   ```

4. **Run migrations:**
   ```bash
   npm run prisma:migrate
   ```

5. **Seed the database (optional):**
   ```bash
   npm run prisma:seed
   ```

6. **Start the dev server:**
   ```bash
   npm run dev
   ```

   API will be available at `http://localhost:3001`

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with auto-reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled production build |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:push` | Push schema changes without migration |
| `npm run prisma:studio` | Open Prisma Studio (DB GUI) |
| `npm run prisma:seed` | Seed database with sample data |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Lint source code |
| `npm run typecheck` | Type-check without emitting files |

## API Endpoints

### Catalog
- `GET /api/brands` — List all device brands
- `GET /api/models?brandId=` — List models, optionally filtered by brand
- `GET /api/parts?device=` — Search parts by device name
- `GET /api/hierarchy` — Full Brand → ModelType → Generation → Variant tree

### Inventory
- `GET /api/inventory/:sku` — Real-time stock levels
- `POST /api/inventory/reserve` — Reserve stock for cart

### Auth
- `POST /api/auth/register` — Customer registration
- `POST /api/auth/signup` — Alias for registration during frontend auth migration
- `POST /api/auth/login` — JWT authentication
- `POST /api/auth/logout` — Revoke the current access token (optionally rotate out a refresh token)
- `POST /api/auth/refresh` — Token refresh
- `GET /api/auth/me` — Get current user (authenticated)
- `GET /api/auth/session` — Alias for the current authenticated user

### Cart
- `GET /api/cart` — Retrieve user's cart
- `POST /api/cart` — Add an item to cart (alias: `POST /api/cart/items`)
- `POST /api/cart/sync` / `PUT /api/cart/sync` — Replace the server cart with a client cart snapshot
- `POST /api/cart/validate` — Validate stock/pricing for the current cart or a provided cart snapshot
- `PATCH /api/cart/:skuId` — Update item quantity (alias: `PATCH /api/cart/items/:skuId`)
- `DELETE /api/cart/:skuId` — Remove an item from cart (alias: `DELETE /api/cart/items/:skuId`)
- `DELETE /api/cart` — Clear the current user's cart

### Checkout
- `POST /api/checkout` — Authenticated checkout endpoint; expects an empty request body and returns `{ success: true, data }` after creating a pending order and Stripe PaymentIntent
- `POST /api/checkout/create-intent` — Backwards-compatible alias for `POST /api/checkout`, retained for older clients that still call the original intent-specific path
- `POST /api/checkout/webhook` — Stripe webhook endpoint; must receive the raw JSON payload plus the `stripe-signature` header and returns `{ success: true, data }` after reconciling payment state

### Orders
- `GET /api/orders` — List user's orders (paginated)
- `GET /api/orders/history` — Alias for paginated order history
- `GET /api/orders/:id` — Order details and tracking
- `GET /api/orders/:id/tracking` — Alias for order detail / tracking lookup

### Quote
- `POST /api/quote` — Submit a quote request for manual review (anonymous or authenticated)
- `GET /api/quote/:quoteRequestId` — Look up a persisted quote request

### Users
- `GET /api/users/profile` — Get the authenticated user's profile
- `PUT /api/users/profile` — Update the authenticated user's profile

## Deployment

Deployed to **Vercel** via GitHub integration:
- Push to `main` triggers production deployment
- All PRs get preview deployments
- Environment variables configured in Vercel dashboard

### Required Environment Variables

- `DATABASE_URL` — Neon PostgreSQL connection string
- `DIRECT_URL` — Direct database connection (for migrations)
- `JWT_SECRET` — Secret for signing tokens
- `REDIS_URL` — Upstash Redis connection string
- `STRIPE_SECRET_KEY` — Stripe API key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `CORS_ORIGIN` — Frontend URL (production)

## Development Notes

- Uses ES modules (`"type": "module"`)
- Path aliases configured: `@/*` maps to `src/*`
- Strict TypeScript enforcement
- Structured logging with Pino (JSON in production, pretty in dev)
- Redis caching for frequently accessed data (catalog, inventory)
- Prisma migrations managed in `prisma/migrations/`
# ctir-backendv1-official

import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/auth.js';
import { verifyWebhookSignature } from '../lib/stripe.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { CheckoutService } from '../services/checkout.service.js';
import { prisma } from '../lib/prisma.js';
import { generateGuestId } from '../lib/guest-id.js';

const router = Router();
const checkoutService = new CheckoutService();

const createCheckoutBodySchema = z.preprocess(
  (value) => value ?? {},
  z.object({}).strict()
);

/**
 * Guest checkout body schema.
 * Accepts an email to create/look up a guest user when no Clerk session is present.
 */
const guestCheckoutBodySchema = z.object({
  guestEmail: z.string().email('A valid guest email is required'),
});

function getStripeSignature(req: Request): string {
  const signature = req.header('stripe-signature')?.trim();

  if (!signature) {
    throw new HttpError(400, 'Stripe signature header required', 'MISSING_STRIPE_SIGNATURE');
  }

  if (!(/(^|,)\s*t=/.test(signature)) || !(/(^|,)\s*v1=/.test(signature))) {
    throw new HttpError(400, 'Invalid Stripe signature', 'INVALID_STRIPE_SIGNATURE');
  }

  return signature;
}

function isStripeSignatureVerificationError(error: unknown): boolean {
  return error instanceof Error
    && (
      error.name === 'StripeSignatureVerificationError'
      || /signature/i.test(error.message)
    );
}

/**
 * Resolves the internal user ID for a checkout request.
 * - If a Clerk session is present (req.user), use that user's internal ID.
 * - If a guestEmail is provided in the body, find or create a guest User record.
 */
async function resolveCheckoutUserId(req: Request): Promise<{ userId: string; guestCustomId?: string }> {
  // Authenticated path
  if (req.user?.id) {
    return { userId: req.user.id };
  }

  // Guest path — requires guestEmail in request body
  const parsed = guestCheckoutBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      401,
      'Authentication required or provide a valid guestEmail for guest checkout',
      'AUTH_OR_GUEST_EMAIL_REQUIRED'
    );
  }

  const { guestEmail } = parsed.data;

  // Check for an existing guest record with this email
  const existingGuest = await prisma.user.findUnique({
    where: { email: guestEmail },
    select: { id: true, isGuest: true, customId: true },
  });

  if (existingGuest) {
    if (!existingGuest.isGuest) {
      // Email belongs to a registered account — require proper login
      throw new HttpError(
        409,
        'An account exists for this email. Please log in to complete checkout.',
        'ACCOUNT_EXISTS_PLEASE_LOGIN'
      );
    }
    // Returning guest — reuse their record
    return { userId: existingGuest.id, guestCustomId: existingGuest.customId ?? undefined };
  }

  // New guest — create a record with a generated guest ID
  const customId = await generateGuestId();
  const guestUser = await prisma.user.create({
    data: {
      email: guestEmail,
      customId,
      isGuest: true,
      role: 'BUYER',
    },
  });

  return { userId: guestUser.id, guestCustomId: customId };
}

async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, guestCustomId } = await resolveCheckoutUserId(req);
    const checkout = await checkoutService.createCheckout(userId);

    res.status(201).json({
      success: true,
      data: {
        ...checkout,
        // Include guestCustomId in response so guests can reference their order
        ...(guestCustomId ? { guestCustomId } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function handleWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    // Keep validation handler-side: Stripe HMAC verification requires the raw body,
    // so this endpoint cannot use the normal JSON/Zod body parsing flow first.
    if (!(req.body instanceof Buffer)) {
      throw new HttpError(400, 'Stripe webhook requires a raw request body', 'INVALID_WEBHOOK_PAYLOAD');
    }

    let event;

    try {
      event = await verifyWebhookSignature(req.body, getStripeSignature(req));
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (isStripeSignatureVerificationError(error)) {
        throw new HttpError(400, 'Invalid Stripe signature', 'INVALID_STRIPE_SIGNATURE');
      }

      throw error;
    }

    const result = await checkoutService.handleWebhookEvent(event);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

// Stripe signature verification must use the raw request body provided by app-level express.raw().
router.post('/webhook', rateLimit({ windowMs: 60_000, maxRequests: 100, keyPrefix: 'checkout-webhook' }), handleWebhook);

// Checkout routes support both authenticated users AND guest checkout.
// requireAuth is NOT applied here globally — resolveCheckoutUserId handles both cases.
// Validated body can be empty (authenticated) or contain guestEmail (guest).
const checkoutBodySchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    guestEmail: z.string().email().optional(),
  })
);

router.post('/', validate(checkoutBodySchema, 'body'), createCheckout);
// Retain the create-intent alias for older clients
router.post('/create-intent', validate(checkoutBodySchema, 'body'), createCheckout);

export default router;

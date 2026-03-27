import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/auth.js';
import { verifyWebhookSignature } from '../lib/stripe.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { CheckoutService } from '../services/checkout.service.js';

const router = Router();
const checkoutService = new CheckoutService();
const createCheckoutBodySchema = z.preprocess(
  (value) => value ?? {},
  z.object({}).strict()
);

function getAuthenticatedUserId(req: Request): string {
  const userId = req.user?.id;

  if (!userId) {
    throw new HttpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }

  return userId;
}

function getStripeSignature(req: Request): string {
  const signature = req.header('stripe-signature')?.trim();

  if (!signature) {
    throw new HttpError(400, 'Stripe signature header required', 'MISSING_STRIPE_SIGNATURE');
  }

  if (!/(^|,)\s*t=/.test(signature) || !/(^|,)\s*v1=/.test(signature)) {
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

async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const checkout = await checkoutService.createCheckout(getAuthenticatedUserId(req));
    res.status(201).json({ success: true, data: checkout });
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

router.use(requireAuth);

router.post('/', validate(createCheckoutBodySchema, 'body'), createCheckout);
// Retain the create-intent alias for older clients while the canonical route stays POST /api/checkout.
router.post('/create-intent', validate(createCheckoutBodySchema, 'body'), createCheckout);

export default router;

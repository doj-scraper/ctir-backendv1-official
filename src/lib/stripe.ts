import Stripe from 'stripe';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2025-02-24.acacia';

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
    })
  : null;

if (stripe) {
  logger.info('Stripe client initialized');
} else {
  logger.info('Stripe not configured (STRIPE_SECRET_KEY not set)');
}

export async function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Promise<Stripe.Event> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  return stripe.webhooks.constructEvent(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );
}

import express from 'express';
import { Webhook } from 'svix';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { logEvent } from '../services/event-logger.service.js';
import { generateGuestId } from '../lib/guest-id.js';

const router = express.Router();

router.post('/clerk', rateLimit({ windowMs: 60_000, maxRequests: 100, keyPrefix: 'clerk-webhook' }), async (req, res) => {
  const SIGNING_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!SIGNING_SECRET) {
    logger.error('Error: Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env');
    return res.status(500).json({
      success: false,
      message: 'Error: Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard to .env',
    });
  }

  // Create new Svix instance with secret
  const wh = new Webhook(SIGNING_SECRET);

  // Get headers and body
  const headers = req.headers;
  const payload = req.body;

  // Get Svix headers for verification
  const svix_id = headers['svix-id'] as string;
  const svix_timestamp = headers['svix-timestamp'] as string;
  const svix_signature = headers['svix-signature'] as string;

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return res.status(400).json({
      success: false,
      message: 'Error: Missing svix headers',
    });
  }

  let evt: any;

  // Attempt to verify the incoming webhook
  try {
    evt = wh.verify(payload, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err: any) {
    logger.error(`Error: Could not verify webhook: ${err.message}`);
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  const eventType = evt.type;
  const { id } = evt.data;

  logger.info(`Webhook received: ${eventType} for ${id}`);

  try {
    if (eventType === 'user.created') {
      const { id: clerkId, email_addresses, first_name, last_name } = evt.data;
      const email = email_addresses[0]?.email_address;

      if (!email) {
        logger.warn(`User created webhook received without email for Clerk ID: ${clerkId}`);
        return res.status(400).json({ success: false, message: 'Missing email' });
      }

      const name = `${first_name || ''} ${last_name || ''}`.trim();

      // --- GUEST MERGE LOGIC ---
      // Check if a guest user already exists with this email.
      // If so, "claim" the guest record by linking the Clerk ID to it
      // rather than creating a duplicate. This preserves order history and cart.
      const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, isGuest: true, clerkId: true },
      });

      if (existingUser && existingUser.isGuest) {
        // Merge: upgrade the guest account to a permanent Clerk-linked account
        await prisma.user.update({
          where: { email },
          data: {
            clerkId,
            isGuest: false,
            name: name || undefined,
          },
        });
        logger.info(`Guest user merged with Clerk account: ${clerkId} (email: ${email})`);
        logEvent('AUTH', 'INFO', 'webhooks.clerk', 'Guest user merged with Clerk account', { clerkId, email });
      } else if (!existingUser) {
        // Standard creation: brand-new user
        await prisma.user.create({
          data: {
            clerkId,
            email,
            name: name || undefined,
            role: 'BUYER',
            isGuest: false,
          },
        });
        logger.info(`User created in DB: ${clerkId}`);
        logEvent('AUTH', 'INFO', 'webhooks.clerk', 'User created via webhook', { clerkId, email });
      } else {
        // User already exists and is NOT a guest (e.g., duplicate webhook delivery)
        logger.info(`User already exists in DB (non-guest): ${clerkId}`);
      }

    } else if (eventType === 'user.updated') {
      const { id: clerkId, email_addresses, first_name, last_name } = evt.data;
      const email = email_addresses[0]?.email_address;
      const name = `${first_name || ''} ${last_name || ''}`.trim();

      await prisma.user.update({
        where: { clerkId },
        data: {
          email: email || undefined,
          name: name || undefined,
        },
      });
      logger.info(`User updated in DB: ${clerkId}`);
      logEvent('AUTH', 'INFO', 'webhooks.clerk', 'User updated via webhook', { clerkId, email });

    } else if (eventType === 'user.deleted') {
      const { id: clerkId } = evt.data;
      await prisma.user.delete({
        where: { clerkId },
      });
      logger.info(`User deleted from DB: ${clerkId}`);
      logEvent('AUTH', 'WARN', 'webhooks.clerk', 'User deleted via webhook', { clerkId });
    }
  } catch (error: any) {
    logger.error(`Error processing webhook event ${eventType}: ${error.message}`);

    // P2025 = "Record to update/delete does not exist" — safe to ignore on delete
    if (error.code === 'P2025' && eventType === 'user.deleted') {
      logger.info(`User ${id} already deleted or not found.`);
      return res.status(200).json({ success: true, message: 'User already deleted' });
    }

    // P2002 = "Unique constraint failed" — duplicate webhook delivery on create
    if (error.code === 'P2002' && eventType === 'user.created') {
      logger.info(`User ${id} already exists — duplicate webhook delivery ignored.`);
      return res.status(200).json({ success: true, message: 'User already exists' });
    }

    return res.status(500).json({
      success: false,
      message: 'Error processing webhook',
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Webhook received',
  });
});

export default router;

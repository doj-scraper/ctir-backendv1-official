import express from 'express';
import { Webhook } from 'svix';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { logEvent } from '../services/event-logger.service.js';

const router = express.Router();

router.post('/clerk', async (req, res) => {
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
      const { id, email_addresses, first_name, last_name } = evt.data;
      const email = email_addresses[0]?.email_address;

      if (!email) {
        logger.warn(`User created webhook received without email for ID: ${id}`);
        return res.status(400).json({ success: false, message: 'Missing email' });
      }

      await prisma.user.create({
        data: {
          clerkId: id,
          email: email,
          name: `${first_name || ''} ${last_name || ''}`.trim(),
          role: 'BUYER', // Default role
        },
      });
      logger.info(`User created in DB: ${id}`);
      logEvent('AUTH', 'INFO', 'webhooks.clerk', 'User created via webhook', { clerkId: id, email });
    } else if (eventType === 'user.updated') {
      const { id, email_addresses, first_name, last_name } = evt.data;
      const email = email_addresses[0]?.email_address;

      await prisma.user.update({
        where: { clerkId: id },
        data: {
          email: email, // Update email if changed
          name: `${first_name || ''} ${last_name || ''}`.trim(),
        },
      });
      logger.info(`User updated in DB: ${id}`);
    } else if (eventType === 'user.deleted') {
      const { id } = evt.data;
      await prisma.user.delete({
        where: { clerkId: id },
      });
      logger.info(`User deleted from DB: ${id}`);
      logEvent('AUTH', 'WARN', 'webhooks.clerk', 'User deleted via webhook', { clerkId: id });
    }
  } catch (error: any) {
    logger.error(`Error processing webhook event ${eventType}: ${error.message}`);
    // If user already exists on create, or doesn't exist on update/delete, we might want to handle it.
    // For now, return 500 so Clerk retries if it's a transient issue, 
    // but if it's a "Record to update not found", maybe we should ignore it or create it?
    // Given the instructions, we'll keep it simple.
    
    // Prisma P2025 is "Record to delete does not exist"
    // Prisma P2002 is "Unique constraint failed"
    if (error.code === 'P2025' && eventType === 'user.deleted') {
       logger.info(`User ${id} already deleted or not found.`);
       return res.status(200).json({ success: true, message: 'User already deleted' });
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

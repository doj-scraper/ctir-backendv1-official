/**
 * Guest ID generation using a persistent SystemCounter table.
 * Generates IDs in the format: userid-g00123
 * The counter is resettable by updating the "guest_id" row count to 0.
 */

import { prisma } from './prisma.js';

const GUEST_ID_PREFIX = 'userid-g';
const GUEST_ID_PADDING = 5;

/**
 * Atomically increments the guest counter and returns the next guest ID.
 * Uses Prisma's updateMany with a conditional increment for atomicity.
 */
export async function generateGuestId(): Promise<string> {
  // Ensure the counter row exists first
  await prisma.systemCounter.upsert({
    where: { id: 'guest_id' },
    update: {},
    create: { id: 'guest_id', count: 0 },
  });

  // Atomically increment and fetch the new count
  const counter = await prisma.systemCounter.update({
    where: { id: 'guest_id' },
    data: { count: { increment: 1 } },
  });

  return formatGuestId(counter.count);
}

/**
 * Formats a counter number into the guest ID string format.
 * e.g., 123 → "userid-g00123"
 */
export function formatGuestId(count: number): string {
  const padded = String(count).padStart(GUEST_ID_PADDING, '0');
  return `${GUEST_ID_PREFIX}${padded}`;
}

/**
 * Resets the guest ID counter back to 0.
 * Use this when purging guest records to restart the sequence.
 */
export async function resetGuestIdCounter(): Promise<void> {
  await prisma.systemCounter.upsert({
    where: { id: 'guest_id' },
    update: { count: 0 },
    create: { id: 'guest_id', count: 0 },
  });
}

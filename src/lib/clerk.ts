/**
 * Clerk API client for health checks.
 * Separated into its own module for consistent test mocking (same pattern as prisma/redis/stripe).
 */

export interface ClerkPingResult {
  ok: boolean;
  status: number;
  latencyMs: number;
}

export async function pingClerk(): Promise<ClerkPingResult> {
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (!clerkKey) {
    throw new Error('CLERK_SECRET_KEY not configured');
  }

  const start = Date.now();
  const res = await fetch('https://api.clerk.com/v1/clients', {
    method: 'GET',
    headers: { Authorization: `Bearer ${clerkKey}` },
  });
  const latencyMs = Date.now() - start;

  return { ok: res.ok || res.status !== 401, status: res.status, latencyMs };
}

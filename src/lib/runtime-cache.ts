type ExpiringEntry = {
  value: string;
  expiresAt: number;
};

const expiringEntries = new Map<string, ExpiringEntry>();
const slidingWindowEntries = new Map<string, number[]>();

function isExpired(expiresAt: number): boolean {
  return expiresAt <= Date.now();
}

function deleteExpiredKeyIfNeeded(key: string): void {
  const entry = expiringEntries.get(key);

  if (!entry) {
    return;
  }

  if (isExpired(entry.expiresAt)) {
    expiringEntries.delete(key);
  }
}

function pruneSlidingWindow(key: string, minimumTimestamp: number): number[] {
  const timestamps = slidingWindowEntries.get(key) ?? [];
  const activeTimestamps = timestamps.filter((timestamp) => timestamp > minimumTimestamp);

  if (activeTimestamps.length === 0) {
    slidingWindowEntries.delete(key);
    return [];
  }

  slidingWindowEntries.set(key, activeTimestamps);
  return activeTimestamps;
}

export function setRuntimeKey(key: string, value: string, ttlSeconds: number): boolean {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    expiringEntries.delete(key);
    return true;
  }

  expiringEntries.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return true;
}

export function getRuntimeKey(key: string): string | null {
  deleteExpiredKeyIfNeeded(key);
  return expiringEntries.get(key)?.value ?? null;
}

export function hasRuntimeKey(key: string): boolean {
  return getRuntimeKey(key) !== null;
}

export function deleteRuntimeKeys(...keys: string[]): number {
  let deletedCount = 0;

  for (const key of keys) {
    if (expiringEntries.delete(key)) {
      deletedCount += 1;
    }
  }

  return deletedCount;
}

export function consumeSlidingWindow(
  key: string,
  windowMs: number,
  maxRequests: number
): { allowed: boolean; remaining: number; total: number } {
  const now = Date.now();
  const minimumTimestamp = now - windowMs;
  const activeTimestamps = pruneSlidingWindow(key, minimumTimestamp);

  if (activeTimestamps.length >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      total: activeTimestamps.length,
    };
  }

  const nextTimestamps = [...activeTimestamps, now];
  slidingWindowEntries.set(key, nextTimestamps);

  return {
    allowed: true,
    remaining: Math.max(maxRequests - nextTimestamps.length, 0),
    total: nextTimestamps.length,
  };
}

export type RateLimitBucket = Map<string, { count: number; resetAt: number }>;

const MAX_TRACKED_KEYS = 50_000;

/** Fixed-window limiter, in memory and per process. Returns false once `max` is exceeded. */
export function rateLimit(
  bucket: RateLimitBucket,
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  if (bucket.size >= MAX_TRACKED_KEYS) {
    for (const [k, v] of bucket) {
      if (now > v.resetAt) bucket.delete(k);
    }
    if (bucket.size >= MAX_TRACKED_KEYS) bucket.clear();
  }
  const cur = bucket.get(key);
  if (!cur || now > cur.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  cur.count += 1;
  return cur.count <= max;
}

import { getRedisClient } from '../config/redis';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Redis-backed rate limiter for email sends.
 * Uses sliding hour windows keyed by sender + hour.
 *
 * Key format: rate_limit:{senderId}:{YYYY-MM-DD-HH}
 * This ensures the counter resets every hour naturally.
 *
 * Safe across multiple workers/instances because Redis INCR is atomic.
 */

function getHourWindowKey(senderId: string): string {
  const now = new Date();
  const window = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
  return `rate_limit:${senderId}:${window}`;
}

function getGlobalHourWindowKey(): string {
  const now = new Date();
  const window = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
  return `rate_limit:global:${window}`;
}

export interface RateLimitCheck {
  allowed: boolean;
  currentCount: number;
  limit: number;
  retryAfterMs: number;
}

/**
 * Check and increment the rate limit counter for a sender.
 * Returns allowed=false if limit exceeded, along with how long to wait.
 *
 * Uses atomic INCR + EXPIRE to avoid race conditions.
 */
export async function checkAndIncrementRateLimit(senderId: string): Promise<RateLimitCheck> {
  const redis = getRedisClient();
  const perSenderLimit = config.rateLimit.maxEmailsPerHourPerSender;
  const globalLimit = config.rateLimit.maxEmailsPerHour;

  const senderKey = getHourWindowKey(senderId);
  const globalKey = getGlobalHourWindowKey();

  // Pipeline for atomic check-and-increment
  const pipeline = redis.pipeline();
  pipeline.incr(senderKey);
  pipeline.expire(senderKey, 3600); // TTL = 1 hour
  pipeline.incr(globalKey);
  pipeline.expire(globalKey, 3600);

  const results = await pipeline.exec();

  if (!results) {
    throw new Error('Redis pipeline returned null');
  }

  const senderCount = results[0][1] as number;
  const globalCount = results[2][1] as number;

  // Check per-sender limit
  if (senderCount > perSenderLimit) {
    // Roll back by decrementing (we incremented optimistically)
    await redis.decrby(senderKey, 1);
    await redis.decrby(globalKey, 1);

    const msUntilNextHour = getMsUntilNextHour();

    logger.warn('Per-sender rate limit exceeded', {
      senderId,
      senderCount: senderCount - 1,
      limit: perSenderLimit,
      retryAfterMs: msUntilNextHour,
    });

    return {
      allowed: false,
      currentCount: senderCount - 1,
      limit: perSenderLimit,
      retryAfterMs: msUntilNextHour,
    };
  }

  // Check global limit
  if (globalCount > globalLimit) {
    await redis.decrby(senderKey, 1);
    await redis.decrby(globalKey, 1);

    const msUntilNextHour = getMsUntilNextHour();

    logger.warn('Global rate limit exceeded', {
      globalCount: globalCount - 1,
      limit: globalLimit,
      retryAfterMs: msUntilNextHour,
    });

    return {
      allowed: false,
      currentCount: globalCount - 1,
      limit: globalLimit,
      retryAfterMs: msUntilNextHour,
    };
  }

  return {
    allowed: true,
    currentCount: senderCount,
    limit: perSenderLimit,
    retryAfterMs: 0,
  };
}

/**
 * Get current usage without incrementing — for display purposes.
 */
export async function getRateLimitStatus(senderId: string): Promise<{
  senderCount: number;
  globalCount: number;
  perSenderLimit: number;
  globalLimit: number;
}> {
  const redis = getRedisClient();
  const senderKey = getHourWindowKey(senderId);
  const globalKey = getGlobalHourWindowKey();

  const [senderCount, globalCount] = await Promise.all([
    redis.get(senderKey),
    redis.get(globalKey),
  ]);

  return {
    senderCount: parseInt(senderCount || '0', 10),
    globalCount: parseInt(globalCount || '0', 10),
    perSenderLimit: config.rateLimit.maxEmailsPerHourPerSender,
    globalLimit: config.rateLimit.maxEmailsPerHour,
  };
}

/**
 * Calculate milliseconds until the top of the next hour (UTC).
 */
function getMsUntilNextHour(): number {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);
  return nextHour.getTime() - now.getTime();
}

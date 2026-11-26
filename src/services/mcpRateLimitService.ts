import { prisma } from '@/lib/prisma';

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

const WINDOW_MS = 60_000;

export function rateLimitKey(scope: 'tool' | 'search' | 'request' | 'auth' | 'register', identifier: string) {
  return `mcp:${scope}:${identifier}`;
}

/**
 * Fixed-window counter stored in PostgreSQL so every serverless instance sees
 * the same budget. The unique (key, windowStart) constraint makes the increment
 * atomic even when requests arrive concurrently.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  options: { cost?: number; now?: number } = {}
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now();
  const cost = Math.max(1, Math.min(options.cost ?? 1, 1000));
  const windowStartMs = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + WINDOW_MS);
  const expiresAt = new Date(windowStartMs + WINDOW_MS * 2);

  const record = await prisma.mcpRateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: cost, expiresAt },
    update: { count: { increment: cost } },
    select: { count: true }
  });

  if (Math.random() < 0.01) {
    void prisma.mcpRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => undefined);
  }

  const used = record.count;
  return {
    allowed: used <= limit,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000))
  };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  options: { cost?: number; now?: number } = {}
): Promise<RateLimitResult> {
  return consumeRateLimit(key, limit, options);
}

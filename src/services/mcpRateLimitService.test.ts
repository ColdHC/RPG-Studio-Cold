import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn()
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { mcpRateLimit: { upsert: mocks.upsert, deleteMany: mocks.deleteMany } }
}));

import { consumeRateLimit, rateLimitKey } from './mcpRateLimitService';

describe('distributed MCP rate limiter', () => {
  beforeEach(() => {
    mocks.upsert.mockReset();
    mocks.deleteMany.mockReset();
    mocks.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('uses a stable key per scope and user', () => {
    expect(rateLimitKey('tool', 'u1')).toBe('mcp:tool:u1');
    expect(rateLimitKey('search', 'u1')).toBe('mcp:search:u1');
  });

  it('allows up to the configured budget in a fixed window', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 30);
    mocks.upsert.mockResolvedValueOnce({ count: 5 });
    const result = await consumeRateLimit(rateLimitKey('tool', 'u1'), 60, { now });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(55);
    expect(result.resetAt.getTime()).toBe(Math.floor(now / 60_000) * 60_000 + 60_000);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ count: 1 }) })
    );
  });

  it('blocks and reports retry-after when the budget is exhausted', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 59);
    mocks.upsert.mockResolvedValueOnce({ count: 61 });
    const result = await consumeRateLimit(rateLimitKey('search', 'u1'), 30, { now });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(1);
  });

  it('counts cost for batched tool calls', async () => {
    mocks.upsert.mockResolvedValueOnce({ count: 3 });
    await consumeRateLimit(rateLimitKey('tool', 'u1'), 60, { cost: 3 });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ count: 3 }) })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revokeToken: vi.fn(),
  consumeRateLimit: vi.fn()
}));

vi.mock('@/services/mcpAuthService', () => ({ revokeToken: mocks.revokeToken }));
vi.mock('@/services/mcpRateLimitService', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitKey: (scope: string, identifier: string) => `mcp:${scope}:${identifier}`
}));

import { POST } from './route';

const originalEnv = { ...process.env };

function request(body: string) {
  return new Request('https://app.example.com/api/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
}

describe('POST /api/oauth/revoke', () => {
  beforeEach(() => {
    mocks.revokeToken.mockReset();
    mocks.revokeToken.mockResolvedValue(undefined);
    mocks.consumeRateLimit.mockReset();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com';
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it('returns 404 when disabled', async () => {
    delete process.env.MCP_ENABLED;
    expect((await POST(request('token=x&client_id=y'))).status).toBe(404);
  });

  it('requires token and client_id', async () => {
    expect((await POST(request('token=x'))).status).toBe(400);
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it('rejects duplicated parameters', async () => {
    const response = await POST(request('token=x&token=y&client_id=z'));
    expect(response.status).toBe(400);
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it('returns 200 with no body for a valid revocation', async () => {
    const response = await POST(request('token=mcp_at_x&client_id=mcp_client_test'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(mocks.revokeToken).toHaveBeenCalledWith({ token: 'mcp_at_x', clientId: 'mcp_client_test' });
  });
});

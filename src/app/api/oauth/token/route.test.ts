import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeAuthorizationCode: vi.fn(),
  refreshAccessToken: vi.fn(),
  consumeRateLimit: vi.fn()
}));

vi.mock('@/services/mcpAuthService', () => ({
  exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
  refreshAccessToken: mocks.refreshAccessToken
}));
vi.mock('@/services/mcpRateLimitService', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitKey: (scope: string, identifier: string) => `mcp:${scope}:${identifier}`
}));

import { McpOAuthError } from '@/lib/mcp/errors';
import { POST } from './route';

const originalEnv = { ...process.env };

function request(body: string) {
  return new Request('https://app.example.com/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
}

describe('POST /api/oauth/token', () => {
  beforeEach(() => {
    mocks.exchangeAuthorizationCode.mockReset();
    mocks.refreshAccessToken.mockReset();
    mocks.consumeRateLimit.mockReset();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, limit: 30, used: 1, remaining: 29, resetAt: new Date(), retryAfterSeconds: 60 });
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
    expect((await POST(request('grant_type=authorization_code&client_id=x'))).status).toBe(404);
  });

  it('requires client_id and rejects duplicated parameters', async () => {
    expect((await POST(request('grant_type=authorization_code'))).status).toBe(400);
    const duplicated = await POST(request('grant_type=authorization_code&client_id=x&code=a&code=b'));
    expect(duplicated.status).toBe(400);
    expect(await duplicated.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects unsupported grant types', async () => {
    const response = await POST(request('grant_type=password&client_id=x'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  it('exchanges an authorization code with PKCE', async () => {
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      access_token: 'mcp_at_test',
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: 'mcp_rt_test',
      scope: 'campaigns:read'
    });
    const response = await POST(
      request('grant_type=authorization_code&client_id=mcp_client_test&code=abc&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_verifier=verifier')
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access_token: 'mcp_at_test', token_type: 'Bearer' });
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'mcp_client_test', code: 'abc', redirectUri: 'https://client.example/cb', codeVerifier: 'verifier' })
    );
  });

  it('rotates refresh tokens', async () => {
    mocks.refreshAccessToken.mockResolvedValue({
      access_token: 'mcp_at_new',
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: 'mcp_rt_new',
      scope: 'campaigns:read'
    });
    const response = await POST(request('grant_type=refresh_token&client_id=mcp_client_test&refresh_token=old'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ access_token: 'mcp_at_new', refresh_token: 'mcp_rt_new' });
  });

  it('returns invalid_grant for reused or expired tokens', async () => {
    mocks.exchangeAuthorizationCode.mockRejectedValue(new McpOAuthError('invalid_grant', 'O código de autorização é inválido ou expirou.', 400));
    const response = await POST(
      request('grant_type=authorization_code&client_id=mcp_client_test&code=abc&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_verifier=verifier')
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('rate limits token requests', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, limit: 30, used: 31, remaining: 0, resetAt: new Date(), retryAfterSeconds: 5 });
    const response = await POST(request('grant_type=refresh_token&client_id=x&refresh_token=y'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('5');
  });
});

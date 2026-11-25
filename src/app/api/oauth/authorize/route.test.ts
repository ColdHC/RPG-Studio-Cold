import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  validateClientRedirect: vi.fn(),
  validateAuthorizationRequest: vi.fn(),
  createAuthorizationCode: vi.fn(),
  consumeRateLimit: vi.fn()
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/requestRateLimit', () => ({ getClientIp: () => '203.0.113.1' }));
vi.mock('@/services/mcpAuthService', () => ({
  validateClientRedirect: mocks.validateClientRedirect,
  validateAuthorizationRequest: mocks.validateAuthorizationRequest,
  createAuthorizationCode: mocks.createAuthorizationCode
}));
vi.mock('@/services/mcpRateLimitService', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitKey: (scope: string, identifier: string) => `mcp:${scope}:${identifier}`
}));

import { POST } from './route';

const originalEnv = { ...process.env };
const user = { id: 'u1', name: 'User', email: 'user@example.com', createdAt: new Date('2026-01-01T00:00:00Z') };
const challenge = 'a'.repeat(43);

function request(body: object, headers: Record<string, string> = {}) {
  return new Request('https://app.example.com/api/oauth/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example.com', ...headers },
    body: JSON.stringify(body)
  });
}

function approval(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'mcp_client_test',
    redirect_uri: 'https://client.example/cb',
    response_type: 'code',
    scope: 'campaigns:read documents:read',
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://app.example.com/api/mcp',
    decision: 'approve',
    campaignIds: ['camp1'],
    ...overrides
  };
}

describe('POST /api/oauth/authorize', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.validateClientRedirect.mockResolvedValue({
      clientId: 'mcp_client_test',
      clientName: 'Test Client',
      redirectUri: 'https://client.example/cb'
    });
    mocks.validateAuthorizationRequest.mockResolvedValue({
      clientId: 'mcp_client_test',
      clientName: 'Test Client',
      redirectUri: 'https://client.example/cb',
      scopes: ['campaigns:read', 'documents:read'],
      state: 'state-1',
      codeChallenge: challenge,
      resource: 'https://app.example.com/api/mcp'
    });
    mocks.createAuthorizationCode.mockResolvedValue('mcp_code_test');
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

  it('rate limits by IP before looking up the session', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 11 });
    const response = await POST(request(approval()));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('11');
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it('requires a logged-in user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(request(approval()));
    expect(response.status).toBe(401);
  });

  it('rejects cross-site consent submissions', async () => {
    const response = await POST(request(approval(), { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it('does not create codes for unregistered redirect URIs', async () => {
    mocks.validateClientRedirect.mockResolvedValue(null);
    const response = await POST(request(approval()));
    expect(response.status).toBe(400);
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
  });

  it('issues a one-time code and redirects with state and issuer', async () => {
    const response = await POST(request(approval()));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { redirectTo: string };
    const target = new URL(payload.redirectTo);
    expect(target.origin + target.pathname).toBe('https://client.example/cb');
    expect(target.searchParams.get('code')).toBe('mcp_code_test');
    expect(target.searchParams.get('state')).toBe('state-1');
    expect(target.searchParams.get('iss')).toBe('https://app.example.com');
    expect(mocks.createAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({ user, campaignIds: ['camp1'] })
    );
  });

  it('redirects with access_denied when the user cancels', async () => {
    const response = await POST(request(approval({ decision: 'deny' })));
    const payload = (await response.json()) as { redirectTo: string };
    const target = new URL(payload.redirectTo);
    expect(target.searchParams.get('error')).toBe('access_denied');
    expect(target.searchParams.get('code')).toBeNull();
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
  });
});

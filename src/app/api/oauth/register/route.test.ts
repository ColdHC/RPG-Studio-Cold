import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerClient: vi.fn(),
  consumeRateLimit: vi.fn()
}));

vi.mock('@/services/mcpAuthService', () => ({ registerClient: mocks.registerClient }));
vi.mock('@/services/mcpRateLimitService', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitKey: (scope: string, identifier: string) => `mcp:${scope}:${identifier}`
}));

import { McpOAuthError } from '@/lib/mcp/errors';
import { POST } from './route';

const originalEnv = { ...process.env };

function request(body: unknown) {
  return new Request('https://app.example.com/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

describe('POST /api/oauth/register', () => {
  beforeEach(() => {
    mocks.registerClient.mockReset();
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
    expect((await POST(request({ redirect_uris: ['https://client.example/cb'] }))).status).toBe(404);
  });

  it('rate limits registrations', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, limit: 30, used: 31, remaining: 0, resetAt: new Date(), retryAfterSeconds: 12 });
    const response = await POST(request({ redirect_uris: ['https://client.example/cb'] }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
  });

  it('rejects invalid JSON and invalid metadata', async () => {
    expect((await POST(request('{'))).status).toBe(400);
    expect((await POST(request({ redirect_uris: [] }))).status).toBe(400);
    expect((await POST(request({ redirect_uris: ['https://client.example/cb'], extra: true }))).status).toBe(400);
  });

  it('maps OAuth metadata errors to 400', async () => {
    mocks.registerClient.mockRejectedValue(new McpOAuthError('invalid_redirect_uri', 'A redirect_uri é inválida.', 400));
    const response = await POST(request({ redirect_uris: ['http://client.example/cb'] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('returns the registered public client', async () => {
    mocks.registerClient.mockResolvedValue({
      client_id: 'mcp_client_test',
      client_id_issued_at: 1,
      client_name: 'Test',
      redirect_uris: ['https://client.example/cb'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'campaigns:read'
    });
    const response = await POST(request({ client_name: 'Test', redirect_uris: ['https://client.example/cb'] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ client_id: 'mcp_client_test', token_endpoint_auth_method: 'none' });
  });
});

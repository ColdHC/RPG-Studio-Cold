import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAccessToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  connect: vi.fn(),
  handleRequest: vi.fn()
}));

vi.mock('@/services/mcpAuthService', () => ({ validateAccessToken: mocks.validateAccessToken }));
vi.mock('@/services/mcpRateLimitService', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitKey: (scope: string, identifier: string) => `mcp:${scope}:${identifier}`
}));
vi.mock('@/lib/mcp/server', () => ({ createMcpServer: () => ({ connect: mocks.connect }) }));
vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest = mocks.handleRequest;
  }
}));

import { McpOAuthError } from '@/lib/mcp/errors';
import { POST, GET, OPTIONS } from './route';

const originalEnv = { ...process.env };

function validToken() {
  return {
    tokenId: 'tok1',
    userId: 'u1',
    clientId: 'client1',
    connectionId: 'conn1',
    scopes: ['campaigns:read'],
    campaignIds: ['camp1'],
    resource: 'https://app.example.com/api/mcp',
    expiresAt: new Date(Date.now() + 900_000),
    user: { id: 'u1', name: 'User', email: 'user@example.com', createdAt: new Date('2026-01-01T00:00:00Z') }
  };
}

function allowedRateLimit() {
  return { allowed: true, limit: 60, used: 1, remaining: 59, resetAt: new Date(Date.now() + 60_000), retryAfterSeconds: 60 };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.example.com/api/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function toolCall(name = 'list_campaigns') {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } };
}

describe('MCP HTTP boundary', () => {
  beforeEach(() => {
    mocks.validateAccessToken.mockReset();
    mocks.consumeRateLimit.mockReset();
    mocks.connect.mockReset();
    mocks.handleRequest.mockReset();
    mocks.connect.mockResolvedValue(undefined);
    mocks.validateAccessToken.mockResolvedValue(validToken());
    mocks.consumeRateLimit.mockResolvedValue(allowedRateLimit());
    mocks.handleRequest.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', result: { ok: true }, id: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com';
    delete process.env.MCP_ALLOWED_ORIGINS;
    delete process.env.MCP_MAX_ARGUMENT_BYTES;
    delete process.env.MCP_MAX_RESPONSE_BYTES;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it('returns 404 when MCP is disabled', async () => {
    delete process.env.MCP_ENABLED;
    const response = await POST(request(toolCall()));
    expect(response.status).toBe(404);
  });

  it('requires a bearer token and advertises resource metadata', async () => {
    const response = await POST(
      new Request('https://app.example.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toolCall())
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"');
  });

  it('rejects invalid tokens with 401', async () => {
    mocks.validateAccessToken.mockRejectedValue(new McpOAuthError('invalid_token', 'Token inválido ou expirado.', 401));
    const response = await POST(request(toolCall()));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('rejects unknown browser origins', async () => {
    const response = await POST(request(toolCall(), { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);
  });

  it('rate limits requests before validating the token', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ ...allowedRateLimit(), allowed: false, retryAfterSeconds: 7 });
    const response = await POST(request(toolCall()));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(mocks.validateAccessToken).not.toHaveBeenCalled();
  });

  it('returns HTTP 429 when the distributed tool budget is exhausted', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ ...allowedRateLimit(), allowed: false, retryAfterSeconds: 42 });
    const response = await POST(request(toolCall()));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
  });

  it('passes the validated user and campaign grants to the MCP transport', async () => {
    const response = await POST(request(toolCall()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { ok: true } });
    const authInfo = mocks.handleRequest.mock.calls[0]![1].authInfo;
    expect(authInfo.clientId).toBe('client1');
    expect(authInfo.extra.mcp.campaignIds).toEqual(['camp1']);
    expect(authInfo.extra.mcp.user.id).toBe('u1');
  });

  it('rejects oversized request bodies before invoking the transport', async () => {
    process.env.MCP_MAX_ARGUMENT_BYTES = '1024';
    const response = await POST(
      new Request('https://app.example.com/api/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: 'a'.repeat(2048)
      })
    );
    expect(response.status).toBe(413);
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });

  it('rejects oversized responses', async () => {
    process.env.MCP_MAX_RESPONSE_BYTES = '16384';
    mocks.handleRequest.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', result: { data: 'x'.repeat(20_000) }, id: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const response = await POST(request(toolCall()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ error: { message: 'A resposta excede o limite configurado.' } });
  });

  it('does not expose GET/DELETE streams in stateless mode', async () => {
    const response = await GET(new Request('https://app.example.com/api/mcp', { headers: { authorization: 'Bearer test-token' } }));
    expect(response.status).toBe(405);
  });

  it('answers CORS preflight without authentication', async () => {
    const response = await OPTIONS(new Request('https://app.example.com/api/mcp', { method: 'OPTIONS', headers: { origin: 'https://app.example.com' } }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });
});

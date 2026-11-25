import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMcpConfig } from './config';
import {
  bearerToken,
  corsHeaders,
  hasDuplicateParameter,
  isSameSiteRequest,
  isAllowedOrigin,
  readBodyWithLimit,
  wwwAuthenticateHeader
} from './http';

const originalEnv = { ...process.env };

function config() {
  return getMcpConfig(new Request('https://app.example.com/api/mcp'));
}

describe('MCP HTTP helpers', () => {
  beforeEach(() => {
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com';
    delete process.env.MCP_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it('parses only well-formed bearer headers', () => {
    expect(bearerToken(new Request('https://x', { headers: { authorization: 'Bearer abc.def' } }))).toBe('abc.def');
    expect(bearerToken(new Request('https://x', { headers: { authorization: 'bearer abc' } }))).toBe('abc');
    expect(bearerToken(new Request('https://x', { headers: { authorization: 'Basic abc' } }))).toBeNull();
    expect(bearerToken(new Request('https://x', { headers: { authorization: 'Bearer' } }))).toBeNull();
    expect(bearerToken(new Request('https://x'))).toBeNull();
  });

  it('enforces the body size limit', async () => {
    const small = await readBodyWithLimit(new Request('https://x', { method: 'POST', body: 'hello' }), 10);
    expect(small).toEqual({ text: 'hello', tooLarge: false });
    const large = await readBodyWithLimit(new Request('https://x', { method: 'POST', body: 'a'.repeat(100) }), 10);
    expect(large.tooLarge).toBe(true);
  });

  it('validates origins against the public URL and explicit allowlist', () => {
    const mcpConfig = config();
    expect(isAllowedOrigin(new Request('https://app.example.com/api/mcp'), mcpConfig)).toBe(true);
    expect(isAllowedOrigin(new Request('https://app.example.com/api/mcp', { headers: { origin: 'https://app.example.com' } }), mcpConfig)).toBe(true);
    expect(isAllowedOrigin(new Request('https://app.example.com/api/mcp', { headers: { origin: 'https://evil.example' } }), mcpConfig)).toBe(false);
    expect(isAllowedOrigin(new Request('https://app.example.com/api/mcp', { headers: { origin: 'not-a-url' } }), mcpConfig)).toBe(false);
    process.env.MCP_ALLOWED_ORIGINS = 'https://inspector.example';
    expect(isAllowedOrigin(new Request('https://app.example.com/api/mcp', { headers: { origin: 'https://inspector.example' } }), mcpConfig)).toBe(true);
  });

  it('emits CORS headers only for allowed origins unless explicitly open', () => {
    const mcpConfig = config();
    const allowed = new Request('https://app.example.com/api/mcp', { headers: { origin: 'https://app.example.com' } });
    expect(corsHeaders(allowed, mcpConfig)['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    const evil = new Request('https://app.example.com/api/mcp', { headers: { origin: 'https://evil.example' } });
    expect(corsHeaders(evil, mcpConfig)).toEqual({});
    expect(corsHeaders(evil, mcpConfig, { allowAnyOrigin: true })['Access-Control-Allow-Origin']).toBe('*');
  });

  it('advertises the protected resource metadata in WWW-Authenticate', () => {
    const header = wwwAuthenticateHeader(config(), { error: 'invalid_token', description: 'expirado' });
    expect(header).toContain('resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"');
    expect(header).toContain('error="invalid_token"');
  });

  it('normalizes origins when checking same-site consent requests', () => {
    const mcpConfig = config();
    expect(isSameSiteRequest(new Request('https://app.example.com/api/oauth/authorize'), mcpConfig)).toBe(true);
    expect(
      isSameSiteRequest(
        new Request('https://app.example.com/api/oauth/authorize', { headers: { origin: 'https://app.example.com:443' } }),
        mcpConfig
      )
    ).toBe(true);
    expect(
      isSameSiteRequest(
        new Request('https://app.example.com/api/oauth/authorize', { headers: { origin: 'not-an-origin' } }),
        mcpConfig
      )
    ).toBe(false);
  });

  it('detects duplicate OAuth parameters', () => {
    const params = new URLSearchParams('grant_type=authorization_code&code=a&code=b');
    expect(hasDuplicateParameter(params, ['grant_type', 'code'])).toBe(true);
    expect(hasDuplicateParameter(params, ['grant_type'])).toBe(false);
  });
});

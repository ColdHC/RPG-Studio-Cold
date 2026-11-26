import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMcpConfig, isMcpEnabled, MCP_SCOPES, parseRequestedScopes } from './config';

const originalEnv = { ...process.env };

function resetMcpEnv() {
  delete process.env.MCP_ENABLED;
  delete process.env.MCP_PUBLIC_BASE_URL;
  delete process.env.MCP_ALLOWED_ORIGINS;
  delete process.env.MCP_EXPOSE_MEDIA_URLS;
  delete process.env.MCP_MAX_PAGE_SIZE;
}

describe('MCP configuration', () => {
  beforeEach(resetMcpEnv);
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it('is disabled by default', () => {
    expect(isMcpEnabled()).toBe(false);
    expect(() => getMcpConfig()).toThrow(/MCP desabilitado/);
  });

  it('builds the canonical resource and metadata URLs', () => {
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com';
    const config = getMcpConfig();
    expect(config.resource).toBe('https://app.example.com/api/mcp');
    expect(config.resourceMetadataUrl).toBe('https://app.example.com/.well-known/oauth-protected-resource/api/mcp');
    expect(config.issuer).toBe('https://app.example.com');
    expect(config.defaultPageSize).toBe(20);
    expect(config.maxPageSize).toBe(100);
    expect(config.requestRateLimitPerMinute).toBe(300);
  });

  it('rejects insecure or malformed public URLs', () => {
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'http://app.example.com';
    expect(() => getMcpConfig()).toThrow(/HTTPS/);
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com/path';
    expect(() => getMcpConfig()).toThrow(/sem caminho/);
    process.env.MCP_PUBLIC_BASE_URL = 'https://user:pass@app.example.com';
    expect(() => getMcpConfig()).toThrow(/credenciais/);
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com?x=1';
    expect(() => getMcpConfig()).toThrow(/query string/);
  });

  it('accepts loopback HTTP only outside production', () => {
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'http://localhost:3000';
    expect(getMcpConfig().baseUrl).toBe('http://localhost:3000');
  });

  it('fails closed when an integer limit is invalid', () => {
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_BASE_URL = 'https://app.example.com';
    process.env.MCP_MAX_PAGE_SIZE = '500';
    expect(() => getMcpConfig()).toThrow(/MCP_MAX_PAGE_SIZE/);
  });

  it('parses scopes strictly', () => {
    expect(parseRequestedScopes(null)).toEqual([...MCP_SCOPES]);
    expect(parseRequestedScopes('campaigns:read documents:read')).toEqual(['campaigns:read', 'documents:read']);
    expect(parseRequestedScopes('campaigns:read campaigns:read')).toEqual(['campaigns:read']);
    expect(parseRequestedScopes('campaigns:read unknown:read')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET } from './route';

const originalEnv = { ...process.env };

describe('GET oauth-protected-resource metadata', () => {
  beforeEach(() => {
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

  it('returns 404 when MCP is disabled', async () => {
    delete process.env.MCP_ENABLED;
    expect((await GET(new Request('https://app.example.com/.well-known/oauth-protected-resource'))).status).toBe(404);
  });

  it('advertises the canonical resource and authorization server', async () => {
    const response = await GET(new Request('https://app.example.com/.well-known/oauth-protected-resource'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: 'https://app.example.com/api/mcp',
      authorization_servers: ['https://app.example.com'],
      bearer_methods_supported: ['header']
    });
  });
});

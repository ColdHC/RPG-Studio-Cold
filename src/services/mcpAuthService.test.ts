import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientFindUnique: vi.fn(),
  clientCreate: vi.fn(),
  campaignFindMany: vi.fn(),
  refreshFindUnique: vi.fn(),
  refreshUpdateMany: vi.fn(),
  clientUpdate: vi.fn(),
  connectionUpdate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mcpOAuthClient: {
      findUnique: mocks.clientFindUnique,
      create: mocks.clientCreate,
      update: mocks.clientUpdate
    },
    mcpConnection: { update: mocks.connectionUpdate },
    mcpRefreshToken: {
      findUnique: mocks.refreshFindUnique,
      updateMany: mocks.refreshUpdateMany
    },
    campaign: { findMany: mocks.campaignFindMany },
    $transaction: mocks.transaction
  }
}));

vi.mock('@/services/auditService', () => ({ recordAudit: mocks.audit }));

import { getMcpConfig } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import {
  accessibleCampaignsForUser,
  refreshAccessToken,
  registerClient,
  validateAuthorizationRequest,
  validateRedirectUri
} from './mcpAuthService';

const originalEnv = { ...process.env };
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function clientRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'internal-client',
    clientId: 'mcp_client_test',
    clientName: 'Test Client',
    redirectUris: ['https://client.example/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    clientUri: null,
    logoUri: null,
    contacts: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: null,
    ...overrides
  };
}

function config() {
  return getMcpConfig(new Request('https://app.example.com/api/mcp'));
}

describe('MCP OAuth validation', () => {
  beforeEach(() => {
    mocks.clientFindUnique.mockReset();
    mocks.clientCreate.mockReset();
    mocks.campaignFindMany.mockReset();
    mocks.refreshFindUnique.mockReset();
    mocks.refreshUpdateMany.mockReset();
    mocks.clientUpdate.mockReset();
    mocks.connectionUpdate.mockReset();
    mocks.transaction.mockReset();
    mocks.audit.mockReset();
    mocks.audit.mockResolvedValue(undefined);
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

  it('accepts HTTPS and loopback redirect URIs only', () => {
    expect(validateRedirectUri('https://client.example/callback')).toBe('https://client.example/callback');
    expect(validateRedirectUri('http://localhost:7777/callback')).toBe('http://localhost:7777/callback');
    expect(validateRedirectUri('http://127.0.0.1:7777/callback')).toBe('http://127.0.0.1:7777/callback');
    expect(() => validateRedirectUri('http://client.example/callback')).toThrow(McpOAuthError);
    expect(() => validateRedirectUri('https://client.example/callback#fragment')).toThrow(McpOAuthError);
    expect(() => validateRedirectUri('https://user:pass@client.example/callback')).toThrow(McpOAuthError);
    expect(() => validateRedirectUri('javascript:alert(1)')).toThrow(McpOAuthError);
  });

  it('registers public clients and rejects unsupported metadata', async () => {
    mocks.clientCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => clientRecord(data));
    const result = await registerClient({
      clientName: 'Claude',
      redirectUris: ['https://client.example/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      clientUri: 'https://client.example'
    });
    expect(result.client_id).toMatch(/^mcp_client_/);
    expect(result.token_endpoint_auth_method).toBe('none');
    expect(result.redirect_uris).toEqual(['https://client.example/callback']);

    await expect(registerClient({ redirectUris: ['https://client.example/callback'], tokenEndpointAuthMethod: 'client_secret_basic' })).rejects.toMatchObject({
      code: 'invalid_client_metadata'
    });
    await expect(registerClient({ redirectUris: ['https://client.example/callback'], clientUri: 'javascript:alert(1)' })).rejects.toMatchObject({
      code: 'invalid_client_metadata'
    });
    await expect(registerClient({ redirectUris: ['http://client.example/callback'] })).rejects.toMatchObject({
      code: 'invalid_redirect_uri'
    });
  });

  it('validates PKCE, exact redirect URI, resource and scopes', async () => {
    mocks.clientFindUnique.mockResolvedValue(clientRecord());
    const valid = await validateAuthorizationRequest(
      {
        clientId: 'mcp_client_test',
        redirectUri: 'https://client.example/callback',
        responseType: 'code',
        scope: 'campaigns:read documents:read',
        state: 'state-1',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        resource: 'https://app.example.com/api/mcp'
      },
      config()
    );
    expect(valid.scopes).toEqual(['campaigns:read', 'documents:read']);
    expect(valid.resource).toBe('https://app.example.com/api/mcp');

    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'mcp_client_test',
          redirectUri: 'https://evil.example/callback',
          responseType: 'code',
          scope: null,
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          resource: null
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'mcp_client_test',
          redirectUri: 'https://client.example/callback',
          responseType: 'code',
          scope: null,
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'plain',
          resource: null
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'mcp_client_test',
          redirectUri: 'https://client.example/callback',
          responseType: 'code',
          scope: null,
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          resource: 'https://other.example/api/mcp'
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_target' });

    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'mcp_client_test',
          redirectUri: 'https://client.example/callback',
          responseType: 'code',
          scope: 'admin:write',
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          resource: null
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_scope' });
  });

  it('rejects inactive or unknown clients', async () => {
    mocks.clientFindUnique.mockResolvedValue(clientRecord({ isActive: false }));
    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'mcp_client_test',
          redirectUri: 'https://client.example/callback',
          responseType: 'code',
          scope: null,
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          resource: null
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_client' });

    mocks.clientFindUnique.mockResolvedValue(null);
    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'missing',
          redirectUri: 'https://client.example/callback',
          responseType: 'code',
          scope: null,
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          resource: null
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('persists the registered scope subset and refuses broader authorization requests', async () => {
    mocks.clientCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => clientRecord(data));
    const registered = await registerClient({
      redirectUris: ['https://client.example/callback'],
      grantTypes: ['authorization_code'],
      scope: 'campaigns:read'
    });
    expect(registered.scope).toBe('campaigns:read');
    expect(registered.grant_types).toEqual(['authorization_code']);

    mocks.clientFindUnique.mockResolvedValue(clientRecord({ allowedScopes: ['campaigns:read'] }));
    await expect(
      validateAuthorizationRequest(
        {
          clientId: 'mcp_client_test',
          redirectUri: 'https://client.example/callback',
          responseType: 'code',
          scope: 'campaigns:read documents:read',
          state: null,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          resource: null
        },
        config()
      )
    ).rejects.toMatchObject({ code: 'invalid_scope' });
  });

  it('defaults omitted authorization scopes to the scopes registered by the client', async () => {
    mocks.clientFindUnique.mockResolvedValue(clientRecord({ allowedScopes: ['campaigns:read'] }));
    const validated = await validateAuthorizationRequest(
      {
        clientId: 'mcp_client_test',
        redirectUri: 'https://client.example/callback',
        responseType: 'code',
        scope: null,
        state: null,
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        resource: null
      },
      config()
    );
    expect(validated.scopes).toEqual(['campaigns:read']);
  });

  it('refuses refresh tokens for clients that did not register refresh_token', async () => {
    const mcpConfig = config();
    mocks.refreshFindUnique.mockResolvedValue({
      id: 'rt1',
      tokenHash: 'hash',
      connectionId: 'conn1',
      userId: 'u1',
      clientId: 'mcp_client_test',
      scopes: ['campaigns:read'],
      resource: mcpConfig.resource,
      expiresAt: new Date(Date.now() + 60_000),
      rotatedAt: null,
      revokedAt: null,
      client: clientRecord({ grantTypes: ['authorization_code'] }),
      connection: { id: 'conn1', resource: mcpConfig.resource, revokedAt: null }
    });

    await expect(
      refreshAccessToken({
        refreshToken: 'mcp_rt_raw',
        clientId: 'mcp_client_test',
        resource: null,
        config: mcpConfig
      })
    ).rejects.toMatchObject({ code: 'unauthorized_client' });
    expect(mocks.refreshUpdateMany).not.toHaveBeenCalled();
  });

  it('excludes archived campaigns from the consent list and from grants', async () => {
    mocks.campaignFindMany.mockResolvedValue([]);
    await accessibleCampaignsForUser('u1');
    const where = mocks.campaignFindMany.mock.calls[0]![0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ isArchived: false }]));
  });
});

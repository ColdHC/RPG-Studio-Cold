import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCampaignAccessForUser: vi.fn(),
  getViewerContextForUser: vi.fn(),
  publishedFileWhere: vi.fn((viewer: { campaignId: string }) => ({ campaignId: viewer.campaignId })),
  campaignFindUnique: vi.fn(),
  campaignFileFindFirst: vi.fn(),
  campaignFileFindMany: vi.fn(),
  campaignFileGroupBy: vi.fn(),
  relationshipFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionFindFirst: vi.fn()
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: mocks.campaignFindUnique },
    campaignFile: {
      findFirst: mocks.campaignFileFindFirst,
      findMany: mocks.campaignFileFindMany,
      groupBy: mocks.campaignFileGroupBy
    },
    relationship: { findMany: mocks.relationshipFindMany },
    session: { findMany: mocks.sessionFindMany, findFirst: mocks.sessionFindFirst }
  }
}));

vi.mock('@/lib/access', () => ({ getCampaignAccessForUser: mocks.getCampaignAccessForUser }));
vi.mock('@/lib/publicationPolicy', () => ({
  getViewerContextForUser: mocks.getViewerContextForUser,
  publishedFileWhere: mocks.publishedFileWhere
}));

import { getMcpConfig, MCP_SCOPES } from '@/lib/mcp/config';
import { McpToolError } from '@/lib/mcp/errors';
import { mcpToolService, type McpToolContext } from './mcpToolService';

const originalEnv = { ...process.env };
const user = { id: 'u1', name: 'User', email: 'user@example.com', createdAt: new Date('2026-01-01T00:00:00Z') };

function config() {
  return getMcpConfig(new Request('https://app.example.com/api/mcp'));
}

function context(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    user,
    campaignIds: ['camp1', 'camp2'],
    scopes: [...MCP_SCOPES],
    clientId: 'mcp_client_test',
    connectionId: 'conn1',
    config: config(),
    ...overrides
  };
}

function ownerAccess(campaignId = 'camp1') {
  return { role: 'OWNER', campaign: { id: campaignId, ownerId: 'u1', isArchived: false }, user };
}

function playerAccess(campaignId = 'camp1') {
  return { role: 'PLAYER', campaign: { id: campaignId, ownerId: 'u2', isArchived: false }, user };
}

describe('MCP read-only tools', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
    }
    mocks.publishedFileWhere.mockImplementation((viewer: { campaignId: string }) => ({ campaignId: viewer.campaignId }));
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

  it('rejects campaigns outside the explicit grant before touching the database', async () => {
    await expect(mcpToolService.listDocuments(context(), { campaignId: 'camp-other' })).rejects.toMatchObject({
      publicMessage: 'Campanha não encontrada.',
      status: 404
    });
    expect(mocks.getCampaignAccessForUser).not.toHaveBeenCalled();
  });

  it('rejects tools without the required scope', async () => {
    await expect(mcpToolService.listDocuments(context({ scopes: [] }), { campaignId: 'camp1' })).rejects.toMatchObject({
      status: 403
    });
  });

  it('returns 404 instead of leaking a file from another campaign', async () => {
    mocks.getCampaignAccessForUser.mockResolvedValue(ownerAccess());
    mocks.getViewerContextForUser.mockResolvedValue({ kind: 'OWNER', campaignId: 'camp1', userId: 'u1' });
    mocks.campaignFileFindFirst.mockResolvedValue(null);
    await expect(mcpToolService.getDocument(context(), { campaignId: 'camp1', documentId: 'file-from-camp2' })).rejects.toMatchObject({
      status: 404
    });
  });

  it('keeps session planning owner-only', async () => {
    mocks.getCampaignAccessForUser.mockResolvedValue(playerAccess());
    await expect(mcpToolService.listSessions(context(), { campaignId: 'camp1' })).rejects.toMatchObject({
      status: 403
    });
    expect(mocks.sessionFindMany).not.toHaveBeenCalled();
  });

  it('applies relationship audience and endpoint visibility for players', async () => {
    mocks.getCampaignAccessForUser.mockResolvedValue(playerAccess());
    mocks.getViewerContextForUser.mockResolvedValue({ kind: 'PLAYER', campaignId: 'camp1', userId: 'u1', audience: 'P1' });
    mocks.campaignFileFindMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    mocks.relationshipFindMany.mockResolvedValue([]);

    const result = await mcpToolService.getRelationships(context(), { campaignId: 'camp1' });
    expect(result.relationships).toEqual([]);
    const where = mocks.relationshipFindMany.mock.calls[0]![0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { campaignId: 'camp1' },
        { visibility: { in: ['ALL', 'P1'] } },
        { fromId: { in: ['f1', 'f2'] } },
        { toId: { in: ['f1', 'f2'] } }
      ])
    );
  });

  it('rejects a relationship request for an invisible entity', async () => {
    mocks.getCampaignAccessForUser.mockResolvedValue(playerAccess());
    mocks.getViewerContextForUser.mockResolvedValue({ kind: 'PLAYER', campaignId: 'camp1', userId: 'u1', audience: 'P1' });
    mocks.campaignFileFindFirst.mockResolvedValue(null);
    await expect(
      mcpToolService.getRelationships(context(), { campaignId: 'camp1', entityId: 'hidden' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns campaign counts without exposing file content', async () => {
    mocks.getCampaignAccessForUser.mockResolvedValue(ownerAccess());
    mocks.getViewerContextForUser.mockResolvedValue({ kind: 'OWNER', campaignId: 'camp1', userId: 'u1' });
    mocks.campaignFindUnique.mockResolvedValue({
      id: 'camp1',
      name: 'Campaign',
      description: 'Description',
      system: 'CUSTOM',
      isArchived: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z')
    });
    mocks.campaignFileGroupBy.mockResolvedValue([{ type: 'NPC', _count: { _all: 3 } }]);

    const result = await mcpToolService.getCampaign(context(), { campaignId: 'camp1' });
    expect(result).toMatchObject({ id: 'camp1', name: 'Campaign', role: 'OWNER', countsByType: { NPC: 3 } });
    expect(result).not.toHaveProperty('content');
  });

  it('returns preset attributes for built-in systems', async () => {
    mocks.getCampaignAccessForUser.mockResolvedValue(ownerAccess());
    mocks.campaignFindUnique.mockResolvedValue({
      system: 'ORDEM_PARANORMAL',
      attributes: [],
      skills: [],
      classes: [],
      races: []
    });
    const result = await mcpToolService.getRpgSystem(context(), { campaignId: 'camp1' });
    expect(result.system).toBe('ORDEM_PARANORMAL');
    expect(result.attributes.length).toBeGreaterThan(0);
    expect(result.skills.length).toBeGreaterThan(0);
  });

  it('throws typed public errors only', async () => {
    const error = new McpToolError('Documento não encontrado.', 404);
    expect(error.publicMessage).toBe('Documento não encontrado.');
    expect(error.status).toBe(404);
  });
});

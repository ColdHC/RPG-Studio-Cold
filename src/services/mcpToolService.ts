import { Prisma, type FileType } from '@prisma/client';
import { getCampaignAccessForUser, type CampaignAccess } from '@/lib/access';
import type { PublicUser } from '@/lib/auth';
import type { McpConfig } from '@/lib/mcp/config';
import { McpToolError } from '@/lib/mcp/errors';
import { decodeCursor, encodeCursor, truncateText } from '@/lib/mcp/tokens';
import { getViewerContextForUser, publishedFileWhere, type ViewerContext } from '@/lib/publicationPolicy';
import { prisma } from '@/lib/prisma';
import { visibleRelationshipAudiences } from '@/lib/relationshipVisibility';
import {
  DND5E_ATTRIBUTES,
  DND5E_SKILLS,
  ORDEM_PARANORMAL_ATTRIBUTES,
  ORDEM_PARANORMAL_SKILLS,
  THREEDET_VICTORY_ATTRIBUTES,
  THREEDET_VICTORY_SKILLS
} from '@/lib/systemPresets';

export const ENTITY_TYPES = ['NPC', 'CHARACTER', 'THREAT', 'LOCATION', 'OBJECT', 'CLUE', 'PUZZLE'] as const;
export const FILE_TYPES = [
  'CAMPAIGN',
  'NPC',
  'CHARACTER',
  'THREAT',
  'PUZZLE',
  'DOCUMENT',
  'CLUE',
  'OBJECT',
  'EVENT',
  'SESSION',
  'MAP',
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'NOTE',
  'LOCATION'
] as const;

export type McpToolContext = {
  user: PublicUser;
  campaignIds: string[];
  scopes: string[];
  clientId: string;
  connectionId: string;
  config: McpConfig;
};

type Pagination = { limit: number; skip: number };

function pagination(ctx: McpToolContext, input: { limit?: number; cursor?: string | null }): Pagination {
  const limit = Math.min(Math.max(input.limit ?? ctx.config.defaultPageSize, 1), ctx.config.maxPageSize);
  const skip = decodeCursor(input.cursor, 1_000_000);
  if (skip === null) throw new McpToolError('cursor inválido.', 400);
  return { limit, skip };
}

function nextCursor(skip: number, limit: number, count: number) {
  return count > limit ? encodeCursor(skip + limit) : null;
}

function requireScope(ctx: McpToolContext, scope: string) {
  if (!ctx.scopes.includes(scope)) {
    throw new McpToolError('O token não possui o escopo necessário para esta consulta.', 403);
  }
}

async function campaignAccess(ctx: McpToolContext, campaignId: string): Promise<CampaignAccess> {
  if (!ctx.campaignIds.includes(campaignId)) {
    throw new McpToolError('Campanha não encontrada.', 404);
  }
  try {
    return await getCampaignAccessForUser(ctx.user, campaignId);
  } catch {
    throw new McpToolError('Campanha não encontrada.', 404);
  }
}

async function viewerFor(ctx: McpToolContext, campaignId: string): Promise<ViewerContext> {
  try {
    return await getViewerContextForUser(ctx.user, campaignId, { requirePlayerMode: true });
  } catch {
    throw new McpToolError('Campanha não encontrada.', 404);
  }
}

function activeWhere(viewer: ViewerContext, options: { includeArchived?: boolean } = {}): Prisma.CampaignFileWhereInput {
  return {
    ...publishedFileWhere(viewer),
    isTrashed: false,
    ...(options.includeArchived ? {} : { isArchived: false })
  };
}

function fileSummary(file: {
  id: string;
  campaignId: string;
  type: FileType;
  name: string;
  description: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags?: { tag: { id: string; name: string; color: string | null; icon: string | null } }[];
}) {
  return {
    id: file.id,
    campaignId: file.campaignId,
    type: file.type,
    name: file.name,
    description: file.description,
    isArchived: file.isArchived,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    tags: (file.tags ?? []).map((entry) => entry.tag)
  };
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (depth >= 6) return '[omitido]';
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitizeJson(entry, depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 200);
    return Object.fromEntries(entries.map(([key, entry]) => [key.slice(0, 200), sanitizeJson(entry, depth + 1)]));
  }
  return null;
}

function boundedJson(value: unknown, maxBytes: number) {
  const sanitized = sanitizeJson(value);
  const serialized = JSON.stringify(sanitized) ?? 'null';
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= maxBytes) return { value: sanitized, truncated: false, bytes };
  return { value: { truncated: true, originalBytes: bytes }, truncated: true, bytes };
}

function mediaUrlAllowed(url: string, config: McpConfig) {
  if (url.includes('\\') || /[\u0000-\u001f\u007f]/.test(url)) return false;
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('..')) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.origin === config.baseUrl) return true;
    return config.allowedMediaHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function attachmentSummary(
  attachment: { id: string; label: string | null; mimeType: string | null; url: string },
  config: McpConfig
) {
  return {
    id: attachment.id,
    label: attachment.label,
    mimeType: attachment.mimeType,
    ...(config.exposeMediaUrls && mediaUrlAllowed(attachment.url, config) ? { url: attachment.url } : {})
  };
}

const fileDetailSelect = {
  id: true,
  campaignId: true,
  type: true,
  name: true,
  description: true,
  content: true,
  data: true,
  isArchived: true,
  isTrashed: true,
  restrictToGrants: true,
  createdAt: true,
  updatedAt: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true, icon: true } } } },
  attachments: { select: { id: true, label: true, mimeType: true, url: true } }
} satisfies Prisma.CampaignFileSelect;

type FileDetail = Prisma.CampaignFileGetPayload<{ select: typeof fileDetailSelect }>;

function fileDetail(file: FileDetail, config: McpConfig) {
  const content = file.content ? truncateText(file.content, config.maxContentChars) : { text: null, truncated: false };
  const data = boundedJson(file.data, Math.min(config.maxResponseBytes, 131_072));
  return {
    ...fileSummary(file),
    content: content.text,
    contentTruncated: content.truncated,
    data: data.value,
    dataTruncated: data.truncated,
    restrictToGrants: file.restrictToGrants,
    attachments: file.attachments.map((attachment) => attachmentSummary(attachment, config))
  };
}

async function findVisibleFile(
  ctx: McpToolContext,
  campaignId: string,
  fileId: string,
  options: { type?: FileType; allowedTypes?: readonly string[] } = {}
): Promise<FileDetail> {
  const viewer = await viewerFor(ctx, campaignId);
  const file = await prisma.campaignFile.findFirst({
    where: {
      ...activeWhere(viewer),
      id: fileId,
      ...(options.type ? { type: options.type } : {}),
      ...(options.allowedTypes ? { type: { in: options.allowedTypes as FileType[] } } : {})
    },
    select: fileDetailSelect
  });
  if (!file) throw new McpToolError('Documento não encontrado.', 404);
  return file;
}

function searchSnippet(content: string | null, query: string, maxLength = 180) {
  if (!content) return null;
  const index = content.toLocaleLowerCase('pt-BR').indexOf(query.toLocaleLowerCase('pt-BR'));
  if (index < 0) return truncateText(content, maxLength).text;
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const snippet = content.slice(start, start + maxLength);
  return `${start > 0 ? '…' : ''}${snippet}${start + maxLength < content.length ? '…' : ''}`;
}

export const mcpToolService = {
  async listCampaigns(ctx: McpToolContext, input: { limit?: number; cursor?: string | null }) {
    requireScope(ctx, 'campaigns:read');
    const { limit, skip } = pagination(ctx, input);
    const campaigns = await prisma.campaign.findMany({
      where: {
        id: { in: ctx.campaignIds },
        AND: [
          { OR: [{ ownerId: ctx.user.id }, { members: { some: { userId: ctx.user.id } } }] },
          { OR: [{ ownerId: ctx.user.id }, { isArchived: false }] }
        ]
      },
      select: {
        id: true,
        name: true,
        description: true,
        system: true,
        isArchived: true,
        ownerId: true,
        updatedAt: true,
        members: { where: { userId: ctx.user.id }, select: { audience: true } }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit + 1
    });
    return {
      campaigns: campaigns.slice(0, limit).map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        system: campaign.system,
        isArchived: campaign.isArchived,
        role: campaign.ownerId === ctx.user.id ? 'OWNER' : 'PLAYER',
        audience: campaign.members[0]?.audience ?? null,
        updatedAt: campaign.updatedAt.toISOString()
      })),
      nextCursor: nextCursor(skip, limit, campaigns.length)
    };
  },

  async getCampaign(ctx: McpToolContext, input: { campaignId: string }) {
    requireScope(ctx, 'campaigns:read');
    const access = await campaignAccess(ctx, input.campaignId);
    const campaign = await prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: {
        id: true,
        name: true,
        description: true,
        system: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!campaign) throw new McpToolError('Campanha não encontrada.', 404);
    const viewer = await viewerFor(ctx, input.campaignId);
    const counts = await prisma.campaignFile.groupBy({
      by: ['type'],
      where: { ...activeWhere(viewer), isArchived: false },
      _count: { _all: true }
    });
    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      system: campaign.system,
      isArchived: campaign.isArchived,
      role: access.role,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
      countsByType: Object.fromEntries(counts.map((entry) => [entry.type, entry._count._all]))
    };
  },

  async listDocuments(
    ctx: McpToolContext,
    input: {
      campaignId: string;
      type?: (typeof FILE_TYPES)[number];
      query?: string;
      tag?: string;
      includeArchived?: boolean;
      limit?: number;
      cursor?: string | null;
    }
  ) {
    requireScope(ctx, 'documents:read');
    await campaignAccess(ctx, input.campaignId);
    const viewer = await viewerFor(ctx, input.campaignId);
    const { limit, skip } = pagination(ctx, input);
    const query = input.query?.trim();
    const tag = input.tag?.trim();
    const files = await prisma.campaignFile.findMany({
      where: {
        AND: [
          activeWhere(viewer, { includeArchived: input.includeArchived }),
          input.type ? { type: input.type as FileType } : {},
          query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { description: { contains: query, mode: 'insensitive' } },
                  { content: { contains: query, mode: 'insensitive' } },
                  { tags: { some: { tag: { name: { contains: query, mode: 'insensitive' } } } } }
                ]
              }
            : {},
          tag ? { tags: { some: { tag: { name: { equals: tag, mode: 'insensitive' } } } } } : {}
        ]
      },
      select: {
        id: true,
        campaignId: true,
        type: true,
        name: true,
        description: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true, icon: true } } } }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit + 1
    });
    return {
      campaignId: input.campaignId,
      documents: files.slice(0, limit).map(fileSummary),
      nextCursor: nextCursor(skip, limit, files.length)
    };
  },

  async searchDocuments(
    ctx: McpToolContext,
    input: { campaignId?: string; query: string; types?: (typeof FILE_TYPES)[number][]; limit?: number; cursor?: string | null }
  ) {
    requireScope(ctx, 'documents:read');
    const query = input.query.trim().slice(0, 200);
    if (query.length < 2) throw new McpToolError('A busca precisa ter pelo menos 2 caracteres.', 400);
    const { limit, skip } = pagination(ctx, input);

    const campaignIds = input.campaignId ? [input.campaignId] : ctx.campaignIds;
    if (input.campaignId) await campaignAccess(ctx, input.campaignId);
    const viewerResults = await Promise.allSettled(campaignIds.map((campaignId) => viewerFor(ctx, campaignId)));
    const viewers = viewerResults
      .filter((result): result is PromiseFulfilledResult<ViewerContext> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (input.campaignId && viewers.length === 0) throw new McpToolError('Campanha não encontrada.', 404);
    if (viewers.length === 0) return { query, results: [], nextCursor: null };

    const files = await prisma.campaignFile.findMany({
      where: {
        AND: [
          { OR: viewers.map((viewer) => publishedFileWhere(viewer)) },
          { isTrashed: false, isArchived: false },
          input.types?.length ? { type: { in: input.types as FileType[] } } : {},
          {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { content: { contains: query, mode: 'insensitive' } },
              { tags: { some: { tag: { name: { contains: query, mode: 'insensitive' } } } } }
            ]
          }
        ]
      },
      select: {
        id: true,
        campaignId: true,
        type: true,
        name: true,
        description: true,
        content: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        campaign: { select: { name: true } },
        tags: { select: { tag: { select: { id: true, name: true, color: true, icon: true } } } }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit + 1
    });

    return {
      query,
      results: files.slice(0, limit).map((file) => ({
        ...fileSummary(file),
        campaignName: file.campaign.name,
        snippet: searchSnippet(file.content, query)
      })),
      nextCursor: nextCursor(skip, limit, files.length)
    };
  },

  async getDocument(ctx: McpToolContext, input: { campaignId: string; documentId: string }) {
    requireScope(ctx, 'documents:read');
    await campaignAccess(ctx, input.campaignId);
    const file = await findVisibleFile(ctx, input.campaignId, input.documentId);
    return fileDetail(file, ctx.config);
  },

  async listEntities(
    ctx: McpToolContext,
    input: {
      campaignId: string;
      entityType?: (typeof ENTITY_TYPES)[number];
      query?: string;
      includeArchived?: boolean;
      limit?: number;
      cursor?: string | null;
    }
  ) {
    requireScope(ctx, 'entities:read');
    await campaignAccess(ctx, input.campaignId);
    const viewer = await viewerFor(ctx, input.campaignId);
    const { limit, skip } = pagination(ctx, input);
    const query = input.query?.trim();
    const files = await prisma.campaignFile.findMany({
      where: {
        AND: [
          activeWhere(viewer, { includeArchived: input.includeArchived }),
          { type: { in: input.entityType ? [input.entityType] : [...ENTITY_TYPES] } },
          query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { description: { contains: query, mode: 'insensitive' } },
                  { content: { contains: query, mode: 'insensitive' } }
                ]
              }
            : {}
        ]
      },
      select: {
        id: true,
        campaignId: true,
        type: true,
        name: true,
        description: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true, icon: true } } } }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit + 1
    });
    return {
      campaignId: input.campaignId,
      entities: files.slice(0, limit).map(fileSummary),
      nextCursor: nextCursor(skip, limit, files.length)
    };
  },

  async getEntity(ctx: McpToolContext, input: { campaignId: string; entityId: string }) {
    requireScope(ctx, 'entities:read');
    await campaignAccess(ctx, input.campaignId);
    const file = await findVisibleFile(ctx, input.campaignId, input.entityId, { allowedTypes: ENTITY_TYPES });
    return fileDetail(file, ctx.config);
  },

  async getRelationships(
    ctx: McpToolContext,
    input: {
      campaignId: string;
      entityId?: string;
      direction?: 'both' | 'outgoing' | 'incoming';
      limit?: number;
      cursor?: string | null;
    }
  ) {
    requireScope(ctx, 'relationships:read');
    const access = await campaignAccess(ctx, input.campaignId);
    const viewer = await viewerFor(ctx, input.campaignId);
    const { limit, skip } = pagination(ctx, input);
    const audience = access.role === 'OWNER'
      ? null
      : visibleRelationshipAudiences({
          role: 'PLAYER',
          userId: ctx.user.id,
          audience: viewer.kind === 'PLAYER' ? viewer.audience : null
        });

    const and: Prisma.RelationshipWhereInput[] = [{ campaignId: input.campaignId }];
    if (audience) and.push({ visibility: { in: audience } });

    if (input.entityId) {
      const entity = await prisma.campaignFile.findFirst({
        where: { ...activeWhere(viewer), id: input.entityId },
        select: { id: true }
      });
      if (!entity) throw new McpToolError('Entidade não encontrada.', 404);
      if (input.direction === 'outgoing') and.push({ fromId: input.entityId });
      else if (input.direction === 'incoming') and.push({ toId: input.entityId });
      else and.push({ OR: [{ fromId: input.entityId }, { toId: input.entityId }] });
    }

    if (viewer.kind === 'PLAYER') {
      const visibleFiles = await prisma.campaignFile.findMany({
        where: publishedFileWhere(viewer),
        select: { id: true }
      });
      const ids = visibleFiles.map((file) => file.id);
      if (ids.length === 0) return { campaignId: input.campaignId, relationships: [], nextCursor: null };
      and.push({ fromId: { in: ids } }, { toId: { in: ids } });
    }

    const relationships = await prisma.relationship.findMany({
      where: { AND: and },
      select: {
        id: true,
        campaignId: true,
        fromId: true,
        toId: true,
        kind: true,
        label: true,
        description: true,
        importance: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        type: { select: { id: true, key: true, name: true } },
        from: { select: { id: true, name: true, type: true } },
        to: { select: { id: true, name: true, type: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit + 1
    });

    return {
      campaignId: input.campaignId,
      relationships: relationships.slice(0, limit).map((relationship) => ({
        id: relationship.id,
        from: relationship.from,
        to: relationship.to,
        type: relationship.type,
        kind: relationship.kind,
        label: relationship.label,
        description: relationship.description,
        importance: relationship.importance,
        visibility: relationship.visibility,
        createdAt: relationship.createdAt.toISOString(),
        updatedAt: relationship.updatedAt.toISOString()
      })),
      nextCursor: nextCursor(skip, limit, relationships.length)
    };
  },

  async listMaps(ctx: McpToolContext, input: { campaignId: string; query?: string; limit?: number; cursor?: string | null }) {
    requireScope(ctx, 'maps:read');
    await campaignAccess(ctx, input.campaignId);
    const viewer = await viewerFor(ctx, input.campaignId);
    const { limit, skip } = pagination(ctx, input);
    const query = input.query?.trim();
    const files = await prisma.campaignFile.findMany({
      where: {
        AND: [
          activeWhere(viewer),
          { type: 'MAP' },
          query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { description: { contains: query, mode: 'insensitive' } }
                ]
              }
            : {}
        ]
      },
      select: {
        id: true,
        campaignId: true,
        type: true,
        name: true,
        description: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true, color: true, icon: true } } } }
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit + 1
    });
    return {
      campaignId: input.campaignId,
      maps: files.slice(0, limit).map(fileSummary),
      nextCursor: nextCursor(skip, limit, files.length)
    };
  },

  async getMap(ctx: McpToolContext, input: { campaignId: string; mapId: string }) {
    requireScope(ctx, 'maps:read');
    await campaignAccess(ctx, input.campaignId);
    const file = await findVisibleFile(ctx, input.campaignId, input.mapId, { type: 'MAP' });
    return fileDetail(file, ctx.config);
  },

  async listSessions(
    ctx: McpToolContext,
    input: { campaignId: string; status?: 'PLANNED' | 'COMPLETED'; limit?: number; cursor?: string | null }
  ) {
    requireScope(ctx, 'sessions:read');
    const access = await campaignAccess(ctx, input.campaignId);
    if (access.role !== 'OWNER') throw new McpToolError('Recurso disponível apenas para o Mestre.', 403);
    const { limit, skip } = pagination(ctx, input);
    const sessions = await prisma.session.findMany({
      where: { campaignId: input.campaignId, ...(input.status ? { status: input.status } : {}) },
      select: {
        id: true,
        campaignId: true,
        name: true,
        date: true,
        summary: true,
        status: true,
        completedAt: true,
        order: true
      },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      skip,
      take: limit + 1
    });
    return {
      campaignId: input.campaignId,
      sessions: sessions.slice(0, limit).map((session) => ({
        id: session.id,
        name: session.name,
        date: session.date?.toISOString() ?? null,
        summary: session.summary ? truncateText(session.summary, 2000).text : null,
        status: session.status,
        completedAt: session.completedAt?.toISOString() ?? null,
        order: session.order
      })),
      nextCursor: nextCursor(skip, limit, sessions.length)
    };
  },

  async getSession(ctx: McpToolContext, input: { campaignId: string; sessionId: string }) {
    requireScope(ctx, 'sessions:read');
    const access = await campaignAccess(ctx, input.campaignId);
    if (access.role !== 'OWNER') throw new McpToolError('Recurso disponível apenas para o Mestre.', 403);
    const session = await prisma.session.findFirst({
      where: { id: input.sessionId, campaignId: input.campaignId },
      include: {
        files: { take: 100, orderBy: { file: { name: 'asc' } }, include: { file: { select: { id: true, name: true, type: true } } } },
        hypothesisLinks: { take: 100, include: { hypothesis: { select: { id: true, title: true, status: true } } } },
        boardViewLinks: { take: 100, include: { view: { select: { id: true, name: true, kind: true } } } }
      }
    });
    if (!session) throw new McpToolError('Sessão não encontrada.', 404);
    const summary = session.summary ? truncateText(session.summary, ctx.config.maxContentChars) : { text: null, truncated: false };
    const postSummary = session.postSummary ? truncateText(session.postSummary, ctx.config.maxContentChars) : { text: null, truncated: false };
    return {
      id: session.id,
      campaignId: session.campaignId,
      name: session.name,
      date: session.date?.toISOString() ?? null,
      summary: summary.text,
      summaryTruncated: summary.truncated,
      postSummary: postSummary.text,
      postSummaryTruncated: postSummary.truncated,
      checklist: boundedJson(session.checklist, 16_384).value,
      objectives: boundedJson(session.objectives, 16_384).value,
      agenda: boundedJson(session.agenda, 16_384).value,
      status: session.status,
      completedAt: session.completedAt?.toISOString() ?? null,
      order: session.order,
      files: session.files.map((link) => link.file),
      hypotheses: session.hypothesisLinks.map((link) => link.hypothesis),
      views: session.boardViewLinks.map((link) => link.view)
    };
  },

  async getRpgSystem(ctx: McpToolContext, input: { campaignId: string }) {
    requireScope(ctx, 'systems:read');
    const access = await campaignAccess(ctx, input.campaignId);
    const campaign = await prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: {
        system: true,
        attributes: { orderBy: { order: 'asc' }, select: { id: true, name: true, shortLabel: true, min: true, max: true, defaultVal: true } },
        skills: { orderBy: { order: 'asc' }, select: { id: true, name: true, linkedAttr: true } },
        classes: { select: { id: true, name: true, description: true } },
        races: { select: { id: true, name: true, description: true } }
      }
    });
    if (!campaign) throw new McpToolError('Campanha não encontrada.', 404);

    const preset = campaign.system === 'ORDEM_PARANORMAL'
      ? { attributes: ORDEM_PARANORMAL_ATTRIBUTES, skills: ORDEM_PARANORMAL_SKILLS }
      : campaign.system === 'DND_5E'
        ? { attributes: DND5E_ATTRIBUTES, skills: DND5E_SKILLS }
        : campaign.system === 'THREEDET_VICTORY'
          ? { attributes: THREEDET_VICTORY_ATTRIBUTES, skills: THREEDET_VICTORY_SKILLS }
          : null;

    return {
      campaignId: input.campaignId,
      role: access.role,
      system: campaign.system,
      attributes: preset ? preset.attributes : campaign.attributes,
      skills: preset ? preset.skills : campaign.skills,
      classes: campaign.classes,
      races: campaign.races
    };
  }
};

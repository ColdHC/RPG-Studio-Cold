import { randomUUID } from 'node:crypto';
import { Prisma, type MediaVisibility } from '@prisma/client';
import { assertOwnedCampaignForWrite, AccessDeniedError } from '@/lib/access';
import { inspectImage, safeFileName } from '@/lib/media';
import { hasPublishedMarkerAsset } from '@/lib/mapMedia';
import { mediaStorage, MEDIA_STORAGE_PROVIDER } from '@/lib/mediaStorage';
import { createMediaThumbnail } from '@/lib/mediaThumbnail.server';
import { mediaDeliveryUrl, type MediaDeliveryVariant } from '@/lib/mediaUrl';
import { prisma } from '@/lib/prisma';
import { getViewerContext, publishedFileWhere } from '@/lib/publicationPolicy';
import { requireUser } from '@/lib/auth';
import { recordAudit } from '@/services/auditService';

const mediaSelect = {
  id: true,
  campaignId: true,
  fileName: true,
  displayName: true,
  description: true,
  altText: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  category: true,
  tags: true,
  visibility: true,
  focalX: true,
  focalY: true,
  createdAt: true,
  updatedAt: true,
  references: {
    select: { id: true, fileId: true, purpose: true, position: true, caption: true, file: { select: { id: true, name: true, type: true } } },
    orderBy: { createdAt: 'asc' }
  }
} satisfies Prisma.MediaAssetSelect;

export type MediaListParams = {
  campaignId: string;
  search?: string;
  category?: string;
  mimeType?: string;
  page: number;
  pageSize: number;
  sort?: 'updatedAt' | 'createdAt' | 'displayName' | 'byteSize';
  direction?: 'asc' | 'desc';
};

function withDeliveryUrl<T extends { id: string }>(asset: T) {
  return { ...asset, url: mediaDeliveryUrl(asset.id) };
}

function notFound(): never {
  throw new AccessDeniedError('Mídia não encontrada.', 404);
}

export const mediaService = {
  storageConfigured: mediaStorage.isConfigured,

  async list(params: MediaListParams) {
    await assertOwnedCampaignForWrite(params.campaignId);
    const where: Prisma.MediaAssetWhereInput = {
      campaignId: params.campaignId,
      category: params.category || undefined,
      mimeType: params.mimeType || undefined,
      OR: params.search ? [
        { displayName: { contains: params.search, mode: 'insensitive' } },
        { fileName: { contains: params.search, mode: 'insensitive' } },
        { tags: { has: params.search } }
      ] : undefined
    };
    const rows = await prisma.mediaAsset.findMany({
      where,
      select: mediaSelect,
      orderBy: { [params.sort ?? 'updatedAt']: params.direction ?? 'desc' },
      skip: params.page * params.pageSize,
      take: params.pageSize + 1
    });
    return { items: rows.slice(0, params.pageSize).map(withDeliveryUrl), hasMore: rows.length > params.pageSize, storageConfigured: mediaStorage.isConfigured() };
  },

  async upload(input: {
    campaignId: string;
    file: File;
    displayName?: string;
    description?: string;
    altText?: string;
    category?: string;
    tags?: string[];
    visibility?: MediaVisibility;
  }) {
    await assertOwnedCampaignForWrite(input.campaignId);
    const user = await requireUser();
    const bytes = await input.file.arrayBuffer();
    const inspected = inspectImage(bytes);
    const key = `campaigns/${input.campaignId}/media/${randomUUID()}-${safeFileName(input.file.name)}`;
    await mediaStorage.put(key, bytes, inspected.mimeType);
    let thumbnailKey: string | null = null;
    try {
      const thumbnail = await createMediaThumbnail(bytes);
      thumbnailKey = `${key}.thumbnail.webp`;
      await mediaStorage.put(thumbnailKey, thumbnail, 'image/webp');
    } catch {
      thumbnailKey = null;
    }
    try {
      const asset = await prisma.mediaAsset.create({
        data: {
          campaignId: input.campaignId,
          storageProvider: MEDIA_STORAGE_PROVIDER,
          storageKey: key,
          fileName: input.file.name.slice(0, 255),
          displayName: (input.displayName?.trim() || input.file.name).slice(0, 160),
          description: input.description?.trim() || null,
          altText: input.altText?.trim() || null,
          mimeType: inspected.mimeType,
          byteSize: input.file.size,
          width: inspected.width,
          height: inspected.height,
          thumbnailKey,
          category: input.category?.trim() || null,
          tags: [...new Set(input.tags ?? [])],
          visibility: input.visibility ?? 'PRIVATE',
          createdById: user.id
        },
        select: mediaSelect
      });
      void recordAudit({ campaignId: input.campaignId, actorId: user.id, action: 'MEDIA_UPLOADED', entityType: 'MediaAsset', entityId: asset.id, metadata: { mimeType: asset.mimeType, byteSize: asset.byteSize } }).catch(() => undefined);
      return withDeliveryUrl(asset);
    } catch (error) {
      await Promise.all([mediaStorage.delete(key).catch(() => undefined), ...(thumbnailKey ? [mediaStorage.delete(thumbnailKey).catch(() => undefined)] : [])]);
      throw error;
    }
  },

  async update(campaignId: string, assetId: string, input: {
    displayName?: string;
    description?: string | null;
    altText?: string | null;
    category?: string | null;
    tags?: string[];
    visibility?: MediaVisibility;
    focalX?: number | null;
    focalY?: number | null;
  }) {
    await assertOwnedCampaignForWrite(campaignId);
    const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, campaignId }, select: { id: true } });
    if (!asset) notFound();
    const updated = await prisma.mediaAsset.update({ where: { id: assetId }, data: input, select: mediaSelect });
    return withDeliveryUrl(updated);
  },

  async attach(campaignId: string, assetId: string, input: { fileId: string; purpose: string; position?: number; caption?: string; replace?: boolean }) {
    await assertOwnedCampaignForWrite(campaignId);
    const [asset, file] = await Promise.all([
      prisma.mediaAsset.findFirst({ where: { id: assetId, campaignId }, select: { id: true } }),
      prisma.campaignFile.findFirst({ where: { id: input.fileId, campaignId }, select: { id: true } })
    ]);
    if (!asset || !file) notFound();
    return prisma.$transaction(async (tx) => {
      if (input.replace) await tx.mediaReference.deleteMany({ where: { fileId: input.fileId, purpose: input.purpose } });
      const position = input.position ?? (input.purpose === 'GALLERY'
        ? ((await tx.mediaReference.aggregate({ where: { fileId: input.fileId, purpose: input.purpose }, _max: { position: true } }))._max.position ?? -1) + 1
        : 0);
      return tx.mediaReference.upsert({
        where: { assetId_fileId_purpose_position: { assetId, fileId: input.fileId, purpose: input.purpose, position } },
        update: { caption: input.caption?.trim() || null },
        create: { assetId, fileId: input.fileId, purpose: input.purpose, position, caption: input.caption?.trim() || null }
      });
    });
  },

  async detach(campaignId: string, assetId: string, referenceId: string) {
    await assertOwnedCampaignForWrite(campaignId);
    const reference = await prisma.mediaReference.findFirst({
      where: { id: referenceId, assetId, asset: { campaignId } },
      select: { id: true }
    });
    if (!reference) notFound();
    await prisma.mediaReference.delete({ where: { id: reference.id } });
  },

  async updateReference(campaignId: string, assetId: string, referenceId: string, input: { caption?: string | null; position?: number }) {
    await assertOwnedCampaignForWrite(campaignId);
    const reference = await prisma.mediaReference.findFirst({
      where: { id: referenceId, assetId, asset: { campaignId } },
      select: { id: true }
    });
    if (!reference) notFound();
    return prisma.mediaReference.update({
      where: { id: reference.id },
      data: {
        ...(input.caption === undefined ? {} : { caption: input.caption?.trim() || null }),
        ...(input.position === undefined ? {} : { position: input.position })
      }
    });
  },

  async reorderGallery(campaignId: string, fileId: string, referenceIds: string[]) {
    await assertOwnedCampaignForWrite(campaignId);
    const references = await prisma.mediaReference.findMany({
      where: { fileId, purpose: 'GALLERY', file: { campaignId } },
      select: { id: true, position: true }
    });
    if (references.length !== referenceIds.length || new Set(referenceIds).size !== referenceIds.length || references.some((reference) => !referenceIds.includes(reference.id))) {
      throw Object.assign(new Error('A ordem da galeria não corresponde às referências atuais.'), { status: 422 });
    }
    return prisma.$transaction(async (tx) => {
      await Promise.all(references.map((reference, index) => tx.mediaReference.update({ where: { id: reference.id }, data: { position: 10_000 + index } })));
      await Promise.all(referenceIds.map((id, position) => tx.mediaReference.update({ where: { id }, data: { position } })));
      return tx.mediaReference.findMany({ where: { fileId, purpose: 'GALLERY' }, orderBy: { position: 'asc' } });
    });
  },

  async remove(campaignId: string, assetId: string) {
    await assertOwnedCampaignForWrite(campaignId);
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: assetId, campaignId },
      select: { id: true, storageKey: true, thumbnailKey: true, references: { select: { file: { select: { name: true } } } } }
    });
    if (!asset) notFound();
    if (asset.references.length) {
      const names = asset.references.map((reference) => reference.file.name).slice(0, 3).join(', ');
      throw Object.assign(new Error(`Esta mídia ainda é usada por: ${names}${asset.references.length > 3 ? '…' : ''}. Remova ou substitua as referências antes de excluí-la.`), { status: 409 });
    }
    await Promise.all([mediaStorage.delete(asset.storageKey), ...(asset.thumbnailKey ? [mediaStorage.delete(asset.thumbnailKey).catch(() => undefined)] : [])]);
    await prisma.mediaAsset.delete({ where: { id: assetId } });
  },

  async readForCurrentUser(assetId: string, variant?: MediaDeliveryVariant) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true, campaignId: true, storageKey: true, thumbnailKey: true, mimeType: true, visibility: true, references: { select: { fileId: true, purpose: true } } } });
    if (!asset) notFound();
    const viewer = await getViewerContext(asset.campaignId, { requirePlayerMode: true });
    if (viewer.kind !== 'OWNER') {
      if (asset.visibility !== 'PUBLISHED' || asset.references.length === 0) notFound();
      const regularReferenceFileIds = asset.references.filter((reference) => reference.purpose !== 'MARKER').map((reference) => reference.fileId);
      const visibleReference = regularReferenceFileIds.length
        ? await prisma.campaignFile.findFirst({ where: { id: { in: regularReferenceFileIds }, ...publishedFileWhere(viewer) }, select: { id: true } })
        : null;
      if (!visibleReference) {
        const markerReferenceFileIds = asset.references.filter((reference) => reference.purpose === 'MARKER').map((reference) => reference.fileId);
        const visibleMap = markerReferenceFileIds.length
          ? await prisma.campaignFile.findFirst({ where: { id: { in: markerReferenceFileIds }, type: 'MAP', ...publishedFileWhere(viewer) }, select: { data: true } })
          : null;
        if (!visibleMap || !hasPublishedMarkerAsset(visibleMap.data, assetId)) notFound();
      }
    }
    if (variant !== 'thumbnail') return { asset, object: await mediaStorage.read(asset.storageKey), contentType: asset.mimeType };
    if (asset.thumbnailKey) {
      try {
        return { asset, object: await mediaStorage.read(asset.thumbnailKey), contentType: 'image/webp' };
      } catch {
        // An absent derived object can be safely regenerated from the protected original below.
      }
    }
    const original = await mediaStorage.read(asset.storageKey);
    if (!original) notFound();
    try {
      const thumbnail = await createMediaThumbnail(await new Response(original.stream).arrayBuffer());
      const thumbnailKey = `${asset.storageKey}.thumbnail.webp`;
      await mediaStorage.put(thumbnailKey, thumbnail, 'image/webp');
      const claimed = await prisma.mediaAsset.updateMany({
        where: { id: asset.id, OR: [{ thumbnailKey: null }, { thumbnailKey: asset.thumbnailKey }] },
        data: { thumbnailKey }
      });
      if (claimed.count) return { asset: { ...asset, thumbnailKey }, object: await mediaStorage.read(thumbnailKey), contentType: 'image/webp' };
      const current = await prisma.mediaAsset.findUnique({ where: { id: asset.id }, select: { thumbnailKey: true } });
      if (current?.thumbnailKey) return { asset: { ...asset, thumbnailKey: current.thumbnailKey }, object: await mediaStorage.read(current.thumbnailKey), contentType: 'image/webp' };
    } catch {
      // Preserve access to legacy assets even if a provider temporarily cannot create a derivative.
    }
    return { asset, object: await mediaStorage.read(asset.storageKey), contentType: asset.mimeType };
  }
};

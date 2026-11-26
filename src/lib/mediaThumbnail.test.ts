import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createMediaThumbnail, MEDIA_THUMBNAIL_MAX_SIDE } from './mediaThumbnail.server';

describe('media thumbnails', () => {
  it('converte para WebP e limita a maior dimensão', async () => {
    const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#c8a66a' } }).png().toBuffer();
    const thumbnail = await createMediaThumbnail(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
    const metadata = await sharp(thumbnail).metadata();

    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(MEDIA_THUMBNAIL_MAX_SIDE);
    expect(metadata.width).toBe(480);
    expect(metadata.height).toBe(270);
  });
});

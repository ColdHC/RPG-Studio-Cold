import sharp from 'sharp';

const configuredSide = Number.parseInt(process.env.MEDIA_THUMBNAIL_MAX_SIDE ?? '480', 10);
export const MEDIA_THUMBNAIL_MAX_SIDE = Number.isFinite(configuredSide) && configuredSide >= 64 && configuredSide <= 2048
  ? configuredSide
  : 480;

export async function createMediaThumbnail(bytes: ArrayBuffer) {
  const thumbnail = await sharp(Buffer.from(bytes), { animated: false })
    .rotate()
    .resize({ width: MEDIA_THUMBNAIL_MAX_SIDE, height: MEDIA_THUMBNAIL_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  return thumbnail;
}

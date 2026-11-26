export type MediaDeliveryVariant = 'thumbnail';

export function mediaDeliveryUrl(assetId: string, variant?: MediaDeliveryVariant) {
  const path = `/api/media/${encodeURIComponent(assetId)}`;
  return variant ? `${path}?variant=${variant}` : path;
}

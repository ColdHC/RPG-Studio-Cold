function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Marker media is reachable by players only when the marker itself survives
 * the map's player projection. This keeps a private marker from granting a
 * delivery path to an otherwise published asset.
 */
export function hasPublishedMarkerAsset(data: unknown, assetId: string) {
  if (!isRecord(data) || !isRecord(data.map)) return false;
  const layers = Array.isArray(data.map.layers) ? data.map.layers : [];
  const layerIds = new Set(layers.flatMap((layer) => isRecord(layer) && typeof layer.id === 'string' ? [layer.id] : []));
  const visibleLayerIds = new Set(layers.flatMap((layer) => {
    if (!isRecord(layer) || layer.access === 'PRIVATE' || typeof layer.id !== 'string') return [];
    return [layer.id];
  }));
  const markers = Array.isArray(data.map.markers) ? data.map.markers : [];
  return markers.some((marker) => {
    if (!isRecord(marker)) return false;
    const layerId = marker.layerId;
    return marker.imageAssetId === assetId
      && marker.visibility === 'PUBLISHED'
      && (typeof layerId !== 'string' || layerIds.size === 0 || visibleLayerIds.has(layerId));
  });
}

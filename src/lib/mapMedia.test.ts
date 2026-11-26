import { describe, expect, it } from 'vitest';
import { hasPublishedMarkerAsset } from './mapMedia';

describe('published marker media', () => {
  it('permite apenas a imagem vinculada a um marcador e camada publicados', () => {
    const data = {
      map: {
        layers: [{ id: 'publica', access: 'PUBLISHED' }, { id: 'secreta', access: 'PRIVATE' }],
        markers: [
          { imageAssetId: 'asset-publico', visibility: 'PUBLISHED', layerId: 'publica' },
          { imageAssetId: 'asset-privado', visibility: 'PRIVATE', layerId: 'publica' },
          { imageAssetId: 'asset-em-camada-privada', visibility: 'PUBLISHED', layerId: 'secreta' }
        ]
      }
    };

    expect(hasPublishedMarkerAsset(data, 'asset-publico')).toBe(true);
    expect(hasPublishedMarkerAsset(data, 'asset-privado')).toBe(false);
    expect(hasPublishedMarkerAsset(data, 'asset-em-camada-privada')).toBe(false);
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readForCurrentUser: vi.fn() }));

vi.mock('@/services/mediaService', () => ({ mediaService: { readForCurrentUser: mocks.readForCurrentUser } }));

import { GET } from './route';

describe('media delivery route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readForCurrentUser.mockResolvedValue({
      object: { stream: new ReadableStream(), blob: new Blob(['thumbnail'], { type: 'image/webp' }) },
      contentType: 'image/webp'
    });
  });

  it('solicita a variante reduzida sem expor a chave do storage', async () => {
    const response = await GET(new NextRequest('http://localhost/api/media/asset-1?variant=thumbnail'), { params: { assetId: 'asset-1' } });

    expect(mocks.readForCurrentUser).toHaveBeenCalledWith('asset-1', 'thumbnail');
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

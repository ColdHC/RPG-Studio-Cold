import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiErrors';
import { mediaService } from '@/services/mediaService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { assetId: string } }) {
  try {
    const variant = request.nextUrl.searchParams.get('variant') === 'thumbnail' ? 'thumbnail' : undefined;
    const { object, contentType } = await mediaService.readForCurrentUser(params.assetId, variant);
    if (!object) return NextResponse.json({ error: 'Mídia não encontrada.' }, { status: 404 });
    return new NextResponse(object.stream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(object.blob.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return apiErrorResponse(error, 'Não foi possível carregar a mídia.');
  }
}

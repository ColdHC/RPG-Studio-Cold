import { getMcpConfig, isMcpEnabled, type McpConfig } from '@/lib/mcp/config';
import {
  corsHeaders,
  emptyResponse,
  hasDuplicateParameter,
  jsonResponse,
  oauthErrorResponse,
  parseFormBody,
  readBodyWithLimit
} from '@/lib/mcp/http';
import { revokeToken } from '@/services/mcpAuthService';
import { consumeRateLimit, rateLimitKey } from '@/services/mcpRateLimitService';
import { getClientIp } from '@/lib/requestRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);

  let config: McpConfig;
  try {
    config = getMcpConfig(request);
  } catch {
    return jsonResponse({ error: 'temporarily_unavailable' }, 503);
  }

  const cors = corsHeaders(request, config, { allowAnyOrigin: true });
  const ip = getClientIp(request);
  const limit = await consumeRateLimit(rateLimitKey('auth', `revoke:${ip}`), config.authRateLimitPerMinute);
  if (!limit.allowed) {
    return jsonResponse(
      { error: 'temporarily_unavailable', error_description: 'Muitas solicitações. Aguarde antes de tentar novamente.' },
      429,
      { ...cors, 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  const body = await readBodyWithLimit(request, 8_192);
  if (body.tooLarge) {
    return oauthErrorResponse('invalid_request', 'O corpo da requisição excede o limite permitido.', 413, cors);
  }

  const params = parseFormBody(body.text);
  if (hasDuplicateParameter(params, ['token', 'client_id', 'token_type_hint'])) {
    return oauthErrorResponse('invalid_request', 'Parâmetros duplicados não são permitidos.', 400, cors);
  }

  const token = params.get('token');
  const clientId = params.get('client_id');
  if (!token || !clientId) {
    return oauthErrorResponse('invalid_request', 'token e client_id são obrigatórios.', 400, cors);
  }

  try {
    await revokeToken({ token, clientId });
    return emptyResponse(200, cors);
  } catch (error) {
    console.error('[MCP] revocation failed', error instanceof Error ? error.name : 'unknown');
    return oauthErrorResponse('server_error', 'Não foi possível revogar o token.', 500, cors);
  }
}

export async function OPTIONS(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);
  try {
    const config = getMcpConfig(request);
    return new Response(null, { status: 204, headers: corsHeaders(request, config, { allowAnyOrigin: true }) });
  } catch {
    return jsonResponse({ error: 'temporarily_unavailable' }, 503);
  }
}

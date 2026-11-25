import { getMcpConfig, isMcpEnabled, type McpConfig } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import {
  corsHeaders,
  hasDuplicateParameter,
  jsonResponse,
  oauthErrorResponse,
  parseFormBody,
  readBodyWithLimit
} from '@/lib/mcp/http';
import { exchangeAuthorizationCode, refreshAccessToken } from '@/services/mcpAuthService';
import { consumeRateLimit, rateLimitKey } from '@/services/mcpRateLimitService';
import { getClientIp } from '@/lib/requestRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRITICAL_PARAMETERS = ['grant_type', 'code', 'refresh_token', 'client_id', 'redirect_uri', 'code_verifier', 'resource'];

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
  const limit = await consumeRateLimit(rateLimitKey('auth', `token:${ip}`), config.authRateLimitPerMinute);
  if (!limit.allowed) {
    return jsonResponse(
      { error: 'temporarily_unavailable', error_description: 'Muitas solicitações de token. Aguarde antes de tentar novamente.' },
      429,
      { ...cors, 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  const body = await readBodyWithLimit(request, 16_384);
  if (body.tooLarge) {
    return oauthErrorResponse('invalid_request', 'O corpo da requisição excede o limite permitido.', 413, cors);
  }

  const params = parseFormBody(body.text);
  if (hasDuplicateParameter(params, CRITICAL_PARAMETERS)) {
    return oauthErrorResponse('invalid_request', 'Parâmetros duplicados não são permitidos.', 400, cors);
  }

  const grantType = params.get('grant_type');
  const clientId = params.get('client_id');
  if (!clientId) {
    return oauthErrorResponse('invalid_client', 'client_id é obrigatório.', 400, cors);
  }

  try {
    if (grantType === 'authorization_code') {
      const code = params.get('code');
      const redirectUri = params.get('redirect_uri');
      const codeVerifier = params.get('code_verifier');
      if (!code || !redirectUri || !codeVerifier) {
        throw new McpOAuthError('invalid_request', 'code, redirect_uri e code_verifier são obrigatórios.', 400);
      }
      const tokens = await exchangeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
        resource: params.get('resource'),
        config
      });
      return jsonResponse(tokens, 200, cors);
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.get('refresh_token');
      if (!refreshToken) {
        throw new McpOAuthError('invalid_request', 'refresh_token é obrigatório.', 400);
      }
      const tokens = await refreshAccessToken({
        refreshToken,
        clientId,
        resource: params.get('resource'),
        config
      });
      return jsonResponse(tokens, 200, cors);
    }

    throw new McpOAuthError('unsupported_grant_type', 'grant_type suportado: authorization_code ou refresh_token.', 400);
  } catch (error) {
    if (error instanceof McpOAuthError) {
      return oauthErrorResponse(error.code, error.publicDescription, error.status, cors);
    }
    console.error('[MCP] token request failed', error instanceof Error ? error.name : 'unknown');
    return oauthErrorResponse('server_error', 'Não foi possível emitir o token.', 500, cors);
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

import { z } from 'zod';
import { getMcpConfig, isMcpEnabled, type McpConfig } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import { corsHeaders, jsonResponse, oauthErrorResponse, readBodyWithLimit } from '@/lib/mcp/http';
import { registerClient } from '@/services/mcpAuthService';
import { consumeRateLimit, rateLimitKey } from '@/services/mcpRateLimitService';
import { getClientIp } from '@/lib/requestRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registrationSchema = z
  .object({
    client_name: z.string().trim().min(1).max(120).optional(),
    redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(10),
    grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).min(1).max(2).optional(),
    response_types: z.array(z.literal('code')).min(1).max(1).optional(),
    token_endpoint_auth_method: z.literal('none').optional(),
    client_uri: z.string().url().max(2048).optional(),
    logo_uri: z.string().url().max(2048).optional(),
    contacts: z.array(z.string().trim().min(3).max(320)).max(10).optional(),
    scope: z.string().max(500).optional()
  })
  .strict();

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
  const limit = await consumeRateLimit(rateLimitKey('register', ip), config.authRateLimitPerMinute);
  if (!limit.allowed) {
    return jsonResponse(
      { error: 'temporarily_unavailable', error_description: 'Muitas solicitações de registro. Aguarde antes de tentar novamente.' },
      429,
      { ...cors, 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  const body = await readBodyWithLimit(request, 32_768);
  if (body.tooLarge) {
    return oauthErrorResponse('invalid_client_metadata', 'O corpo da requisição excede o limite permitido.', 413, cors);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return oauthErrorResponse('invalid_client_metadata', 'O corpo da requisição precisa conter JSON válido.', 400, cors);
  }

  const validation = registrationSchema.safeParse(parsed);
  if (!validation.success) {
    return oauthErrorResponse('invalid_client_metadata', 'Os metadados do cliente são inválidos.', 400, cors);
  }

  try {
    const client = await registerClient({
      clientName: validation.data.client_name,
      redirectUris: validation.data.redirect_uris,
      grantTypes: validation.data.grant_types,
      responseTypes: validation.data.response_types,
      tokenEndpointAuthMethod: validation.data.token_endpoint_auth_method,
      clientUri: validation.data.client_uri,
      logoUri: validation.data.logo_uri,
      contacts: validation.data.contacts,
      scope: validation.data.scope
    });
    return jsonResponse(client, 201, cors);
  } catch (error) {
    if (error instanceof McpOAuthError) {
      return oauthErrorResponse(error.code, error.publicDescription, error.status, cors);
    }
    console.error('[MCP] registration failed', error instanceof Error ? error.name : 'unknown');
    return oauthErrorResponse('server_error', 'Não foi possível registrar o cliente.', 500, cors);
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

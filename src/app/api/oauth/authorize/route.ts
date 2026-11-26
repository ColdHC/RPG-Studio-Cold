import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getMcpConfig, isMcpEnabled, type McpConfig } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import {
  corsHeaders,
  isSameSiteRequest,
  jsonResponse,
  oauthErrorResponse,
  readBodyWithLimit
} from '@/lib/mcp/http';
import {
  createAuthorizationCode,
  validateAuthorizationRequest,
  validateClientRedirect
} from '@/services/mcpAuthService';
import { consumeRateLimit, rateLimitKey } from '@/services/mcpRateLimitService';
import { getClientIp } from '@/lib/requestRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const authorizeSchema = z
  .object({
    client_id: z.string().min(1).max(160),
    redirect_uri: z.string().min(1).max(2048),
    response_type: z.literal('code'),
    scope: z.string().min(1).max(500).optional(),
    state: z.string().max(512).nullable().optional(),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal('S256'),
    resource: z.string().max(2048).optional().nullable(),
    decision: z.enum(['approve', 'deny']),
    campaignIds: z.array(z.string().min(1).max(64)).max(100).optional()
  })
  .strict();

function authorizationRedirect(
  config: McpConfig,
  redirectUri: string,
  params: Record<string, string | null | undefined>
) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) target.searchParams.set(key, value);
  }
  target.searchParams.set('iss', config.issuer);
  return target.toString();
}

export async function POST(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);

  let config: McpConfig;
  try {
    config = getMcpConfig(request);
  } catch {
    return jsonResponse({ error: 'temporarily_unavailable' }, 503);
  }

  if (!isSameSiteRequest(request, config)) {
    return jsonResponse({ error: 'access_denied', error_description: 'Origem da requisição não permitida.' }, 403);
  }

  const ip = getClientIp(request);
  const ipLimit = await consumeRateLimit(
    rateLimitKey('auth', `authorize:${ip}`),
    config.authRateLimitPerMinute
  );
  if (!ipLimit.allowed) {
    return jsonResponse(
      { error: 'temporarily_unavailable', error_description: 'Muitas solicitações. Aguarde antes de tentar novamente.' },
      429,
      { 'Retry-After': String(ipLimit.retryAfterSeconds) }
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return jsonResponse({ error: 'authentication_required', error_description: 'Autenticação necessária.' }, 401);
  }

  const userLimit = await consumeRateLimit(rateLimitKey('auth', `${user.id}:${ip}`), config.authRateLimitPerMinute);
  if (!userLimit.allowed) {
    return jsonResponse(
      { error: 'temporarily_unavailable', error_description: 'Muitas solicitações. Aguarde antes de tentar novamente.' },
      429,
      { 'Retry-After': String(userLimit.retryAfterSeconds) }
    );
  }

  const body = await readBodyWithLimit(request, 32_768);
  if (body.tooLarge) {
    return jsonResponse({ error: 'invalid_request', error_description: 'O corpo da requisição excede o limite permitido.' }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return jsonResponse({ error: 'invalid_request', error_description: 'O corpo da requisição precisa conter JSON válido.' }, 400);
  }

  const validation = authorizeSchema.safeParse(parsed);
  if (!validation.success) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Os parâmetros da autorização são inválidos.' }, 400);
  }
  const input = validation.data;

  const clientRedirect = await validateClientRedirect(input.client_id, input.redirect_uri);
  if (!clientRedirect) {
    return jsonResponse({ error: 'invalid_client', error_description: 'Cliente ou redirect_uri inválidos.' }, 400);
  }

  if (input.decision === 'deny') {
    return jsonResponse({
      redirectTo: authorizationRedirect(config, clientRedirect.redirectUri, {
        error: 'access_denied',
        error_description: 'O usuário negou a autorização.',
        state: input.state
      })
    });
  }

  try {
    const validated = await validateAuthorizationRequest(
      {
        clientId: input.client_id,
        redirectUri: input.redirect_uri,
        responseType: input.response_type,
        scope: input.scope ?? null,
        state: input.state ?? null,
        codeChallenge: input.code_challenge,
        codeChallengeMethod: input.code_challenge_method,
        resource: input.resource ?? null
      },
      config
    );

    const code = await createAuthorizationCode({
      user,
      request: validated,
      campaignIds: input.campaignIds ?? [],
      config
    });

    return jsonResponse({
      redirectTo: authorizationRedirect(config, validated.redirectUri, {
        code,
        state: validated.state
      })
    });
  } catch (error) {
    if (error instanceof McpOAuthError) {
      if (error.code === 'invalid_scope' || error.code === 'invalid_target' || error.code === 'access_denied') {
        return jsonResponse({
          redirectTo: authorizationRedirect(config, clientRedirect.redirectUri, {
            error: error.code,
            error_description: error.publicDescription,
            state: input.state
          })
        });
      }
      return oauthErrorResponse(error.code, error.publicDescription, error.status);
    }
    console.error('[MCP] authorization failed', error instanceof Error ? error.name : 'unknown');
    return jsonResponse({ error: 'server_error', error_description: 'Não foi possível concluir a autorização.' }, 500);
  }
}

export async function OPTIONS(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);
  try {
    const config = getMcpConfig(request);
    return new Response(null, { status: 204, headers: corsHeaders(request, config) });
  } catch {
    return jsonResponse({ error: 'temporarily_unavailable' }, 503);
  }
}

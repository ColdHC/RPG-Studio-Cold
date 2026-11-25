import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getMcpConfig, isMcpEnabled, type McpConfig } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import {
  bearerToken,
  corsHeaders,
  isAllowedOrigin,
  jsonResponse,
  methodNotAllowed,
  rateLimitedResponse,
  readBodyWithLimit,
  rebuildRequestWithBody,
  unauthorizedResponse
} from '@/lib/mcp/http';
import { createMcpServer } from '@/lib/mcp/server';
import { consumeRateLimit, rateLimitKey } from '@/services/mcpRateLimitService';
import { validateAccessToken, type ValidatedAccessToken } from '@/services/mcpAuthService';
import type { McpToolContext } from '@/services/mcpToolService';
import { getClientIp } from '@/lib/requestRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TOOL_CALLS_PER_REQUEST = 20;

type ParsedBody = { parsed: unknown; toolCalls: number; searches: number; requestId: unknown };

function inspectBody(text: string): ParsedBody {
  try {
    const parsed = JSON.parse(text) as unknown;
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    let toolCalls = 0;
    let searches = 0;
    let requestId: unknown = null;
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      const record = message as { method?: unknown; params?: unknown; id?: unknown };
      if (record.method !== 'tools/call') continue;
      toolCalls += 1;
      requestId = record.id ?? null;
      const params = record.params as { name?: unknown } | undefined;
      if (params?.name === 'search_documents') searches += 1;
    }
    return { parsed, toolCalls, searches, requestId };
  } catch {
    return { parsed: null, toolCalls: 0, searches: 0, requestId: null };
  }
}

function jsonRpcError(message: string, id: unknown = null, code = -32603) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id };
}

function withHeaders(response: Response, headers: Record<string, string>) {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged
  });
}

async function authenticate(request: Request, config: McpConfig): Promise<{ token: string; validated: ValidatedAccessToken } | Response> {
  const token = bearerToken(request);
  if (!token) {
    return unauthorizedResponse(config, { error: 'invalid_token', description: 'Token de acesso ausente.' });
  }
  try {
    const validated = await validateAccessToken(token, config);
    return { token, validated };
  } catch (error) {
    if (error instanceof McpOAuthError && error.status === 401) {
      return unauthorizedResponse(config, { error: 'invalid_token', description: error.publicDescription });
    }
    console.error('[MCP] token validation failed', error instanceof Error ? error.name : 'unknown');
    return jsonResponse({ error: 'temporarily_unavailable', error_description: 'Serviço temporariamente indisponível.' }, 503);
  }
}

async function handle(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);

  let config: McpConfig;
  try {
    config = getMcpConfig(request);
  } catch (error) {
    console.error('[MCP] configuration error', error instanceof Error ? error.name : 'unknown');
    return jsonResponse({ error: 'temporarily_unavailable', error_description: 'Serviço temporariamente indisponível.' }, 503);
  }

  const cors = corsHeaders(request, config);

  if (!isAllowedOrigin(request, config)) {
    return jsonResponse({ error: 'access_denied', error_description: 'Origem não permitida.' }, 403, cors);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
    return methodNotAllowed('GET, POST, DELETE, OPTIONS');
  }

  const ipLimit = await consumeRateLimit(rateLimitKey('request', getClientIp(request)), config.requestRateLimitPerMinute);
  if (!ipLimit.allowed) {
    return withHeaders(
      rateLimitedResponse(ipLimit.retryAfterSeconds, 'Limite de requisições MCP por minuto excedido.'),
      cors
    );
  }

  const auth = await authenticate(request, config);
  if (auth instanceof Response) return withHeaders(auth, cors);

  if (request.method !== 'POST') {
    return jsonResponse(jsonRpcError('Este servidor opera em modo stateless e não oferece streams GET/DELETE.'), 405, {
      Allow: 'POST, OPTIONS',
      ...cors
    });
  }

  const body = await readBodyWithLimit(request, config.maxArgumentBytes);
  if (body.tooLarge) {
    return jsonResponse(jsonRpcError('A requisição excede o limite de tamanho permitido.'), 413, cors);
  }

  const inspected = inspectBody(body.text);
  if (inspected.toolCalls > MAX_TOOL_CALLS_PER_REQUEST) {
    return jsonResponse(jsonRpcError('Muitas chamadas de ferramenta em uma única requisição.'), 400, cors);
  }

  if (inspected.toolCalls === 0) {
    const userLimit = await consumeRateLimit(
      rateLimitKey('request', `user:${auth.validated.userId}`),
      config.requestRateLimitPerMinute
    );
    if (!userLimit.allowed) {
      return withHeaders(
        rateLimitedResponse(userLimit.retryAfterSeconds, 'Limite de requisições MCP por minuto excedido.'),
        cors
      );
    }
  }

  if (inspected.toolCalls > 0) {
    const toolLimit = await consumeRateLimit(rateLimitKey('tool', auth.validated.userId), config.toolRateLimitPerMinute, {
      cost: inspected.toolCalls
    });
    if (!toolLimit.allowed) {
      return withHeaders(
        rateLimitedResponse(toolLimit.retryAfterSeconds, 'Limite de chamadas de ferramenta por minuto excedido.'),
        cors
      );
    }
  }

  if (inspected.searches > 0) {
    const searchLimit = await consumeRateLimit(rateLimitKey('search', auth.validated.userId), config.searchRateLimitPerMinute, {
      cost: inspected.searches
    });
    if (!searchLimit.allowed) {
      return withHeaders(
        rateLimitedResponse(searchLimit.retryAfterSeconds, 'Limite de buscas por minuto excedido.'),
        cors
      );
    }
  }

  const toolContext: McpToolContext = {
    user: auth.validated.user,
    campaignIds: auth.validated.campaignIds,
    scopes: auth.validated.scopes,
    clientId: auth.validated.clientId,
    connectionId: auth.validated.connectionId,
    config
  };

  const authInfo: AuthInfo = {
    token: auth.token,
    clientId: auth.validated.clientId,
    scopes: auth.validated.scopes,
    expiresAt: Math.floor(auth.validated.expiresAt.getTime() / 1000),
    resource: new URL(auth.validated.resource),
    extra: { mcp: toolContext }
  };

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(rebuildRequestWithBody(request, body.text), { authInfo });
    const contentType = response.headers.get('content-type') ?? '';

    let finalResponse = response;
    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > config.maxResponseBytes) {
        finalResponse = jsonResponse(jsonRpcError('A resposta excede o limite configurado.', inspected.requestId), 200);
      } else {
        finalResponse = new Response(text, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    }

    return withHeaders(finalResponse, {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...cors
    });
  } catch (error) {
    console.error('[MCP] transport error', error instanceof Error ? error.name : 'unknown');
    return jsonResponse(jsonRpcError('Não foi possível processar a requisição MCP.', inspected.requestId), 500, cors);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}

export async function OPTIONS(request: Request) {
  return handle(request);
}

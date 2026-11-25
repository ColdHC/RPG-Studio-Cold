import type { McpConfig } from './config';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache'
} as const;

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE_HEADERS,
      ...headers
    }
  });
}

export function emptyResponse(status = 200, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export function oauthErrorResponse(
  error: string,
  description: string,
  status = 400,
  headers: Record<string, string> = {}
) {
  return jsonResponse({ error, error_description: description }, status, headers);
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function wwwAuthenticateHeader(
  config: McpConfig,
  options: { error?: string; description?: string; scope?: string } = {}
) {
  const parts = [`Bearer resource_metadata="${config.resourceMetadataUrl}"`];
  if (options.error) parts.push(`error="${options.error}"`);
  if (options.description) parts.push(`error_description="${options.description.replace(/"/g, "'")}"`);
  if (options.scope) parts.push(`scope="${options.scope}"`);
  return parts.join(', ');
}

export function unauthorizedResponse(
  config: McpConfig,
  options: { error?: string; description?: string } = {}
) {
  return jsonResponse(
    { error: options.error ?? 'invalid_token', error_description: options.description ?? 'Token ausente ou inválido.' },
    401,
    { 'WWW-Authenticate': wwwAuthenticateHeader(config, options) }
  );
}

export function insufficientScopeResponse(config: McpConfig, scope: string) {
  return jsonResponse(
    { error: 'insufficient_scope', error_description: 'O token não possui o escopo necessário.' },
    403,
    { 'WWW-Authenticate': wwwAuthenticateHeader(config, { error: 'insufficient_scope', scope }) }
  );
}

export function rateLimitedResponse(retryAfterSeconds: number, message = 'Muitas requisições. Aguarde antes de tentar novamente.') {
  return jsonResponse(
    { error: 'rate_limited', error_description: message },
    429,
    { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) }
  );
}

export function methodNotAllowed(allow: string) {
  return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: allow });
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ text: string; tooLarge: boolean }> {
  const body = request.body;
  if (!body) return { text: '', tooLarge: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { text: '', tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false };
}

export function rebuildRequestWithBody(request: Request, text: string) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: text
  });
}

export function parseFormBody(text: string) {
  return new URLSearchParams(text);
}

export function hasDuplicateParameter(params: URLSearchParams, names: string[]) {
  return names.some((name) => params.getAll(name).length > 1);
}

function configuredOrigins() {
  return (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(request: Request, config: McpConfig) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === config.baseUrl) return true;
  if (configuredOrigins().includes(parsed.origin)) return true;
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  return process.env.NODE_ENV !== 'production' && isLocal;
}

export function corsHeaders(
  request: Request,
  config: McpConfig,
  options: { allowAnyOrigin?: boolean } = {}
): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowedOrigin = options.allowAnyOrigin
    ? '*'
    : origin && isAllowedOrigin(request, config)
      ? origin
      : null;
  if (!allowedOrigin) return {};
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Session-Id, Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

export function isSameSiteRequest(request: Request, config: McpConfig) {
  const origin = request.headers.get('origin');
  if (origin) {
    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      return false;
    }
    if (normalizedOrigin !== config.baseUrl && !configuredOrigins().includes(normalizedOrigin)) return false;
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
} as const;

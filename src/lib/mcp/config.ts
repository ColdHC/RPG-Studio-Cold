import { z } from 'zod';

export const MCP_SCOPES = [
  'campaigns:read',
  'documents:read',
  'entities:read',
  'relationships:read',
  'maps:read',
  'sessions:read',
  'systems:read'
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  'campaigns:read': 'Consultar campanhas autorizadas',
  'documents:read': 'Consultar documentos autorizados',
  'entities:read': 'Consultar entidades autorizadas (NPCs, personagens, pistas, etc.)',
  'relationships:read': 'Consultar relações entre entidades',
  'maps:read': 'Consultar mapas e metadados',
  'sessions:read': 'Consultar planejamento de sessões (somente Mestre)',
  'systems:read': 'Consultar o sistema de RPG da campanha'
};

export class McpConfigError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

const numericEnv = (name: string, fallback: number, min: number, max: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new McpConfigError(`${name} precisa ser um inteiro entre ${min} e ${max}.`);
  }
  return parsed;
};

const booleanEnv = (name: string, fallback: boolean) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new McpConfigError(`${name} precisa ser "true" ou "false".`);
};

export type McpConfig = {
  enabled: true;
  baseUrl: string;
  issuer: string;
  resource: string;
  resourceMetadataUrl: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  toolRateLimitPerMinute: number;
  searchRateLimitPerMinute: number;
  requestRateLimitPerMinute: number;
  authRateLimitPerMinute: number;
  defaultPageSize: number;
  maxPageSize: number;
  maxContentChars: number;
  maxArgumentBytes: number;
  maxResponseBytes: number;
  exposeMediaUrls: boolean;
  allowedMediaHosts: string[];
};

export function isMcpEnabled() {
  return process.env.MCP_ENABLED === 'true';
}

function normalizedBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpConfigError('MCP_PUBLIC_BASE_URL não é uma URL válida.');
  }
  if (url.username || url.password) throw new McpConfigError('MCP_PUBLIC_BASE_URL não pode conter credenciais.');
  if (url.search || url.hash) throw new McpConfigError('MCP_PUBLIC_BASE_URL não pode conter query string ou fragmento.');
  if (url.pathname !== '/' && url.pathname !== '') throw new McpConfigError('MCP_PUBLIC_BASE_URL deve apontar para a origem, sem caminho adicional.');
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new McpConfigError('MCP_PUBLIC_BASE_URL precisa usar HTTPS (HTTP é aceito apenas em localhost).');
  }
  return url.origin;
}

function requestOrigin(request: Request) {
  try {
    const url = new URL(request.url);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves the public MCP configuration. In production MCP_PUBLIC_BASE_URL is
 * mandatory so a spoofed Host header can never become an OAuth issuer.
 */
export function getMcpConfig(request?: Request): McpConfig {
  if (!isMcpEnabled()) throw new McpConfigError('MCP desabilitado.');
  const configured = process.env.MCP_PUBLIC_BASE_URL?.trim();
  const fallback = !configured && process.env.NODE_ENV !== 'production' && request ? requestOrigin(request) : null;
  if (!configured && !fallback) throw new McpConfigError('MCP_PUBLIC_BASE_URL não está configurada.');
  if (process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY_HEADERS !== 'true') {
    throw new McpConfigError('TRUST_PROXY_HEADERS precisa ser true em produção para limitar OAuth/MCP por IP confiável.');
  }
  const baseUrl = normalizedBaseUrl(configured || fallback || '');

  const allowedMediaHosts = (process.env.MCP_ALLOWED_MEDIA_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return {
    enabled: true,
    baseUrl,
    issuer: baseUrl,
    resource: `${baseUrl}/api/mcp`,
    resourceMetadataUrl: `${baseUrl}/.well-known/oauth-protected-resource/api/mcp`,
    accessTokenTtlSeconds: numericEnv('MCP_ACCESS_TOKEN_TTL_SECONDS', 900, 60, 3600),
    refreshTokenTtlSeconds: numericEnv('MCP_REFRESH_TOKEN_TTL_DAYS', 30, 1, 30) * 24 * 60 * 60,
    authorizationCodeTtlSeconds: numericEnv('MCP_AUTH_CODE_TTL_SECONDS', 300, 60, 600),
    toolRateLimitPerMinute: numericEnv('MCP_TOOL_RATE_LIMIT_PER_MINUTE', 60, 1, 600),
    searchRateLimitPerMinute: numericEnv('MCP_SEARCH_RATE_LIMIT_PER_MINUTE', 30, 1, 300),
    requestRateLimitPerMinute: numericEnv('MCP_REQUEST_RATE_LIMIT_PER_MINUTE', 300, 1, 3000),
    authRateLimitPerMinute: numericEnv('MCP_AUTH_RATE_LIMIT_PER_MINUTE', 30, 1, 300),
    defaultPageSize: numericEnv('MCP_DEFAULT_PAGE_SIZE', 20, 1, 100),
    maxPageSize: numericEnv('MCP_MAX_PAGE_SIZE', 100, 1, 100),
    maxContentChars: numericEnv('MCP_MAX_CONTENT_CHARS', 50000, 1000, 200000),
    maxArgumentBytes: numericEnv('MCP_MAX_ARGUMENT_BYTES', 65536, 1024, 1048576),
    maxResponseBytes: numericEnv('MCP_MAX_RESPONSE_BYTES', 262144, 16384, 1048576),
    exposeMediaUrls: booleanEnv('MCP_EXPOSE_MEDIA_URLS', false),
    allowedMediaHosts
  };
}

export function getMcpConfigFromHeaders(headers: { get(name: string): string | null }): McpConfig {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const proto = headers.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  if (!host) throw new McpConfigError('Host ausente.');
  return getMcpConfig(new Request(`${proto}://${host}/`));
}

export function parseRequestedScopes(value: string | null | undefined): McpScope[] | null {
  if (!value || !value.trim()) return [...MCP_SCOPES];
  const requested = [...new Set(value.trim().split(/\s+/))];
  if (requested.some((scope) => !MCP_SCOPES.includes(scope as McpScope))) return null;
  return requested as McpScope[];
}

export function hasScope(scopes: readonly string[], required: McpScope) {
  return scopes.includes(required);
}

export const MCP_JSON_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
} as const;

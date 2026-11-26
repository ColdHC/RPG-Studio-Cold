import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PublicUser } from '@/lib/auth';
import { MCP_SCOPES, parseRequestedScopes, type McpConfig, type McpScope } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import { hashToken, isValidCodeChallenge, randomIdentifier, randomToken, verifyPkceS256 } from '@/lib/mcp/tokens';
import { recordAudit } from '@/services/auditService';

const MAX_REDIRECT_URI_LENGTH = 2048;
const MAX_STATE_LENGTH = 512;
const MAX_CLIENT_NAME = 120;
const MAX_CLIENT_URI = 2048;
const MAX_CAMPAIGNS_PER_GRANT = 100;

export type AccessibleCampaign = {
  id: string;
  name: string;
  description: string | null;
  system: string;
  isArchived: boolean;
  role: 'OWNER' | 'PLAYER';
  audience: 'P1' | 'P2' | 'P3' | 'P4' | null;
  updatedAt: Date;
};

export type ValidatedAuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopes: McpScope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
};

export type RegisteredClientInput = {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  tokenEndpointAuthMethod?: string;
  clientUri?: string;
  logoUri?: string;
  contacts?: string[];
  scope?: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type ValidatedAccessToken = {
  tokenId: string;
  userId: string;
  clientId: string;
  connectionId: string;
  scopes: McpScope[];
  campaignIds: string[];
  resource: string;
  expiresAt: Date;
  user: PublicUser;
};

function assertLoopbackHttp(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

export function validateRedirectUri(value: string) {
  if (!value || value.length > MAX_REDIRECT_URI_LENGTH) {
    throw new McpOAuthError('invalid_redirect_uri', 'A redirect_uri é inválida.', 400);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new McpOAuthError('invalid_redirect_uri', 'A redirect_uri é inválida.', 400);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpOAuthError('invalid_redirect_uri', 'A redirect_uri é inválida.', 400);
  }
  if (url.hash) throw new McpOAuthError('invalid_redirect_uri', 'A redirect_uri não pode conter fragmento.', 400);
  if (url.username || url.password) throw new McpOAuthError('invalid_redirect_uri', 'A redirect_uri não pode conter credenciais.', 400);
  const isLoopback = assertLoopbackHttp(url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new McpOAuthError('invalid_redirect_uri', 'A redirect_uri precisa usar HTTPS (HTTP é aceito apenas em loopback).', 400);
  }
  return value;
}

function validateOptionalHttpUrl(value: string | undefined, field: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CLIENT_URI) throw new McpOAuthError('invalid_client_metadata', `${field} é muito longa.`, 400);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new McpOAuthError('invalid_client_metadata', `${field} é inválida.`, 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new McpOAuthError('invalid_client_metadata', `${field} precisa usar HTTP ou HTTPS.`, 400);
  }
  return trimmed;
}

function uniqueStrings(values: string[], field: string, max: number) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length !== values.length) {
    throw new McpOAuthError('invalid_client_metadata', `${field} não pode conter valores duplicados.`, 400);
  }
  if (unique.length > max) {
    throw new McpOAuthError('invalid_client_metadata', `${field} excede o limite permitido.`, 400);
  }
  return unique;
}

export async function registerClient(input: RegisteredClientInput) {
  if (input.redirectUris.length === 0 || input.redirectUris.length > 10) {
    throw new McpOAuthError('invalid_redirect_uri', 'Informe entre 1 e 10 redirect_uris.', 400);
  }
  const redirectUris = input.redirectUris.map(validateRedirectUri);

  const grantTypes = uniqueStrings(input.grantTypes ?? ['authorization_code', 'refresh_token'], 'grant_types', 2);
  if (grantTypes.some((value) => value !== 'authorization_code' && value !== 'refresh_token')) {
    throw new McpOAuthError('invalid_client_metadata', 'grant_types suportados: authorization_code e refresh_token.', 400);
  }
  if (!grantTypes.includes('authorization_code')) {
    throw new McpOAuthError('invalid_client_metadata', 'O cliente precisa suportar authorization_code.', 400);
  }

  const responseTypes = uniqueStrings(input.responseTypes ?? ['code'], 'response_types', 1);
  if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
    throw new McpOAuthError('invalid_client_metadata', 'response_types suportado: code.', 400);
  }

  const authMethod = input.tokenEndpointAuthMethod ?? 'none';
  if (authMethod !== 'none') {
    throw new McpOAuthError('invalid_client_metadata', 'Somente clientes públicos (token_endpoint_auth_method=none) são suportados.', 400);
  }

  const allowedScopes = input.scope ? parseRequestedScopes(input.scope) : [...MCP_SCOPES];
  if (!allowedScopes || allowedScopes.length === 0) {
    throw new McpOAuthError('invalid_scope', 'Um ou mais escopos solicitados são inválidos.', 400);
  }

  const clientName = (input.clientName?.trim() || 'Cliente MCP').slice(0, MAX_CLIENT_NAME);
  const clientUri = validateOptionalHttpUrl(input.clientUri, 'client_uri');
  const logoUri = validateOptionalHttpUrl(input.logoUri, 'logo_uri');
  const contacts = uniqueStrings(input.contacts ?? [], 'contacts', 10);

  const clientId = randomIdentifier('mcp_client', 24);
  const client = await prisma.mcpOAuthClient.create({
    data: {
      clientId,
      clientName,
      redirectUris,
      grantTypes,
      responseTypes,
      allowedScopes,
      tokenEndpointAuthMethod: authMethod,
      clientUri,
      logoUri,
      contacts
    }
  });

  void recordAudit({
    action: 'MCP_CLIENT_REGISTERED',
    entityType: 'McpOAuthClient',
    entityId: client.clientId,
    metadata: { clientName: client.clientName, redirectUriCount: redirectUris.length }
  }).catch(() => undefined);

  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    scope: (client.allowedScopes ?? [...MCP_SCOPES]).join(' ')
  };
}

export async function accessibleCampaignsForUser(userId: string): Promise<AccessibleCampaign[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      AND: [
        { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        { isArchived: false }
      ]
    },
    select: {
      id: true,
      name: true,
      description: true,
      system: true,
      isArchived: true,
      ownerId: true,
      updatedAt: true,
      members: { where: { userId }, select: { audience: true } }
    },
    orderBy: { updatedAt: 'desc' }
  });
  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    system: campaign.system,
    isArchived: campaign.isArchived,
    role: campaign.ownerId === userId ? 'OWNER' : 'PLAYER',
    audience: campaign.members[0]?.audience ?? null,
    updatedAt: campaign.updatedAt
  }));
}

export async function validateClientRedirect(clientId: string | null, redirectUri: string | null) {
  if (!clientId || !redirectUri || clientId.length > 160 || redirectUri.length > MAX_REDIRECT_URI_LENGTH) return null;
  const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId } });
  if (!client || !client.isActive || !client.redirectUris.includes(redirectUri)) return null;
  return { clientId: client.clientId, clientName: client.clientName, redirectUri };
}

export async function validateAuthorizationRequest(
  input: {
    clientId: string | null;
    redirectUri: string | null;
    responseType: string | null;
    scope: string | null;
    state: string | null;
    codeChallenge: string | null;
    codeChallengeMethod: string | null;
    resource: string | null;
  },
  config: McpConfig
): Promise<ValidatedAuthorizationRequest> {
  const clientId = input.clientId?.trim();
  if (!clientId || clientId.length > 160) {
    throw new McpOAuthError('invalid_client', 'client_id ausente ou inválido.', 400);
  }
  const redirectUri = input.redirectUri;
  if (!redirectUri) throw new McpOAuthError('invalid_request', 'redirect_uri é obrigatória.', 400);

  const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId } });
  if (!client || !client.isActive) throw new McpOAuthError('invalid_client', 'Cliente desconhecido ou inativo.', 400);
  if (!client.redirectUris.includes(redirectUri)) {
    throw new McpOAuthError('invalid_request', 'A redirect_uri não corresponde exatamente a uma URI registrada.', 400);
  }
  if (input.responseType !== 'code') {
    throw new McpOAuthError('unsupported_response_type', 'response_type suportado: code.', 400);
  }
  if (!client.grantTypes.includes('authorization_code')) {
    throw new McpOAuthError('unauthorized_client', 'Este cliente não pode usar authorization_code.', 400);
  }
  if (!client.responseTypes.includes('code')) {
    throw new McpOAuthError('unauthorized_client', 'Este cliente não pode usar response_type=code.', 400);
  }

  const codeChallenge = input.codeChallenge;
  if (!isValidCodeChallenge(codeChallenge)) {
    throw new McpOAuthError('invalid_request', 'code_challenge inválido (PKCE S256 é obrigatório).', 400);
  }
  if (input.codeChallengeMethod !== 'S256') {
    throw new McpOAuthError('invalid_request', 'code_challenge_method precisa ser S256.', 400);
  }

  const state = input.state ?? null;
  if (state !== null && (state.length > MAX_STATE_LENGTH || /[\u0000-\u001f\u007f]/.test(state))) {
    throw new McpOAuthError('invalid_request', 'state inválido.', 400);
  }

  const allowedScopes = client.allowedScopes ?? [...MCP_SCOPES];
  const scopes = input.scope
    ? parseRequestedScopes(input.scope)
    : allowedScopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope));
  if (!scopes || scopes.length === 0) {
    throw new McpOAuthError('invalid_scope', 'Um ou mais escopos solicitados são inválidos.', 400);
  }
  if (scopes.some((scope) => !allowedScopes.includes(scope))) {
    throw new McpOAuthError('invalid_scope', 'O cliente não possui um ou mais escopos solicitados.', 400);
  }

  const resource = input.resource?.trim() || config.resource;
  if (resource !== config.resource) {
    throw new McpOAuthError('invalid_target', 'O parâmetro resource não corresponde a este servidor MCP.', 400);
  }

  return {
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri,
    scopes,
    state,
    codeChallenge,
    resource
  };
}

export async function createAuthorizationCode(input: {
  user: PublicUser;
  request: ValidatedAuthorizationRequest;
  campaignIds: string[];
  config: McpConfig;
}) {
  const requestedCampaigns = uniqueStrings(input.campaignIds, 'campaignIds', MAX_CAMPAIGNS_PER_GRANT);
  const accessible = await accessibleCampaignsForUser(input.user.id);
  const allowed = new Set(accessible.map((campaign) => campaign.id));
  if (requestedCampaigns.some((campaignId) => !allowed.has(campaignId))) {
    throw new McpOAuthError('access_denied', 'Uma ou mais campanhas não estão disponíveis para este usuário.', 403);
  }

  const code = randomToken('mcp_code', 32);
  const expiresAt = new Date(Date.now() + input.config.authorizationCodeTtlSeconds * 1000);
  await prisma.mcpAuthorizationCode.create({
    data: {
      codeHash: hashToken(code),
      clientId: input.request.clientId,
      userId: input.user.id,
      redirectUri: input.request.redirectUri,
      scopes: input.request.scopes,
      codeChallenge: input.request.codeChallenge,
      codeChallengeMethod: 'S256',
      resource: input.request.resource,
      campaignIds: requestedCampaigns,
      expiresAt
    }
  });

  void recordAudit({
    actorId: input.user.id,
    action: 'MCP_AUTHORIZATION_GRANTED',
    entityType: 'McpOAuthClient',
    entityId: input.request.clientId,
    metadata: {
      scopes: input.request.scopes,
      campaignIds: requestedCampaigns,
      expiresAt: expiresAt.toISOString()
    }
  }).catch(() => undefined);

  return code;
}

async function issueTokens(
  tx: Prisma.TransactionClient,
  input: {
    connectionId: string;
    userId: string;
    clientId: string;
    scopes: McpScope[];
    resource: string;
    config: McpConfig;
    includeRefresh: boolean;
  }
) {
  const accessToken = randomToken('mcp_at', 32);
  const now = Date.now();
  await tx.mcpAccessToken.create({
    data: {
      tokenHash: hashToken(accessToken),
      connectionId: input.connectionId,
      userId: input.userId,
      clientId: input.clientId,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt: new Date(now + input.config.accessTokenTtlSeconds * 1000)
    }
  });
  let refreshToken: string | undefined;
  if (input.includeRefresh) {
    refreshToken = randomToken('mcp_rt', 32);
    await tx.mcpRefreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        connectionId: input.connectionId,
        userId: input.userId,
        clientId: input.clientId,
        scopes: input.scopes,
        resource: input.resource,
        expiresAt: new Date(now + input.config.refreshTokenTtlSeconds * 1000)
      }
    });
  }
  return { accessToken, refreshToken };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | null;
  config: McpConfig;
}): Promise<TokenResponse> {
  const record = await prisma.mcpAuthorizationCode.findUnique({
    where: { codeHash: hashToken(input.code) },
    include: { client: true }
  });
  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new McpOAuthError('invalid_grant', 'O código de autorização é inválido ou expirou.', 400);
  }
  if (record.clientId !== input.clientId) {
    throw new McpOAuthError('invalid_grant', 'O código de autorização é inválido ou expirou.', 400);
  }
  if (record.redirectUri !== input.redirectUri) {
    throw new McpOAuthError('invalid_grant', 'redirect_uri não corresponde à usada na autorização.', 400);
  }
  const resource = input.resource?.trim() || input.config.resource;
  if (record.resource !== resource) {
    throw new McpOAuthError('invalid_target', 'O parâmetro resource não corresponde ao token emitido.', 400);
  }
  if (record.codeChallengeMethod !== 'S256' || !verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
    throw new McpOAuthError('invalid_grant', 'A verificação PKCE falhou.', 400);
  }
  if (!record.client.isActive) {
    throw new McpOAuthError('invalid_client', 'Cliente desconhecido ou inativo.', 400);
  }
  if (record.client.tokenEndpointAuthMethod !== 'none') {
    throw new McpOAuthError('invalid_client', 'Método de autenticação de cliente não suportado.', 400);
  }

  const consumed = await prisma.mcpAuthorizationCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() }
  });
  if (consumed.count !== 1) {
    throw new McpOAuthError('invalid_grant', 'O código de autorização já foi utilizado.', 400);
  }

  const accessible = await accessibleCampaignsForUser(record.userId);
  const allowed = new Set(accessible.map((campaign) => campaign.id));
  const campaignIds = record.campaignIds.filter((campaignId) => allowed.has(campaignId));
  const scopes = record.scopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope));

  const result = await prisma.$transaction(async (tx) => {
    const connection = await tx.mcpConnection.create({
      data: {
        userId: record.userId,
        clientId: record.clientId,
        scopes,
        resource: record.resource
      }
    });
    if (campaignIds.length > 0) {
      await tx.mcpCampaignGrant.createMany({
        data: campaignIds.map((campaignId) => ({ connectionId: connection.id, campaignId }))
      });
    }
    const tokens = await issueTokens(tx, {
      connectionId: connection.id,
      userId: record.userId,
      clientId: record.clientId,
      scopes,
      resource: record.resource,
      config: input.config,
      includeRefresh: record.client.grantTypes.includes('refresh_token')
    });
    await tx.mcpOAuthClient.update({ where: { clientId: record.clientId }, data: { lastUsedAt: new Date() } });
    return { connection, tokens };
  });

  void recordAudit({
    actorId: record.userId,
    action: 'MCP_TOKEN_ISSUED',
    entityType: 'McpConnection',
    entityId: result.connection.id,
    metadata: { clientId: record.clientId, scopes, campaignIds }
  }).catch(() => undefined);

  return {
    access_token: result.tokens.accessToken,
    token_type: 'Bearer',
    expires_in: input.config.accessTokenTtlSeconds,
    refresh_token: result.tokens.refreshToken,
    scope: scopes.join(' ')
  };
}

async function revokeConnectionById(connectionId: string, now = new Date()) {
  await prisma.$transaction([
    prisma.mcpConnection.updateMany({ where: { id: connectionId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.mcpAccessToken.updateMany({ where: { connectionId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.mcpRefreshToken.updateMany({ where: { connectionId, revokedAt: null }, data: { revokedAt: now } })
  ]);
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  resource: string | null;
  config: McpConfig;
}): Promise<TokenResponse> {
  const record = await prisma.mcpRefreshToken.findUnique({
    where: { tokenHash: hashToken(input.refreshToken) },
    include: { connection: true, client: true }
  });
  if (!record) {
    throw new McpOAuthError('invalid_grant', 'O refresh token é inválido ou expirou.', 400);
  }
  if (record.rotatedAt || record.revokedAt) {
    await revokeConnectionById(record.connectionId);
    throw new McpOAuthError('invalid_grant', 'O refresh token já foi utilizado. A conexão foi revogada.', 400);
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new McpOAuthError('invalid_grant', 'O refresh token é inválido ou expirou.', 400);
  }
  if (record.clientId !== input.clientId || !record.client.isActive) {
    throw new McpOAuthError('invalid_grant', 'O refresh token é inválido ou expirou.', 400);
  }
  if (record.client.tokenEndpointAuthMethod !== 'none') {
    throw new McpOAuthError('invalid_client', 'Método de autenticação de cliente não suportado.', 400);
  }
  if (!record.client.grantTypes.includes('refresh_token')) {
    throw new McpOAuthError('unauthorized_client', 'Este cliente não pode usar refresh_token.', 400);
  }
  if (record.connection.revokedAt) {
    throw new McpOAuthError('invalid_grant', 'A conexão foi revogada.', 400);
  }
  const resource = input.resource?.trim() || input.config.resource;
  if (record.resource !== resource || record.connection.resource !== resource) {
    throw new McpOAuthError('invalid_target', 'O parâmetro resource não corresponde ao token emitido.', 400);
  }

  const rotated = await prisma.mcpRefreshToken.updateMany({
    where: { id: record.id, rotatedAt: null, revokedAt: null },
    data: { rotatedAt: new Date() }
  });
  if (rotated.count !== 1) {
    // Uma renovação concorrente pode ter vencido a condição atômica. Não revogamos
    // a conexão aqui para não transformar um retry legítimo em negação de serviço;
    // reuso confirmado (rotatedAt já persistido) é tratado acima.
    throw new McpOAuthError('invalid_grant', 'O refresh token já foi utilizado.', 400);
  }

  const scopes = record.scopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope));
  const tokens = await prisma.$transaction(async (tx) => {
    const issued = await issueTokens(tx, {
      connectionId: record.connectionId,
      userId: record.userId,
      clientId: record.clientId,
      scopes,
      resource: record.resource,
      config: input.config,
      includeRefresh: true
    });
    await tx.mcpConnection.update({ where: { id: record.connectionId }, data: { lastUsedAt: new Date() } });
    await tx.mcpOAuthClient.update({ where: { clientId: record.clientId }, data: { lastUsedAt: new Date() } });
    return issued;
  });

  void recordAudit({
    actorId: record.userId,
    action: 'MCP_TOKEN_REFRESHED',
    entityType: 'McpConnection',
    entityId: record.connectionId,
    metadata: { clientId: record.clientId }
  }).catch(() => undefined);

  return {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: input.config.accessTokenTtlSeconds,
    refresh_token: tokens.refreshToken,
    scope: scopes.join(' ')
  };
}

export async function validateAccessToken(token: string, config: McpConfig): Promise<ValidatedAccessToken> {
  const record = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      connection: {
        include: {
          client: true,
          campaignGrants: { where: { revokedAt: null }, select: { campaignId: true } }
        }
      }
    }
  });
  if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new McpOAuthError('invalid_token', 'Token inválido ou expirado.', 401);
  }
  if (record.resource !== config.resource || record.connection.resource !== config.resource) {
    throw new McpOAuthError('invalid_token', 'Token inválido ou expirado.', 401);
  }
  if (record.connection.revokedAt || !record.connection.client.isActive) {
    throw new McpOAuthError('invalid_token', 'Token inválido ou expirado.', 401);
  }
  if (record.connection.userId !== record.userId || record.connection.clientId !== record.clientId) {
    throw new McpOAuthError('invalid_token', 'Token inválido ou expirado.', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, name: true, email: true, createdAt: true }
  });
  if (!user) throw new McpOAuthError('invalid_token', 'Token inválido ou expirado.', 401);

  const accessible = await accessibleCampaignsForUser(user.id);
  const allowed = new Set(accessible.map((campaign) => campaign.id));
  const campaignIds = record.connection.campaignGrants
    .map((grant) => grant.campaignId)
    .filter((campaignId) => allowed.has(campaignId));

  const scopes = record.scopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope));

  if (!record.lastUsedAt || record.lastUsedAt.getTime() < Date.now() - 5 * 60 * 1000) {
    void prisma.mcpAccessToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }

  return {
    tokenId: record.id,
    userId: record.userId,
    clientId: record.clientId,
    connectionId: record.connectionId,
    scopes,
    campaignIds,
    resource: record.resource,
    expiresAt: record.expiresAt,
    user
  };
}

export async function revokeToken(input: { token: string; clientId?: string | null }) {
  const now = new Date();
  const tokenHash = hashToken(input.token);
  const access = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash },
    select: { id: true, clientId: true, userId: true, connectionId: true }
  });
  if (access && (!input.clientId || access.clientId === input.clientId)) {
    await prisma.mcpAccessToken.updateMany({ where: { id: access.id, revokedAt: null }, data: { revokedAt: now } });
    void recordAudit({
      actorId: access.userId,
      action: 'MCP_TOKEN_REVOKED',
      entityType: 'McpAccessToken',
      entityId: access.id,
      metadata: { clientId: access.clientId }
    }).catch(() => undefined);
    return;
  }

  const refresh = await prisma.mcpRefreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, clientId: true, userId: true, connectionId: true }
  });
  if (refresh && (!input.clientId || refresh.clientId === input.clientId)) {
    await revokeConnectionById(refresh.connectionId, now);
    void recordAudit({
      actorId: refresh.userId,
      action: 'MCP_CONNECTION_REVOKED',
      entityType: 'McpConnection',
      entityId: refresh.connectionId,
      metadata: { clientId: refresh.clientId, reason: 'refresh_token_revoked' }
    }).catch(() => undefined);
  }
}

export async function listConnections(userId: string) {
  const connections = await prisma.mcpConnection.findMany({
    where: { userId },
    include: {
      client: { select: { clientId: true, clientName: true } },
      campaignGrants: {
        where: { revokedAt: null },
        include: { campaign: { select: { id: true, name: true } } }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  return connections.map((connection) => ({
    id: connection.id,
    clientId: connection.clientId,
    clientName: connection.client.clientName,
    scopes: connection.scopes,
    campaigns: connection.campaignGrants.map((grant) => ({ id: grant.campaign.id, name: grant.campaign.name })),
    createdAt: connection.createdAt,
    lastUsedAt: connection.lastUsedAt,
    revokedAt: connection.revokedAt
  }));
}

export async function revokeConnection(userId: string, connectionId: string) {
  const connection = await prisma.mcpConnection.findFirst({
    where: { id: connectionId, userId },
    select: { id: true, clientId: true }
  });
  if (!connection) return false;
  await revokeConnectionById(connection.id);
  void recordAudit({
    actorId: userId,
    action: 'MCP_CONNECTION_REVOKED',
    entityType: 'McpConnection',
    entityId: connection.id,
    metadata: { clientId: connection.clientId, reason: 'user_request' }
  }).catch(() => undefined);
  return true;
}

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getMcpConfigFromHeaders, isMcpEnabled, MCP_SCOPE_LABELS, type McpConfig } from '@/lib/mcp/config';
import { McpOAuthError } from '@/lib/mcp/errors';
import { getClientIpFromHeaders } from '@/lib/requestRateLimit';
import { consumeRateLimit, rateLimitKey } from '@/services/mcpRateLimitService';
import {
  accessibleCampaignsForUser,
  validateAuthorizationRequest,
  validateClientRedirect,
  type ValidatedAuthorizationRequest
} from '@/services/mcpAuthService';
import { OAuthConsentForm } from '@/components/OAuthConsentForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function currentAuthorizePath(searchParams: SearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (typeof value === 'string') params.set(key, value);
  }
  return `/oauth/authorize?${params.toString()}`;
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>RPG Campaign Studio</div>
        <h1>{title}</h1>
        <p className={styles.subtitle}>{message}</p>
        <p className={styles.hint}>Você pode fechar esta janela e tentar conectar novamente pelo cliente MCP.</p>
      </section>
    </main>
  );
}

function errorRedirect(config: McpConfig, redirectUri: string, error: McpOAuthError, state: string | null) {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error.code);
  target.searchParams.set('error_description', error.publicDescription);
  if (state) target.searchParams.set('state', state);
  target.searchParams.set('iss', config.issuer);
  return target.toString();
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  if (!isMcpEnabled()) notFound();

  const headerList = headers();
  let config: McpConfig;
  try {
    config = getMcpConfigFromHeaders(headerList);
  } catch {
    return <ErrorPage title="MCP indisponível" message="O servidor MCP não está configurado corretamente." />;
  }

  const ipLimit = await consumeRateLimit(
    rateLimitKey('auth', `authorize-page:${getClientIpFromHeaders(headerList)}`),
    config.authRateLimitPerMinute
  );
  if (!ipLimit.allowed) {
    return <ErrorPage title="Muitas solicitações" message="Aguarde antes de tentar novamente." />;
  }

  const clientId = single(searchParams.client_id);
  const redirectUri = single(searchParams.redirect_uri);
  const state = single(searchParams.state);
  const clientRedirect = await validateClientRedirect(clientId, redirectUri);

  const user = await getCurrentUser();
  if (!user) {
    if (!clientRedirect) {
      return <ErrorPage title="Solicitação inválida" message="O cliente ou a URL de retorno não são reconhecidos." />;
    }
    redirect(`/login?next=${encodeURIComponent(currentAuthorizePath(searchParams))}`);
  }

  let request: ValidatedAuthorizationRequest;
  try {
    request = await validateAuthorizationRequest(
      {
        clientId,
        redirectUri,
        responseType: single(searchParams.response_type),
        scope: single(searchParams.scope),
        state,
        codeChallenge: single(searchParams.code_challenge),
        codeChallengeMethod: single(searchParams.code_challenge_method),
        resource: single(searchParams.resource)
      },
      config
    );
  } catch (error) {
    if (error instanceof McpOAuthError && clientRedirect) {
      redirect(errorRedirect(config, clientRedirect.redirectUri, error, state));
    }
    return <ErrorPage title="Autorização inválida" message="Os parâmetros da solicitação de autorização são inválidos." />;
  }

  const campaigns = await accessibleCampaignsForUser(user.id);
  const scopeLabels = Object.fromEntries(request.scopes.map((scope) => [scope, MCP_SCOPE_LABELS[scope]]));

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>RPG Campaign Studio</div>
        <h1>Autorizar {request.clientName}</h1>
        <p className={styles.subtitle}>
          Este cliente solicita acesso <strong>somente de leitura</strong> às campanhas que você escolher abaixo.
          Você pode revogar o acesso a qualquer momento.
        </p>

        <div className={styles.section}>
          <h2>Permissões solicitadas</h2>
          <ul className={styles.scopeList}>
            {request.scopes.map((scope) => (
              <li key={scope}>{scopeLabels[scope]}</li>
            ))}
          </ul>
        </div>

        <OAuthConsentForm
          clientName={request.clientName}
          campaigns={campaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            role: campaign.role,
            isArchived: campaign.isArchived
          }))}
          scopeLabels={scopeLabels}
          fields={{
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            scopes: request.scopes,
            state: request.state,
            codeChallenge: request.codeChallenge,
            resource: request.resource
          }}
        />

        <p className={styles.hint}>
          Nenhuma campanha é autorizada automaticamente. Campanhas criadas ou adicionadas depois não recebem acesso automático.
        </p>
      </section>
    </main>
  );
}

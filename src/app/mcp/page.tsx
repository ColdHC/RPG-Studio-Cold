import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getMcpConfig, isMcpEnabled, MCP_SCOPE_LABELS, type McpScope } from '@/lib/mcp/config';
import { listConnections, revokeConnection } from '@/services/mcpAuthService';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

async function revokeConnectionAction(formData: FormData) {
  'use server';
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/mcp');
  const connectionId = formData.get('connectionId');
  if (typeof connectionId !== 'string' || !connectionId) return;
  await revokeConnection(user.id, connectionId);
  revalidatePath('/mcp');
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function formatDate(value: Date | null) {
  return value ? dateFormatter.format(value) : '—';
}

export default async function McpConnectionsPage() {
  if (!isMcpEnabled()) notFound();

  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/mcp');

  const connections = await listConnections(user.id);
  const active = connections.filter((connection) => !connection.revokedAt);
  const revoked = connections.filter((connection) => connection.revokedAt);
  let serverUrl = '/api/mcp';
  try {
    serverUrl = getMcpConfig().resource;
  } catch {
    // Configuração inválida já falha fechado nas rotas MCP; a página ainda pode orientar o usuário.
  }
  const clientId = process.env.MCP_CLAUDE_CLIENT_ID?.trim() || '';

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>RPG Campaign Studio</div>
        <h1>Conexões MCP</h1>
        <p className={styles.subtitle}>
          Estes clientes têm acesso <strong>somente de leitura</strong> às campanhas listadas. Revogar uma conexão
          invalida imediatamente todos os tokens emitidos para ela.
        </p>

        <div className={styles.connect}>
          <h2>Como conectar</h2>
          <p className={styles.subtitle}>
            Use a URL abaixo como servidor remoto no Claude. A autenticação é OAuth com PKCE e o acesso é
            <strong> somente leitura</strong> às campanhas que você selecionar no consentimento.
          </p>
          <div className={styles.copyField}>
            <span>URL do servidor</span>
            <code>{serverUrl}</code>
          </div>
          {clientId && (
            <div className={styles.copyField}>
              <span>Client ID (se o Claude pedir)</span>
              <code>{clientId}</code>
            </div>
          )}
          <Link href={'/help/mcp' as never} className={styles.helpLink}>
            Ver passo a passo para Claude Web, Desktop e Code
          </Link>
        </div>

        <h2>Autorizações ativas</h2>
        {active.length === 0 ? (
          <p className={styles.empty}>Nenhum cliente MCP autorizado.</p>
        ) : (
          <ul className={styles.list}>
            {active.map((connection) => (
              <li key={connection.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <strong>{connection.clientName}</strong>
                  <span className={styles.meta}>Criada em {formatDate(connection.createdAt)}</span>
                </div>
                <p className={styles.meta}>
                  Campanhas: {connection.campaigns.length > 0 ? connection.campaigns.map((campaign) => campaign.name).join(', ') : 'nenhuma'}
                </p>
                <p className={styles.meta}>
                  Escopos: {connection.scopes.map((scope) => MCP_SCOPE_LABELS[scope as McpScope] ?? scope).join(' · ')}
                </p>
                <p className={styles.meta}>Último uso: {formatDate(connection.lastUsedAt)}</p>
                <form action={revokeConnectionAction}>
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <button type="submit" className={styles.revoke}>Revogar acesso</button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {revoked.length > 0 && (
          <>
            <h2>Revogadas recentemente</h2>
            <ul className={styles.list}>
              {revoked.map((connection) => (
                <li key={connection.id} className={`${styles.item} ${styles.revokedItem}`}>
                  <div className={styles.itemHeader}>
                    <strong>{connection.clientName}</strong>
                    <span className={styles.meta}>Revogada em {formatDate(connection.revokedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className={styles.hint}>
          Precisa de ajuda? <Link href={'/help/mcp' as never} className={styles.inlineLink}>guia de conexão</Link>.
        </p>
      </section>
    </main>
  );
}

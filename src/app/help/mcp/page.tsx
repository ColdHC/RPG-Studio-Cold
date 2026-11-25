import Link from 'next/link';
import { getMcpConfig, isMcpEnabled } from '@/lib/mcp/config';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

function publicServerUrl() {
  try {
    return getMcpConfig().resource;
  } catch {
    return '/api/mcp';
  }
}

export default function McpHelpPage() {
  const serverUrl = publicServerUrl();
  const clientId = process.env.MCP_CLAUDE_CLIENT_ID?.trim() || '';

  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <div className={styles.brand}>RPG Campaign Studio</div>
        <h1>Conectar o Claude ao RPG Studio</h1>
        <p className={styles.lead}>
          O conector permite que o Claude <strong>apenas leia</strong> as campanhas que você autorizar.
          Ele não cria, edita nem remove nada no RPG Studio.
        </p>

        {!isMcpEnabled() && (
          <p className={styles.warning}>O servidor MCP não está habilitado neste deployment.</p>
        )}

        <section className={styles.section}>
          <h2>1. Dados do servidor</h2>
          <dl className={styles.fields}>
            <div>
              <dt>URL do servidor</dt>
              <dd><code>{serverUrl}</code></dd>
            </div>
            <div>
              <dt>Autenticação</dt>
              <dd>OAuth 2.1 com PKCE S256</dd>
            </div>
            {clientId && (
              <div>
                <dt>Client ID (se o Claude pedir)</dt>
                <dd><code>{clientId}</code></dd>
              </div>
            )}
          </dl>
          <p className={styles.note}>
            Não existe API key nem token compartilhado. Não copie tokens de outras pessoas.
            Se o Claude oferecer <strong>Register automatically</strong>, use essa opção e ignore o Client ID.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Claude Web</h2>
          <ol className={styles.steps}>
            <li>Abra <a href="https://claude.ai/customize/connectors" target="_blank" rel="noreferrer">claude.ai/customize/connectors</a> e clique em <strong>Add custom connector</strong>.</li>
            <li>Informe o nome <strong>RPG Campaign Studio</strong> e a URL do servidor acima.</li>
            <li>Em <strong>Authentication</strong>, escolha <strong>Sign in now</strong> ou <strong>Sign in when needed</strong>.</li>
            <li>Em <strong>OAuth client</strong>, prefira <strong>Register automatically</strong>. Se o diálogo exigir um Client ID, use o valor acima e deixe o client secret em branco.</li>
            <li>Clique em <strong>Add</strong> e depois em <strong>Connect</strong>.</li>
            <li>Faça login no RPG Studio, selecione explicitamente as campanhas e confirme o consentimento.</li>
            <li>Ative o conector na conversa e peça, por exemplo, para listar as campanhas autorizadas.</li>
          </ol>
          <p className={styles.note}>
            Não use <strong>Use Claude&apos;s published identity</strong>: este servidor não publica CIMD.
            No plano Free só é possível manter um conector customizado.
          </p>
        </section>

        <section className={styles.section}>
          <h2>3. Claude Desktop e Claude Code</h2>
          <p className={styles.note}>Para Claude Code, execute:</p>
          <pre className={styles.code}>{`claude mcp add --transport http rpg-campaign-studio ${serverUrl}`}</pre>
          <p className={styles.note}>
            O Claude Desktop também aceita a URL remota acima como servidor HTTP. O fluxo OAuth e o
            consentimento serão abertos no navegador na primeira conexão.
          </p>
        </section>

        <section className={styles.section}>
          <h2>4. Permissões e revogação</h2>
          <p className={styles.note}>
            Por padrão, nenhuma campanha é autorizada. Você escolhe quais campanhas o cliente pode ler.
            Se perder acesso a uma campanha no RPG Studio, o conector também perde imediatamente.
          </p>
          <p className={styles.note}>
            Para revisar ou revogar conexões, <Link href="/mcp" className={styles.link}>abra Conexões MCP</Link>.
            Revogar invalida todos os tokens daquela conexão.
          </p>
        </section>

        <section className={styles.section}>
          <h2>5. Se der erro</h2>
          <ul className={styles.notes}>
            <li><strong>401:</strong> token ausente ou expirado; desconecte e conecte novamente.</li>
            <li><strong>Nenhuma campanha visível:</strong> refaça o consentimento e marque as campanhas desejadas.</li>
            <li><strong>429:</strong> limite de chamadas por minuto atingido; aguarde e tente de novo.</li>
            <li><strong>Não consegue conectar:</strong> envie a mensagem de erro exibida ao administrador do RPG Studio.</li>
          </ul>
          <p className={styles.note}>
            A documentação técnica detalhada fica no repositório do projeto; esta página é o guia para usuários finais.
          </p>
        </section>
      </article>
    </main>
  );
}

# Configuração

## Variáveis de ambiente

Todas as variáveis são opcionais exceto `MCP_PUBLIC_BASE_URL` em produção. Valores inválidos impedem a inicialização do recurso (fail closed).

| Variável | Padrão | Intervalo / regra |
| --- | --- | --- |
| `MCP_ENABLED` | `false` | `true` habilita; qualquer outro valor desabilita. |
| `MCP_PUBLIC_BASE_URL` | — | Obrigatório em produção. Origem HTTPS sem path/query/fragmento/credenciais. HTTP permitido só em loopback. |
| `MCP_ALLOWED_ORIGINS` | vazio | CSV de origens browser adicionais autorizadas a chamar `/api/mcp`. |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | `900` | 60–3600. |
| `MCP_REFRESH_TOKEN_TTL_DAYS` | `30` | 1–30 (nunca acima de 30 dias). |
| `MCP_AUTH_CODE_TTL_SECONDS` | `300` | 60–600. |
| `MCP_TOOL_RATE_LIMIT_PER_MINUTE` | `60` | 1–600 por usuário. |
| `MCP_SEARCH_RATE_LIMIT_PER_MINUTE` | `30` | 1–300 por usuário. |
| `MCP_REQUEST_RATE_LIMIT_PER_MINUTE` | `300` | 1–3000 por IP e por usuário (requisições MCP que não são chamadas de ferramenta). |
| `MCP_AUTH_RATE_LIMIT_PER_MINUTE` | `30` | 1–300 para registro/token/revoke/autorização. |
| `MCP_DEFAULT_PAGE_SIZE` | `20` | 1–100. |
| `MCP_MAX_PAGE_SIZE` | `100` | 1–100. |
| `MCP_MAX_CONTENT_CHARS` | `50000` | 1000–200000. |
| `MCP_MAX_ARGUMENT_BYTES` | `65536` | 1024–1048576. |
| `MCP_MAX_RESPONSE_BYTES` | `262144` | 16384–1048576. |
| `MCP_EXPOSE_MEDIA_URLS` | `false` | `true` inclui URLs de anexos quando permitidas. |
| `MCP_ALLOWED_MEDIA_HOSTS` | vazio | CSV de hostnames permitidos para URLs de mídia. |

A origem canônica é sempre `MCP_PUBLIC_BASE_URL`:

- recurso: `<origin>/api/mcp`
- metadata do recurso: `<origin>/.well-known/oauth-protected-resource/api/mcp`
- emissor/AS: `<origin>`
- autorização: `<origin>/oauth/authorize`
- token: `<origin>/api/oauth/token`
- registro: `<origin>/api/oauth/register`
- revogação: `<origin>/api/oauth/revoke`

## Banco de dados

A migration `20261125120000_mcp_oauth_server` cria as tabelas MCP. Ela é aditiva e usa `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ... ADD CONSTRAINT`, sem `DROP` ou alteração destrutiva.

Em ambiente serverless, use o pooler normal (`DATABASE_URL`) para as rotas e a conexão direta (`DATABASE_URL_UNPOOLED`) apenas para migrations, conforme o padrão existente do projeto. O rate limiter depende de PostgreSQL compartilhado; não funciona com armazenamento em memória por instância.

## Rede e proxy

- A aplicação deve ser servida por HTTPS em produção.
- `MCP_PUBLIC_BASE_URL` precisa refletir exatamente a origem pública vista pelo cliente.
- `TRUST_PROXY_HEADERS` continua controlando headers de proxy no restante da aplicação; a configuração MCP não deriva `issuer` de headers de host em produção. Os limites por IP das rotas OAuth usam `getClientIp`: atrás de um proxy, configure `TRUST_PROXY_HEADERS=true` para obter limites por IP; caso contrário todos os chamadores compartilham a chave `direct-connection`.
- Clientes browser devem ter sua origem incluída em `MCP_ALLOWED_ORIGINS`, se diferente da origem da aplicação. Clientes nativos/CLI normalmente não enviam `Origin`.

## Recomendações operacionais

1. Comece com `MCP_ENABLED=false`, aplique a migration e valide com `npm run prisma:validate`.
2. Habilite em staging com `MCP_PUBLIC_BASE_URL` do staging e teste o fluxo completo com um cliente MCP.
3. Monitore eventos de auditoria `MCP_*`, códigos HTTP 401/403/429 e latência das rotas `/api/mcp` e `/api/oauth/*`.
4. Revise periodicamente `/mcp` e revogue conexões antigas; tokens expiram, mas conexões permanecem até revogação explícita.

Não há configuração para tokens globais, administradores MCP ou escrita de dados.

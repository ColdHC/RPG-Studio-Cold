# Arquitetura do servidor MCP

## Componentes

```
 Cliente MCP
     │  OAuth 2.1 + PKCE (S256)
     ▼
 Rotas OAuth (/api/oauth/*, /.well-known/*) ──► McpAuthService ──► PostgreSQL
     │                                            │                (Mcp* tables)
     │ access_token                               ├─ auditService
     ▼                                            └─ AuthSession (cookie do usuário)
 /api/mcp ──► McpRateLimitService ──► WebStandardStreamableHTTPServerTransport
                 │
                 └─► McpServer (13 tools) ──► McpToolService ──► prisma + access/publicationPolicy
```

### Camadas

- `src/lib/mcp/config.ts` — configuração fail closed, escopos, limites e URL canônica do recurso.
- `src/lib/mcp/http.ts` — parsing de bearer, CORS/Origin, limites de corpo, respostas OAuth/JSON-RPC e `WWW-Authenticate`.
- `src/lib/mcp/tokens.ts` — geração de tokens opacos, hash SHA-256, PKCE, cursors e truncamento.
- `src/lib/mcp/errors.ts` — erros públicos (`McpToolError`, `McpOAuthError`) e sanitização de mensagens.
- `src/lib/mcp/server.ts` — registro das ferramentas no SDK oficial `@modelcontextprotocol/sdk` v1.x e anotações `readOnlyHint`.
- `src/services/mcpAuthService.ts` — DCR, código de autorização, emissão/renovação/validação/revogação de tokens e consentimento.
- `src/services/mcpToolService.ts` — implementação das ferramentas, reutilizando as políticas de acesso e publicação existentes.
- `src/services/mcpRateLimitService.ts` — contador fixo de janela no PostgreSQL (compartilhado entre réplicas serverless).

## Fluxo de autorização

1. O cliente descobre o AS em `/.well-known/oauth-authorization-server` e o recurso em `/.well-known/oauth-protected-resource/api/mcp`.
2. O cliente se registra com `redirect_uris` exatas e `token_endpoint_auth_method=none`.
3. O cliente redireciona o usuário para `/oauth/authorize?...` com `code_challenge` S256, `state` e `resource`.
4. A página verifica a sessão existente do RPG Studio; se não houver, redireciona para `/login?next=...`.
5. O servidor valida cliente, redirect URI exata, PKCE, escopos e resource antes de mostrar o consentimento.
6. O usuário seleciona campanhas (lista vazia por padrão). A aprovação gera um código de uso único com hash no banco.
7. O cliente troca o código por tokens no endpoint de token, enviando o `code_verifier` e a mesma `redirect_uri`.
8. Cada chamada ao MCP valida o token, o recurso, a conexão e a associação atual do usuário às campanhas concedidas.

## Fluxo de uma chamada de ferramenta

1. Autenticação bearers; falha gera `401` com `WWW-Authenticate: Bearer resource_metadata="..."`.
2. Verificação de `Origin` e CORS.
3. O corpo JSON-RPC é inspecionado **antes** do transporte para contar `tools/call` e buscas, aplicando limites distribuídos.
4. Um `McpServer` novo e um transporte stateless são criados por requisição; o contexto validado é passado em `authInfo.extra.mcp`.
5. Cada ferramenta verifica escopo, concessão explícita da campanha e acesso/publicação corrente.
6. A resposta é limitada por tamanho; auditoria registra apenas metadados (ferramenta, cliente, duração, quantidade).

## Decisões de isolamento

- **Stateless**: `sessionIdGenerator: undefined`, `enableJsonResponse: true`. Sem estado de sessão MCP compartilhado entre instâncias.
- **Sem token passthrough**: tokens opacos locais; nenhum token é repassado a serviços externos.
- **Escopo duplo**: a campanha precisa estar na concessão da conexão **e** no conjunto de campanhas acessíveis do usuário no momento da chamada.
- **Jogador**: uso de `getViewerContextForUser(..., { requirePlayerMode: true })`; visibilidade de arquivos e relações segue as regras já usadas no modo jogador.
- **Sessões**: restritas a `OWNER`, alinhadas ao serviço existente de planejamento.
- **Auditoria**: eventos `MCP_*` gravados via `recordAudit`, sem conteúdo de documentos, tokens ou parâmetros sensíveis.

## Banco de dados

Migration aditiva: `prisma/migrations/20261125120000_mcp_oauth_server/migration.sql`.

Tabelas: `McpOAuthClient`, `McpAuthorizationCode`, `McpConnection`, `McpCampaignGrant`, `McpAccessToken`, `McpRefreshToken` e `McpRateLimit`. Tokens e códigos são armazenados apenas como hash SHA-256; o valor opaco existe somente na resposta ao cliente.

Nenhuma tabela existente é alterada; apenas relações em `User` e `Campaign` foram adicionadas ao schema Prisma.

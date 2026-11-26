# Servidor MCP remoto (somente leitura)

Este pacote documenta o servidor MCP exposto por esta aplicação em `/api/mcp`. O objetivo é permitir que clientes MCP consultem campanhas **explicitamente autorizadas** pelo usuário, sem qualquer capacidade de escrita.

## Estado

- Recurso **desabilitado por padrão**: `MCP_ENABLED` precisa ser `true`.
- Sem configuração pública válida, todas as rotas MCP respondem com `404` ou `503` (fail closed).
- Nenhuma campanha é concedida automaticamente. Novas campanhas não entram em conexões antigas.
- Nenhum segredo, token ou dado de campanha é gravado em logs.

## Início rápido

1. Aplique a migration `20261125120000_mcp_oauth_server`.
2. Configure `MCP_ENABLED=true` e `MCP_PUBLIC_BASE_URL=https://<seu-dominio>` (HTTPS obrigatório em produção).
3. Reinicie a aplicação e acesse `/mcp` para revisar/revogar conexões.
4. Registre um cliente público via `POST /api/oauth/register` (Dynamic Client Registration).
5. Autorize o cliente pela tela `/oauth/authorize`, selecionando explicitamente as campanhas.
6. Troque o código por tokens em `POST /api/oauth/token` e chame `/api/mcp` com `Authorization: Bearer <access_token>`.

## Documentos

| Documento | Conteúdo |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Componentes, fluxo de dados e limites de confiança. |
| [`AUTHENTICATION.md`](AUTHENTICATION.md) | OAuth 2.1 + PKCE, DCR, metadata, tokens e revogação. |
| [`SECURITY.md`](SECURITY.md) | Isolamento, validações, ameaças e mitigação. |
| [`TOOLS.md`](TOOLS.md) | Contrato das 13 ferramentas somente leitura. |
| [`CONFIGURATION.md`](CONFIGURATION.md) | Variáveis de ambiente, limites e deployment. |
| [`CLAUDE_SETUP.md`](CLAUDE_SETUP.md) | Como configurar um cliente MCP compatível. |
| [`TEST_REPORT.md`](TEST_REPORT.md) | Testes executados e limitações da validação. |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Custos esperados e instrumentação; sem ganhos não medidos. |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Limitações conhecidas e pendências. |

## Superfície HTTP

| Rota | Método | Finalidade |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource` | GET | Metadata do recurso protegido. |
| `/.well-known/oauth-protected-resource/api/mcp` | GET | Metadata específica do endpoint MCP (RFC 9728). |
| `/.well-known/oauth-authorization-server` | GET | Metadata do servidor de autorização (RFC 8414). |
| `/api/oauth/register` | POST | Cadastro dinâmico de cliente público. |
| `/oauth/authorize` | GET | Tela de consentimento (sessão do usuário). |
| `/api/oauth/authorize` | POST | Aprovação/negação com seleção de campanhas. |
| `/api/oauth/token` | POST | Troca de código e renovação de tokens. |
| `/api/oauth/revoke` | POST | Revogação de token pela especificação OAuth 2.0. |
| `/api/mcp` | POST | Streamable HTTP stateless (JSON-RPC). |
| `/mcp` | GET | Gestão e revogação de conexões pelo usuário. |

Não há rotas de escrita de dados de campanha neste pacote.

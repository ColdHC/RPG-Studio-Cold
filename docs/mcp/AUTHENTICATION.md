# Autenticação e autorização (OAuth 2.1)

## Visão geral

O RPG Studio mantém sua autenticação própria por cookie (`AuthSession`). O servidor MCP é um **servidor de autorização dentro da aplicação**: o mesmo usuário autenticado no app aprova clientes MCP. A autenticação do app não é substituída.

Perfil implementado:

- Authorization Code + PKCE **S256 obrigatório** (sem `plain`).
- Cliente público (`token_endpoint_auth_method=none`), sem segredos compartilhados.
- Dynamic Client Registration (DCR) com validação estrita de metadados.
- Resource indicators (`resource`) com valor exato da URL do MCP.
- Access tokens opacos com hash no banco; refresh tokens com rotação e detecção de reuso.
- Revogação por `POST /api/oauth/revoke` e pela página `/mcp`.
- Metadata de recurso protegido e de servidor de autorização.

## Descoberta

- `GET /.well-known/oauth-protected-resource/api/mcp` retorna `resource`, `authorization_servers`, `scopes_supported` e documentação.
- `GET /.well-known/oauth-authorization-server` retorna `issuer`, endpoints, `grant_types_supported`, `code_challenge_methods_supported: ["S256"]` e `resource_indicators_supported: true`.
- Respostas `401` do `/api/mcp` incluem `WWW-Authenticate: Bearer resource_metadata="<url>"`, `error` e descrição sanitizada.

As URL canônicas derivam de `MCP_PUBLIC_BASE_URL`. Em produção, essa variável é obrigatória: um cabeçalho `Host` forjado nunca vira `issuer`.

## Registro de cliente

`POST /api/oauth/register` aceita JSON com:

- `redirect_uris` (1–10): HTTPS obrigatório; HTTP somente para loopback (`localhost`, `127.0.0.1`, `[::1]`); sem fragmento, credenciais ou caracteres de controle.
- `grant_types`: `authorization_code` e/ou `refresh_token` (deve incluir `authorization_code`).
- `response_types`: somente `code`.
- `token_endpoint_auth_method`: somente `none`.
- `client_name`, `client_uri`, `logo_uri`, `contacts` e `scope` opcionais e validados.

O `scope` registrado é persistido como o conjunto máximo de escopos daquele cliente e devolvido na resposta. Uma solicitação de autorização não pode pedir escopos fora desse conjunto. `grant_types` também é respeitado: refresh token só é emitido quando `refresh_token` foi declarado.

O registro é limitado por IP e auditado. O `client_id` gerado usa prefixo `mcp_client_`.

## Autorização

`GET /oauth/authorize` exige sessão do RPG Studio. Parâmetros obrigatórios/validados:

| Parâmetro | Regra |
| --- | --- |
| `client_id` | Cliente ativo e registrado. |
| `redirect_uri` | Igualdade exata com uma URI registrada. |
| `response_type` | `code`. |
| `code_challenge` | Base64url de 43–128 caracteres. |
| `code_challenge_method` | `S256`. |
| `state` | Opcional, até 512 caracteres, sem controle. |
| `scope` | Subconjunto dos escopos registrados pelo cliente; ausência = escopos registrados. |
| `resource` | Opcional; se presente, precisa ser exatamente `<base>/api/mcp`. |

A tela lista apenas campanhas não arquivadas das quais o usuário é dono ou membro, **nenhuma selecionada por padrão**. O servidor reaplica esse filtro, então campanhas arquivadas não podem ser concedidas via API. O usuário também pode desmarcar escopos; o conjunto enviado é validado novamente no servidor contra o limite registrado do cliente. A negação retorna `error=access_denied` com `state` e `iss`.

A aprovação (`POST /api/oauth/authorize`) é protegida pelo cookie SameSite=Lax da sessão e por verificações de `Origin` / `Sec-Fetch-Site`. O `campaignIds` enviado é confrontado com as campanhas acessíveis do usuário; um ID desconhecido gerando `access_denied`.

## Código de autorização

- Valor opaco prefixado `mcp_code_`, armazenado como SHA-256.
- Expira em `MCP_AUTH_CODE_TTL_SECONDS` (padrão 300 s, máximo 600 s).
- Uso único por `updateMany` condicional (`consumedAt IS NULL`), atômico sob concorrência.
- Vinculado a cliente, redirect URI, escopos, resource, challenge PKCE e campanhas escolhidas.

## Tokens

`POST /api/oauth/token` usa corpo `application/x-www-form-urlencoded` e rejeita parâmetros críticos duplicados.

### Troca de código

Exige `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri` idêntica à da autorização e `code_verifier` compatível com o challenge S256. O resource recebido deve ser o mesmo do código. Emite access token e, se o cliente declarou `refresh_token` em `grant_types`, também refresh token; cria uma `McpConnection` com os grants de campanha.

### Renovação

`grant_type=refresh_token` exige `client_id` e `refresh_token`, e o cliente precisa ter declarado `refresh_token` em `grant_types`. O token antigo é marcado como rotacionado atomicamente e um novo par é emitido. Reuso confirmado de refresh token revoga **toda a conexão** (todos os access tokens e refresh tokens). Se duas renovações concorrentes chegarem ao mesmo tempo, apenas uma vence a condição atômica; a outra recebe `invalid_grant` sem revogar a conexão, evitando que uma corrida legítima cause negação de serviço. Um retry sequencial depois de uma renovação bem-sucedida continua sendo tratado como reuso e revoga a conexão. Refresh tokens expiram em no máximo 30 dias (`MCP_REFRESH_TOKEN_TTL_DAYS`, limitado a 30).

Access tokens expiram em `MCP_ACCESS_TOKEN_TTL_SECONDS` (padrão 900 s, máximo 3600 s). Não há tokens de administrador, globais ou compartilhados.

## Validação em cada chamada

`validateAccessToken` verifica:

1. hash do token existe e não foi revogado/expirado;
2. `resource` do token e da conexão são o recurso canônico;
3. conexão ativa, cliente ativo e vínculos de usuário/cliente coerentes;
4. usuário ainda existe;
5. cada campanha concedida continua acessível ao usuário (associação atual).

Assim, remoção de membro, arquivamento ou exclusão de campanha reduz o escopo efetivo sem exigir nova autorização.

## Revogação

- `POST /api/oauth/revoke`: `token`, `client_id` e `token_type_hint` opcional. Revoga o access token ou, para refresh token, a conexão inteira. Responde `200` sem corpo mesmo para token desconhecido.
- `/mcp`: ação de servidor `revokeConnection(userId, connectionId)`, restrita ao dono da conexão, invalida a conexão e todos os tokens.
- Reuso de refresh token e revogação de cliente também invalidam a conexão.

## Escopos

| Escopo | Uso |
| --- | --- |
| `campaigns:read` | `list_campaigns`, `get_campaign` |
| `documents:read` | `search_documents`, `list_documents`, `get_document` |
| `entities:read` | `list_entities`, `get_entity` |
| `relationships:read` | `get_relationships` |
| `maps:read` | `list_maps`, `get_map` |
| `sessions:read` | `list_sessions`, `get_session` (somente OWNER) |
| `systems:read` | `get_rpg_system` |

Não existem escopos de escrita, administração ou cross-campaign.

# Segurança do servidor MCP

## Modelo de confiança

O cliente MCP é tratado como não confiável. Ele recebe apenas tokens opacos locais e nunca credenciais do usuário. O servidor confia somente em:

- sessão do RPG Studio (cookie `AuthSession`, HttpOnly/SameSite) para consentimento e revogação;
- registros OAuth no banco para cliente, códigos, conexões e tokens;
- políticas já existentes de acesso à campanha e publicação para leitura de dados.

## Controles implementados

### Isolamento entre campanhas e usuários

- `McpCampaignGrant` associa cada conexão às campanhas escolhidas explicitamente.
- Toda ferramenta com `campaignId` começa por `campaignAccess`: exige que o ID esteja na concessão **antes** de consultar o banco. Fora dela, resposta `404` ("Campanha não encontrada") sem distinção entre inexistente e não autorizada.
- A cada chamada, a lista de campanhas do token é recalculada com base na associação atual do usuário. Membro removido perde acesso sem reemissão de token.
- Buscas sem `campaignId` usam `Promise.allSettled` sobre as campanhas autorizadas; campanhas cujo acesso foi revogado são silenciosamente ignoradas.
- Jogadores usam `getViewerContextForUser(..., { requirePlayerMode: true })`: modo jogador precisa estar ativo, campanha não arquivada e `playerVisibility.isVisible` verdadeiro, além de grants de arquivo quando `restrictToGrants`.
- Relações filtram visibilidade GM/P1–P4 e exigem que **ambas** as pontas estejam visíveis.
- `list_sessions` e `get_session` exigem `role === OWNER`.
- Escopos são limitados ao conjunto registrado no DCR; o consentimento pode reduzi-los e o servidor valida o subconjunto final.
- Campanhas arquivadas são filtradas na tela, na validação server-side de `campaignIds` e no recálculo do contexto do access token; grants antigos não funcionam enquanto a campanha estiver arquivada.

### OAuth

- PKCE S256 obrigatório no autorizar e no trocar de código; nenhum segredo de cliente.
- Redirect URI exata: comparação literal com o registro; nenhum prefixo, wildcard ou normalização.
- `state` preservado no retorno; parâmetros duplicados em `/token` e `/revoke` rejeitados.
- Código e tokens são opacos e armazenados apenas como hash SHA-256. Logs não registram valores.
- Código de uso único e refresh token com rotação; reuso de refresh revoga a conexão inteira.
- Resource indicator validado em autorização, troca, renovação e validação do access token. Falha gera `invalid_target` ou `invalid_token`, sem emitir token para outros recursos.
- Sem token passthrough: nenhum token é encaminhado a serviços externos, nem aceito de provedores externos.
- Sem tokens globais/de admin: toda emissão está ligada a `userId`, `clientId` e `connectionId`.

### Limites de superfície

- `MCP_ENABLED=false` por padrão; configuração inválida resulta em `404`/`503`.
- Em produção, `MCP_PUBLIC_BASE_URL` é obrigatório e precisa ser HTTPS; `http` só em loopback. Isso impede `issuer` forjado por `Host`.
- Origens browser são verificadas (`Origin` + allowlist); CORS só devolve headers para origens permitidas, exceto endpoints de descoberta/DCR/token/revoke, que são abertos por especificação.
- Consentimento usa cookie SameSite=Lax e checagem de `Origin`/`Sec-Fetch-Site`; formulário via POST JSON e navegação para a redirect URI registrada.
- Corpo limitado: MCP 64 KiB por padrão, token 16 KiB, authorize/register 32 KiB, revoke 8 KiB. Resposta JSON limitada a 256 KiB por padrão.
- No máximo 20 `tools/call` por requisição JSON-RPC (incluindo batches).
- Paginação padrão 20, máximo 100; cursors opacos com limite superior.
- Conteúdo de documento truncado (50 mil caracteres) e `data` JSON sanitizado (profundidade/arrays/strings limitados).
- URLs de mídia omitidas por padrão (`MCP_EXPOSE_MEDIA_URLS=false`); quando habilitado, apenas origem local ou hosts allowlistados.
- Rate limit distribuído no PostgreSQL: 60 chamadas de ferramenta/minuto/usuário, 30 buscas/minuto/usuário e 300 requisições MCP/minuto por IP e por usuário (incluindo `initialize`, `tools/list`, mensagens inválidas e bearer inválido), com HTTP 429 e `Retry-After`. Limites adicionais por IP para registro/token/revoke/autorização.
- Em produção, `TRUST_PROXY_HEADERS=true` é obrigatório quando MCP está habilitado; sem ele a configuração falha fechado, evitando que todos os chamadores compartilhem a chave `direct-connection`. O proxy precisa sobrescrever `X-Forwarded-For`.

### Erros e logs

- Erros de ferramenta retornam mensagens públicas curtas; detalhes de exceção viram mensagem genérica e são registrados pelo nome do erro, nunca pelo conteúdo.
- Campanha fora da concessão, arquivo invisível ou sessão de outro usuário retornam `404`, evitando confirmação de existência (IDOR e metadata leak).
- Auditoria registra ação, ator, cliente, ferramenta, duração e contagem, sem tokens, parâmetros de busca ou conteúdo.
- Nenhuma alteração de UI além da tela de consentimento, da página `/mcp` e do redirecionamento de login.

## Ameaças consideradas

| Ameaça | Mitigação |
| --- | --- |
| Redirect aberto | Redirect URI exata cadastrada, validada como HTTPS/loopback, sem fragmento/credenciais. |
| PKCE fraco/ausente | S256 obrigatório; `plain` rejeitado; verifier com alfabeto RFC 7636. |
| Cross-site consent | Sessão SameSite + verificação de `Origin`/`Sec-Fetch-Site`. |
| Token stolen / replay | Tokens opacos com hash, expiração curta, rotação de refresh e revogação imediata. |
| IDOR entre campanhas | Concessão explícita + acesso atual do usuário + queries com `campaignId`. |
| Vazamento para jogador | `publishedFileWhere`, `restrictToGrants`, audiência P1–P4, modo jogador obrigatório. |
| Abuso por volume | Rate limit distribuído, limites de corpo/resposta, paginação, custo por batch. |
| Forged `Host` / `issuer` | `MCP_PUBLIC_BASE_URL` obrigatório em produção. |
| Log de segredos | Tokens/códigos nunca logged; apenas nomes de erro e metadados. |

## Limitções

Ver [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md). Em especial: o consentimento não exige `nonce` OIDC (o fluxo é OAuth puro), e a aprovação depende da proteção de cookie do framework (sem token CSRF persistido).

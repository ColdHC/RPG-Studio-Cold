# Limitações conhecidas do servidor MCP

## Funcionais

- **Claude Web não validado**: interoperabilidade com o conector web do Claude está pendente de teste com conta real.
- **MCP Inspector não executado**: a validação foi automatizada; não houve sessão interativa com o Inspector neste ambiente.
- **Sem POST/GET/DELETE streams**: o servidor é stateless (`enableJsonResponse: true`). Requisições GET/DELETE ao `/api/mcp` recebem `405`. Clientes que exigem SSE de longa duração não são suportados.
- **Plugin/prompt/resources**: apenas ferramentas são expostas; não há resources, prompts nem subscrições.
- **Busca textual simples**: usa `contains` do PostgreSQL, sem índice full-text ou ranqueamento. Buscas muito amplas consomem mais banco e são limitadas por rate limit.
- **Mapas e mídia**: mapas são arquivos `FileType.MAP`; URLs de anexos são omitidas por padrão. Quando habilitadas, dependem de `MCP_ALLOWED_MEDIA_HOSTS`.
- **Campanhas arquivadas**: não aparecem no consentimento e saem do contexto de acesso do token enquanto arquivadas. O registro da concessão permanece, mas nenhuma ferramenta a lista até a campanha ser reativada; o acesso também continua dependendo da associação atual do usuário e das regras de visualização.
- **Sessões**: somente o Mestre pode consultar planejamento; jogadores recebem erro, alinhado ao serviço existente.

## Operacionais

- **Migration não aplicada em banco isolado**: o daemon Docker não estava disponível nesta sessão. A migration foi gerada por `prisma migrate diff` e validada pelo Prisma CLI, mas não executada contra PostgreSQL.
- **Rate limit por janela fixa**: há rajadas no limite da janela e o contador é reiniciado a cada minuto. Não há slate window ou token bucket.
- **Limpeza probabilística**: linhas expiradas de `McpRateLimit` são removidas com chance de 1% por chamada; picos podem deixar linhas órfãs temporariamente.
- **Auditoria assíncrona**: falhas de gravação de auditoria são engolidas (`catch`) para não quebrar a resposta. Em incidentes, eventos podem faltar.
- **Sem rotação automática de segredo de cliente**: somente clientes públicos são suportados por desenho.
- **Sem `nonce` OIDC**: o fluxo é OAuth 2.1 puro, não OpenID Connect; identidade do cliente é o `client_id` registrado.

## Segurança / decisões aceitas

- A proteção contra CSRF no consentimento usa cookie SameSite=Lax e checagem de `Origin`/`Sec-Fetch-Site`, sem token CSRF persistido. Isso depende da correta configuração de cookies/proxy pelo framework.
- `MCP_ALLOWED_ORIGINS` é necessário para clientes browser hospedados em outra origem. Uma allowlist muito ampla reduz a proteção contra chamadas indesejadas do navegador; o bearer token ainda é obrigatório.
- Revogação OAuth (`/api/oauth/revoke`) exige `client_id` como parâmetro público. Isso segue a especificação, mas não autentica o cliente; a revogação de um token conhecido é permitida ao cliente correspondente.
- Erros de ferramenta são intencionalmente genéricos para evitar vazamento; isso pode dificultar diagnóstico sem consultar auditoria/logs.

## Revisão independente

Uma revisão estática independente foi executada. Achados corrigidos nesta entrega:

- **Alto**: limite das rotas OAuth por IP global quando `TRUST_PROXY_HEADERS=false` → `TRUST_PROXY_HEADERS=true` passou a ser obrigatório em produção com MCP habilitado (fail closed); infraestrutura precisa sobrescrever `X-Forwarded-For`.
- **Alto**: `/api/mcp` sem limite antes da autenticação e para mensagens não-`tools/call` → limite por IP antes da validação do token e limite por usuário para mensagens sem chamada de ferramenta.
- **Médio**: `scope` do DCR validado mas descartado → escopos registrados são persistidos e limitam a autorização; consentimento permite reduzi-los.
- **Médio**: `grant_types` não respeitado na renovação → refresh token só é emitido quando declarado e o grant é validado no endpoint de token.
- **Médio**: campanhas arquivadas aceitas via API → filtro server-side adicionado.
- **Médio**: alfabeto do PKCE verifier divergia do RFC 7636 → regex própria para verifier (`[A-Za-z0-9-._~]`).
- **Médio**: reuso concorrente de refresh podia revogar conexão legítima → apenas reuso confirmado revoga; corrida atômica retorna `invalid_grant` sem revogação.
- **Baixo**: comparação de `Origin` como string → normalização via `URL.origin`.
- **Baixo**: URL relativa de mídia com `\` → rejeitada.
- **Baixo**: coleções de `get_session` sem limite → `take: 100` em arquivos, hipóteses e views.
- **Baixo**: auditoria de erro sem `campaignId` → campaignId passado também em falhas.

A segunda passagem da revisão corrigiu ainda:

- **Alto**: `POST /api/oauth/authorize` consultava a sessão antes de qualquer rate limit → limite por IP antes de `getCurrentUser()` e limite por `user.id:ip` depois; a página GET de consentimento também passou a ser limitada por IP antes de consultar cliente/sessão.
- **Médio**: cliente registrado com escopo reduzido falhava quando `scope` era omitido → ausência passa a significar os escopos registrados do cliente.
- Documentação alinhada ao código: campanhas arquivadas saem do contexto do token e retry sequencial de refresh é tratado como reuso.

Riscos que permanecem aceitos ou não verificáveis:

- Não há rota administrativa para desativar um `McpOAuthClient` comprometido (o campo `isActive` existe no banco; desativação é operacional via banco de dados).
- `state` continua opcional e não vinculado a uma sessão de consentimento persistida; a proteção depende de SameSite + checagem de origem e PKCE.
- A eficácia do limite por IP depende de um proxy que sobrescreva `X-Forwarded-For`; isso não pôde ser verificado neste ambiente.
- Itens listados em "O que NÃO foi executado" em `TEST_REPORT.md` continuam pendentes.

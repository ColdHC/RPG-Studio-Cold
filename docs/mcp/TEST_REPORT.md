# Relatório de testes do servidor MCP

## Escopo

Validação das rotas OAuth/MCP, helpers de configuração/HTTP/tokens, serviço de autenticação, serviço de ferramentas e rate limiter distribuído. Os testes são automatizados com Vitest e usam mocks de Prisma; não dependem de banco real.

## Comandos executados

| Comando | Resultado |
| --- | --- |
| `DATABASE_URL=... DATABASE_URL_UNPOOLED=... npm run prisma:validate` | ✅ schema válido |
| `DATABASE_URL=... DATABASE_URL_UNPOOLED=... npm run prisma:format` | ✅ formatado (`--check`) |
| `npx tsc --noEmit` | ✅ sem erros |
| `npm run lint` | ✅ sem avisos/erros |
| `npm run test:run` | ✅ 65 arquivos, 382 testes aprovados |
| `npm run build` | ✅ build de produção concluído, rotas MCP listadas |

> URLs de conexão reais não são exibidas; variáveis dummy foram usadas apenas para os comandos Prisma CLI.

## Testes MCP adicionados

- `src/app/.well-known/oauth-protected-resource/route.test.ts` — 404 quando desabilitado e metadata canônica do recurso.
- `src/lib/mcp/config.test.ts` — desabilitado por padrão, URL canônica, rejeição de HTTP inseguro/path/credenciais/query, fail closed em limites inválidos, parsing estrito de escopos.
- `src/lib/mcp/tokens.test.ts` — vetor RFC 7636 para PKCE S256, rejeição de valores fracos, hash determinístico de tokens, cursors opacos e truncamento.
- `src/lib/mcp/http.test.ts` — bearer header, limite de corpo, allowlist de `Origin`, CORS, `WWW-Authenticate` com `resource_metadata`, parâmetros duplicados.
- `src/services/mcpAuthService.test.ts` — validação de redirect URI (HTTPS/loopback), DCR de cliente público, metadata inválida, PKCE/redirect/resource/escopos obrigatórios, cliente inativo/desconhecido.
- `src/services/mcpToolService.test.ts` — rejeição de campanha fora da concessão antes de tocar o banco, checagem de escopo, 404 para arquivo de outra campanha, sessões owner-only, visibilidade de relações P1–P4, contagem sem conteúdo, presets de sistema.
- `src/services/mcpRateLimitService.test.ts` — chave por escopo/usuário, janela fixa, bloqueio com `Retry-After`, custo de batch.
- `src/app/api/mcp/route.test.ts` — 404 quando desabilitado, 401 com metadata, token inválido, origem desconhecida, 429, contexto validado repassado ao transporte, limites de requisição/resposta, 405 para GET/DELETE, preflight CORS.
- `src/app/api/oauth/register/route.test.ts` — desligado, rate limit, JSON/metadata inválidos, mapeamento de erros OAuth, cliente registrado.
- `src/app/api/oauth/authorize/route.test.ts` — limite por IP antes da consulta de sessão, login obrigatório, proteção contra cross-site, redirect não registrado, código de uso único com `state`/`iss`, negação com `access_denied`.
- `src/app/api/oauth/token/route.test.ts` — desligado, parâmetros duplicados, grant types não suportados, troca com PKCE, rotação de refresh, erro de reuso, rate limit.
- `src/app/api/oauth/revoke/route.test.ts` — desligado, parâmetros obrigatórios, duplicatas, resposta 200 sem corpo.

## Fixtures de segurança

Os cenários de isolamento são exercitados no nível de serviço com dois usuários/campanhas simulados:

- dono da campanha A versus jogador da campanha A;
- campanha B fora da concessão explícita;
- arquivo invisível/privado/arquivado;
- relação com visibilidade `GM` e `P1` para audiência `P1`;
- tentativa de acessar sessões como jogador.

Esses fixtures são mocks de Prisma, não registros em PostgreSQL.

## O que NÃO foi executado

- **Banco PostgreSQL isolado com Docker**: `docker compose -f docker-compose.test.yml up -d` falhou porque o daemon Docker não está disponível neste ambiente (`Cannot connect to the Docker daemon`). Portanto, a migration não foi aplicada em banco isolado durante esta sessão.
- **MCP Inspector interativo**: não foi executado; a validação foi automatizada nas camadas HTTP/serviço.
- **Cliente MCP real (Claude Desktop/Claude Code)**: não foi executado de ponta a ponta.
- **Claude Web**: interoperabilidade **pendente**, sem teste com conta real.
- **Carga/concorrência**: não houve medição de latência ou vazão com múltiplas réplicas.

Nenhum resultado acima deve ser lido como evidência de que esses fluxos foram validados.

## Revisão de segurança independente

A revisão estática independente foi concluída em duas passagens. A primeira encontrou 2 achados de severidade alta, 5 médios e 5 baixos; a segunda encontrou 1 alto remanescente e inconsistências de default/documentação. Todos foram corrigidos nesta entrega. O detalhamento está em `KNOWN_ISSUES.md` e as correções no `CHANGELOG.md`. A revisão não executou testes nem aplicou migration.

Testes adicionais incluídos após as revisões:

- limite por IP antes da validação do token em `/api/mcp` e antes da consulta de sessão em `/api/oauth/authorize`;
- escopo registrado no DCR, rejeição de solicitação mais ampla e default para os escopos registrados quando `scope` é omitido;
- `grant_types` aplicado também na renovação;
- filtro de campanhas arquivadas em `accessibleCampaignsForUser`;
- normalização de `Origin` em `isSameSiteRequest`;
- alfabeto RFC 7636 do `code_verifier`.

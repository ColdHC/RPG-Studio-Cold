# Performance do servidor MCP

Este documento descreve **custos esperados por projeto**, não ganhos medidos. Nenhuma comparação de antes/depois foi executada nesta sessão; consulte `TEST_REPORT.md` para o que foi de fato validado.

## Custos por requisição

### `/api/mcp`

1. `validateAccessToken`: 1 consulta ao token (com conexão, cliente e grants), 1 consulta ao usuário e 1 consulta às campanhas acessíveis.
2. `consumeRateLimit`: 1 `upsert` no PostgreSQL por categoria limitada (ferramentas e/ou buscas).
3. Ferramenta: tipicamente 1–3 consultas (verificação de acesso, viewer e dados).
4. `recordAudit`: gravação assíncrona, sem bloquear a resposta.

O transporte e o `McpServer` são criados por requisição. Isso evita estado compartilhado entre réplicas, ao custo de alguma alocação por chamada.

### Rotas OAuth

- Registro: 1 `create` + auditoria.
- Autorização (GET): validação de cliente + listagem de campanhas do usuário.
- Aprovação (POST): validação de cliente, listagem de campanhas e 1 `create` do código.
- Troca de código: leitura do código, `updateMany` atômico de consumo, `updateMany` de grants e transação com criação de conexão/tokens.
- Renovação: leitura do refresh, `updateMany` atômico de rotação e transação de novos tokens.
- Validação de token em cada chamada MCP: ver acima.

## Limites que protegem o banco

- Paginação padrão 20, máximo 100 (`take: limit + 1` para detectar `nextCursor`).
- Busca com `LIKE` (`contains`) pode ser custosa; por isso há limite de 30 buscas/minuto/usuário e limite de tamanho do `query`.
- `take` e `skip` são sempre aplicados após filtros de campanha/visibilidade.
- `getRelationships` busca a lista de arquivos visíveis do jogador antes de filtrar relações; em campanhas muito grandes isso pode ser significativo.
- Auditoria e limpeza de rate limit são fire-and-forget; falhas não afetam a resposta.

## Rate limiting distribuído

A tabela `McpRateLimit` usa chave `(key, windowStart)` única. O `upsert` com `count: { increment }` é atômico no PostgreSQL, então réplicas serverless compartilham o mesmo orçamento. A limpeza de linhas expiradas acontece probabilisticamente (1% das chamadas) para evitar uma consulta extra em toda requisição.

## Instrumentação existente

O projeto já possui telemetria opt-in (`PERFORMANCE_LOGS`) que registra rota, modelo Prisma, ação, status e duração. Os eventos MCP usam `recordAudit` com `durationMs` por ferramenta, o que permite acompanhar latência por toolname sem coletar parâmetros ou conteúdo.

## Como medir antes de otimizar

1. Habilitar `PERFORMANCE_LOGS` em staging com volume representativo.
2. Coletar duração por rota `/api/mcp`, `/api/oauth/token` e por `MCP_TOOL_CALL`.
3. Verificar contagem de linhas em `McpRateLimit` e índices usados nas tabelas `CampaignFile`/`Relationship`.
4. Somente então considerar índices adicionais, cache de grants ou redução de consultas.

Nenhuma dessas medições foi realizada nesta sessão; nenhum ganho é reivindicado.

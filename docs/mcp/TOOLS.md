# Ferramentas MCP

Todas as ferramentas são somente leitura (`readOnlyHint: true`, `destructiveHint: false`) e usam escopo dedicado. Parâmetros extras são rejeitados por schemas `.strict()`.

## Convenções

- `campaignId`: ID de uma campanha explicitamente autorizada para a conexão. Fora dela, a ferramenta responde `404` sem revelar se a campanha existe.
- `limit`: inteiro 1–100; padrão `MCP_DEFAULT_PAGE_SIZE` (20), máximo efetivo `MCP_MAX_PAGE_SIZE` (100).
- `cursor`: cursor opaco da resposta anterior; `nextCursor: null` indica fim da paginação.
- Busca por texto: `contains` case-insensitive em nome, descrição e conteúdo; resultados de busca incluem trechos (`snippet`).
- Escopos ausentes no token geram erro público `O token não possui o escopo necessário para esta consulta.`

## 1. `list_campaigns`

Escopo: `campaigns:read`. Entrada: `{ limit?, cursor? }`.

Lista apenas campanhas da concessão que continuam acessíveis ao usuário (dono ou membro e não arquivadas). Campanhas arquivadas saem do contexto do token enquanto permanecem arquivadas. Retorna `campaigns[]` com `id`, `name`, `description`, `system`, `isArchived`, `role`, `audience`, `updatedAt` e `nextCursor`.

## 2. `get_campaign`

Escopo: `campaigns:read`. Entrada: `{ campaignId }`.

Retorna metadados e `countsByType` de arquivos visíveis não arquivados. Nunca retorna conteúdo de documentos.

## 3. `search_documents`

Escopo: `documents:read`. Entrada: `{ campaignId?, query, types?, limit?, cursor? }`.

`query` tem 2–200 caracteres. Sem `campaignId`, busca em todas as campanhas autorizadas e visíveis no momento. `types` aceita até 16 valores entre os tipos de arquivo suportados. Retorna `results[]` com resumo, `campaignName` e `snippet`, nunca o conteúdo completo.

## 4. `list_documents`

Escopo: `documents:read`. Entrada: `{ campaignId, type?, query?, tag?, includeArchived?, limit?, cursor? }`.

Lista resumos de arquivos visíveis. `includeArchived` é desabilitado para jogadores pela política de publicação.

## 5. `get_document`

Escopo: `documents:read`. Entrada: `{ campaignId, documentId }`.

Retorna resumo, `content` (truncado em `MCP_MAX_CONTENT_CHARS`), `contentTruncated`, `data` sanitizado, `dataTruncated`, `restrictToGrants` e anexos (URLs omitidas por padrão).

## 6. `list_entities`

Escopo: `entities:read`. Entrada: `{ campaignId, entityType?, query?, includeArchived?, limit?, cursor? }`.

Tipos: `NPC`, `CHARACTER`, `THREAT`, `LOCATION`, `OBJECT`, `CLUE`, `PUZZLE`.

## 7. `get_entity`

Escopo: `entities:read`. Entrada: `{ campaignId, entityId }`.

Mesmo formato de detalhe de `get_document`, com verificação de tipo de entidade.

## 8. `get_relationships`

Escopo: `relationships:read`. Entrada: `{ campaignId, entityId?, direction?, limit?, cursor? }`.

`direction`: `both` (padrão), `outgoing` ou `incoming`. Para jogadores, aplica `visibility` GM/P1–P4 e exige que ambas as pontas estejam visíveis. Para o Mestre, apenas o filtro de campanha é aplicado.

## 9. `list_maps`

Escopo: `maps:read`. Entrada: `{ campaignId, query?, limit?, cursor? }`.

Lista arquivos do tipo `MAP` visíveis.

## 10. `get_map`

Escopo: `maps:read`. Entrada: `{ campaignId, mapId }`.

Retorna detalhes do mapa, `data` sanitizado e anexos permitidos. URLs de mídia são opcionais e restritas.

## 11. `list_sessions`

Escopo: `sessions:read`. Entrada: `{ campaignId, status?, limit?, cursor? }`.

`status`: `PLANNED` ou `COMPLETED`. Disponível somente para `OWNER`; jogadores recebem erro público, sem consulta ao banco.

## 12. `get_session`

Escopo: `sessions:read`. Entrada: `{ campaignId, sessionId }`.

Retorna planejamento: resumo e pós-resumo truncados, checklist/objetivos/agenda limitados, arquivos vinculados, hipóteses e views. Somente `OWNER`.

## 13. `get_rpg_system`

Escopo: `systems:read`. Entrada: `{ campaignId }`.

Retorna `system`, atributos, perícias, classes e raças. Para sistemas embutidos, usa os presets canônicos; para sistema customizado, retorna os dados da campanha.

A lista canônica é a seção de registro em `src/lib/mcp/server.ts`.

## Formato de erro

Erros de ferramenta são `CallToolResult` com `isError: true` e `{ "error": "<mensagem pública>" }`. Erros de transporte/autenticação são HTTP com corpo JSON e, quando aplicável, `WWW-Authenticate`.

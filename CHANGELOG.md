# Changelog

Registro de alterações verificadas no histórico Git local. Não representa releases publicados.

## Unreleased

### Added

- Biblioteca de mídia por campanha com assets reutilizáveis, referências, upload validado e Blob privado.
- Seletor universal de mídia, lightbox com zoom/teclado e galerias de documento.
- Visualizador de mapas com zoom, pan, fullscreen, camadas com acesso, marcadores arrastáveis e geometrias básicas em coordenadas relativas.
- Editor visual com upload por colagem/arrastar, legenda, largura e alinhamento seguro de imagens; mapas agora aceitam imagem de marcador, preview de vínculos e edição de vértices.
- Mídia gera thumbnails WebP privadas para biblioteca, seletor, cartões, galerias, marcadores e avatares do grafo, sem substituir os originais.
- Página pública `/help/mcp` com instruções de conexão para Claude Web, Desktop e Code, linkada a partir de `/mcp` e da metadata OAuth como documentação do serviço/recurso.
- Atalho **Conexões MCP** no cabeçalho global da página inicial, na sidebar da campanha e no centro de controle de Configurações quando o servidor MCP está habilitado.
- Configuração opcional `MCP_CLAUDE_CLIENT_ID` para exibir o Client ID público nas instruções quando o cliente não usa registro automático.
- Grafo de Relações administrativo com filtros, auto-layout, posições locais, navegação, edição e exclusão usando o serviço oficial de relacionamentos.
- Relatório técnico `docs/RELATIONSHIP_GRAPH_AND_COMPILER_V6.md`.
- Temas por campanha com rascunho, publicação, aplicação, presets e validação.
- Suporte ao 3DeT Victory, ficha adaptativa, rolagem e regra resumida.
- Editor de documentos com leitura, edição visual, Markdown, sumário e links entre entidades.
- Telemetria opt-in de rotas, operações server-side e consultas Prisma.
- Exploração de arquivos com dados iniciais server-rendered.
- Índices compostos para listagens de arquivos.
- Servidor MCP remoto somente leitura em `/api/mcp`, com OAuth 2.1 + PKCE S256, DCR, metadata de recurso protegido e AS, tokens opacos com rotação de refresh e revogação.
- Tela de consentimento `/oauth/authorize` com seleção explícita de campanhas e página `/mcp` para revisar/revogar conexões.
- 13 ferramentas MCP de leitura, com escopos dedicados, visibilidade de jogador/Mestre e limites de resposta.
- Rate limiter distribuído em PostgreSQL para chamadas de ferramentas, buscas e rotas OAuth.
- Documentação em `docs/mcp/` (arquitetura, autenticação, segurança, ferramentas, configuração, setup de cliente, relatório de testes, performance e limitações).

### Changed

- Cabeçalho e sidebar das campanhas passaram a oferecer atalho explícito de retorno à lista de campanhas.
- Compilador V6 passou a iniciar recolhido no dashboard, carregar o diagnóstico sob demanda e persistir a preferência por usuário/campanha.
- Shell da campanha e listas de arquivos passaram a aceitar carregamento inicial e consultas compatíveis paralelas.
- Páginas e componentes receberam contenção responsiva.
- `getCampaignAccess` e `getViewerContext` passaram a delegar para variantes que recebem o usuário explicitamente, permitindo reutilização segura fora do cookie de sessão.
- `AuthForm` passou a respeitar o parâmetro `next` ao retornar do login para o consentimento MCP.

### Fixed

- Contenção do editor de documentos, controles compartilhados e grids em larguras menores.
- Temas de campanha agora mantêm configurações independentes para os modos claro e escuro, incluindo compatibilidade com temas legados.
- Correções da revisão de segurança MCP: limite de requisições antes da autenticação e antes da consulta de sessão no consentimento, escopos do DCR persistidos e respeitados (incluindo default quando `scope` é omitido), `grant_types` aplicado ao refresh, filtro de campanhas arquivadas no servidor, alfabeto PKCE conforme RFC 7636, normalização de `Origin`, limite de coleções em `get_session` e auditoria de erro com `campaignId`.

### Improved

- Redução de consultas redundantes e carregamento sob demanda de painéis pesados.
- Instrumentação reproduzível para tempo de rota, operação e consulta.

### Security

- Imagens de tema permanecem limitadas por schema, tipo MIME e tamanho no endpoint.
- Mídia nova valida assinatura/dimensões, rejeita SVG, usa entrega autenticada e não grava Base64 no PostgreSQL.
- MCP desabilitado por padrão; configuração inválida falha fechado, `issuer` não é derivado de `Host` em produção e tokens/códigos são armazenados apenas como hash.
- Isolamento MCP por concessão explícita de campanha e associação atual do usuário, com erros `404` para recursos fora da concessão.
- PKCE S256 obrigatório, redirect URI exata, resource indicator validado, refresh tokens com rotação e detecção de reuso.
- Consentimento protegido por cookie SameSite e checagem de origem; limites de corpo/resposta, paginação e rate limits distribuídos.
- `TRUST_PROXY_HEADERS=true` obrigatório em produção quando MCP está habilitado, para não compartilhar o limite por IP entre todos os chamadores.

### Database Changes

- `20261124150000_campaign_themes`: `CampaignTheme`, `ThemePreset` e tema ativo.
- `20261124100000_add_3det_victory`: enum aditivo `SystemType.THREEDET_VICTORY`.
- `20261124170000_add_campaign_file_list_indexes`: índices compostos de `CampaignFile`.
- `20261124190000_media_assets`: `MediaAsset`, `MediaReference` e enum de visibilidade.
- `20261125120000_mcp_oauth_server`: tabelas aditivas `McpOAuthClient`, `McpAuthorizationCode`, `McpConnection`, `McpCampaignGrant`, `McpAccessToken`, `McpRefreshToken` e `McpRateLimit`.

### Deprecated / Removed

- Nenhuma remoção de funcionalidade registrada nesses commits.

# Configuração de clientes MCP

Este servidor usa Streamable HTTP com OAuth 2.1 + PKCE e registro dinâmico de clientes. Clientes que suportam esse perfil podem se conectar usando apenas a URL do servidor.

## URL do servidor

```
https://<seu-dominio>/api/mcp
```

Substitua `<seu-dominio>` pela origem configurada em `MCP_PUBLIC_BASE_URL`.

## Cliente genérico / MCP Inspector

1. Abra o MCP Inspector e selecione o transporte **Streamable HTTP**.
2. Informe a URL acima.
3. Inicie o fluxo OAuth. O Inspector deve descobrir:
   - `/.well-known/oauth-protected-resource/api/mcp`
   - `/.well-known/oauth-authorization-server`
   - registro dinâmico em `/api/oauth/register`
4. Faça login no RPG Studio quando redirecionado e selecione explicitamente as campanhas na tela de consentimento.
5. Após o retorno, o Inspector deve listar as ferramentas e permitir chamadas somente de leitura.

> **Estado da validação:** os testes automatizados cobrem rotas e helpers OAuth/MCP. A execução interativa do MCP Inspector **não foi realizada neste ambiente** (daemon Docker indisponível para a infraestrutura de teste); veja `TEST_REPORT.md`.

## Claude Desktop / Claude Code (transporte remoto)

Clientes que aceitam uma URL remota devem receber:

```json
{
  "mcpServers": {
    "rpg-campaign-studio": {
      "url": "https://<seu-dominio>/api/mcp"
    }
  }
}
```

O cliente é responsável por:

- seguir a metadata de recurso protegido e do servidor de autorização;
- registrar-se via DCR com `token_endpoint_auth_method: "none"`;
- gerar `code_verifier`/`code_challenge` S256 e `state`;
- abrir `/oauth/authorize` no navegador do usuário;
- enviar `Authorization: Bearer <access_token>` nas requisições a `/api/mcp`;
- renovar o token via `refresh_token` quando expirar.

A URL **não** é um endpoint de API com chave: não existe API key nem token compartilhado para copiar.

## Claude Web (interface web)

A interoperabilidade com o conector web do Claude depende do suporte do produto a DCR, PKCE S256, resource indicators e ao formato de metadata usado aqui. **Não foi testada** nesta implementação e deve ser considerada pendente até validação explícita com uma conta real.

## Solução de problemas

| Sintoma | Causa provável |
| --- | --- |
| `404` em todas as rotas | `MCP_ENABLED` não é `true`. |
| `503` com `temporarily_unavailable` | Configuração inválida; verifique `MCP_PUBLIC_BASE_URL` e limites numéricos. |
| `401` com `WWW-Authenticate` | Token ausente/expirado/revogado; refaça o fluxo OAuth. |
| `403` no consentimento | Origem não permitida ou sessão expirada; entre novamente no RPG Studio. |
| `429` | Limite de ferramentas/buscas por minuto; respeite `Retry-After`. |
| Nenhuma campanha visível | Nenhuma campanha foi selecionada no consentimento ou o usuário perdeu acesso. |

## Revogação

Acesse `https://<seu-dominio>/mcp` com a conta do usuário para listar e revogar conexões. Revogar invalida imediatamente access tokens e refresh tokens daquela conexão.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { McpToolError } from './errors';
import { recordAudit } from '@/services/auditService';
import { ENTITY_TYPES, FILE_TYPES, mcpToolService, type McpToolContext } from '@/services/mcpToolService';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const campaignId = z.string().trim().min(1).max(64).describe('ID da campanha autorizada.');
const limit = z.number().int().min(1).max(100).optional().describe('Tamanho da página (1-100). Padrão: 20.');
const cursor = z.string().max(256).optional().describe('Cursor opaco retornado na página anterior.');
const query = z.string().trim().min(2).max(200).describe('Texto de busca (2-200 caracteres).');
const optionalQuery = z.string().trim().min(1).max(200).optional();
const fileType = z.enum(FILE_TYPES);
const entityType = z.enum(ENTITY_TYPES);

function toolContext(extra: RequestHandlerExtra<ServerRequest, ServerNotification>): McpToolContext {
  const context = extra.authInfo?.extra?.mcp as McpToolContext | undefined;
  if (!context) throw new McpToolError('Autenticação necessária.', 401);
  return context;
}

function countResults(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined;
  for (const key of ['campaigns', 'documents', 'entities', 'relationships', 'maps', 'sessions', 'results']) {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.length;
  }
  return undefined;
}

function textResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true
  };
}

async function executeTool(
  toolName: string,
  campaignIdForAudit: string | undefined,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  operation: (context: McpToolContext) => Promise<unknown>
): Promise<CallToolResult> {
  const startedAt = Date.now();
  let context: McpToolContext | undefined;
  try {
    context = toolContext(extra);
    const data = await operation(context);
    void recordAudit({
      campaignId: campaignIdForAudit,
      actorId: context.user.id,
      action: 'MCP_TOOL_CALL',
      entityType: 'McpTool',
      entityId: toolName,
      metadata: {
        tool: toolName,
        clientId: context.clientId,
        outcome: 'success',
        durationMs: Date.now() - startedAt,
        resultCount: countResults(data)
      }
    }).catch(() => undefined);
    return textResult(data);
  } catch (error) {
    const isPublic = error instanceof McpToolError;
    void recordAudit({
      campaignId: campaignIdForAudit,
      actorId: context?.user.id,
      action: 'MCP_TOOL_CALL',
      entityType: 'McpTool',
      entityId: toolName,
      metadata: {
        tool: toolName,
        clientId: context?.clientId,
        outcome: 'error',
        durationMs: Date.now() - startedAt,
        status: isPublic ? error.status : 500
      }
    }).catch(() => undefined);
    if (isPublic) return errorResult(error.publicMessage);
    console.error('[MCP] tool failed', toolName, error instanceof Error ? error.name : 'unknown');
    return errorResult('Não foi possível concluir a consulta.');
  }
}

export function createMcpServer() {
  const server = new McpServer(
    { name: 'rpg-campaign-studio', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Servidor somente leitura do RPG Campaign Studio. Use list_campaigns para descobrir as campanhas autorizadas. ' +
        'Todas as ferramentas respeitam as permissões e a visibilidade atuais do usuário. ' +
        'Nenhuma ferramenta cria, altera ou remove dados.'
    }
  );

  server.registerTool(
    'list_campaigns',
    {
      title: 'Listar campanhas autorizadas',
      description: 'Lista apenas as campanhas explicitamente autorizadas para esta conexão MCP.',
      inputSchema: z.object({ limit, cursor }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('list_campaigns', undefined, extra, (context) => mcpToolService.listCampaigns(context, args))
  );

  server.registerTool(
    'get_campaign',
    {
      title: 'Obter campanha',
      description: 'Retorna metadados de uma campanha autorizada e a contagem de arquivos visíveis por tipo.',
      inputSchema: z.object({ campaignId }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_campaign', args.campaignId, extra, (context) => mcpToolService.getCampaign(context, args))
  );

  server.registerTool(
    'search_documents',
    {
      title: 'Buscar documentos',
      description:
        'Busca em nomes, descrições, conteúdo e tags dos documentos visíveis. ' +
        'Sem campaignId, busca em todas as campanhas autorizadas. Retorna trechos, não o conteúdo completo.',
      inputSchema: z
        .object({
          campaignId: campaignId.optional(),
          query,
          types: z.array(fileType).max(16).optional(),
          limit,
          cursor
        })
        .strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('search_documents', args.campaignId, extra, (context) => mcpToolService.searchDocuments(context, args))
  );

  server.registerTool(
    'list_documents',
    {
      title: 'Listar documentos',
      description: 'Lista documentos e arquivos visíveis de uma campanha autorizada, com filtros opcionais.',
      inputSchema: z
        .object({
          campaignId,
          type: fileType.optional(),
          query: optionalQuery,
          tag: z.string().trim().min(1).max(80).optional(),
          includeArchived: z.boolean().optional(),
          limit,
          cursor
        })
        .strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('list_documents', args.campaignId, extra, (context) => mcpToolService.listDocuments(context, args))
  );

  server.registerTool(
    'get_document',
    {
      title: 'Obter documento',
      description: 'Retorna um documento visível, com conteúdo limitado e dados estruturados sanitizados.',
      inputSchema: z.object({ campaignId, documentId: z.string().trim().min(1).max(64) }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_document', args.campaignId, extra, (context) => mcpToolService.getDocument(context, args))
  );

  server.registerTool(
    'list_entities',
    {
      title: 'Listar entidades',
      description: 'Lista NPCs, personagens, ameaças, locais, objetos, pistas e puzzles visíveis.',
      inputSchema: z
        .object({
          campaignId,
          entityType: entityType.optional(),
          query: optionalQuery,
          includeArchived: z.boolean().optional(),
          limit,
          cursor
        })
        .strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('list_entities', args.campaignId, extra, (context) => mcpToolService.listEntities(context, args))
  );

  server.registerTool(
    'get_entity',
    {
      title: 'Obter entidade',
      description: 'Retorna uma entidade visível (NPC, personagem, ameaça, local, objeto, pista ou puzzle).',
      inputSchema: z.object({ campaignId, entityId: z.string().trim().min(1).max(64) }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_entity', args.campaignId, extra, (context) => mcpToolService.getEntity(context, args))
  );

  server.registerTool(
    'get_relationships',
    {
      title: 'Obter relacionamentos',
      description:
        'Lista relacionamentos visíveis de uma campanha ou de uma entidade específica. ' +
        'A visibilidade GM/P1-P4 é aplicada antes da resposta.',
      inputSchema: z
        .object({
          campaignId,
          entityId: z.string().trim().min(1).max(64).optional(),
          direction: z.enum(['both', 'outgoing', 'incoming']).optional(),
          limit,
          cursor
        })
        .strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_relationships', args.campaignId, extra, (context) => mcpToolService.getRelationships(context, args))
  );

  server.registerTool(
    'list_maps',
    {
      title: 'Listar mapas',
      description: 'Lista mapas visíveis de uma campanha autorizada.',
      inputSchema: z.object({ campaignId, query: optionalQuery, limit, cursor }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('list_maps', args.campaignId, extra, (context) => mcpToolService.listMaps(context, args))
  );

  server.registerTool(
    'get_map',
    {
      title: 'Obter mapa',
      description: 'Retorna um mapa visível com seus dados estruturados e anexos permitidos.',
      inputSchema: z.object({ campaignId, mapId: z.string().trim().min(1).max(64) }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_map', args.campaignId, extra, (context) => mcpToolService.getMap(context, args))
  );

  server.registerTool(
    'list_sessions',
    {
      title: 'Listar sessões',
      description: 'Lista planejamentos de sessão. Disponível apenas para o Mestre da campanha.',
      inputSchema: z
        .object({
          campaignId,
          status: z.enum(['PLANNED', 'COMPLETED']).optional(),
          limit,
          cursor
        })
        .strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('list_sessions', args.campaignId, extra, (context) => mcpToolService.listSessions(context, args))
  );

  server.registerTool(
    'get_session',
    {
      title: 'Obter sessão',
      description: 'Retorna o planejamento completo de uma sessão. Disponível apenas para o Mestre da campanha.',
      inputSchema: z.object({ campaignId, sessionId: z.string().trim().min(1).max(64) }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_session', args.campaignId, extra, (context) => mcpToolService.getSession(context, args))
  );

  server.registerTool(
    'get_rpg_system',
    {
      title: 'Obter sistema de RPG',
      description: 'Retorna o sistema da campanha, atributos, perícias, classes e raças disponíveis.',
      inputSchema: z.object({ campaignId }).strict(),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args, extra) => executeTool('get_rpg_system', args.campaignId, extra, (context) => mcpToolService.getRpgSystem(context, args))
  );

  return server;
}

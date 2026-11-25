import { getMcpConfig, isMcpEnabled, MCP_SCOPES } from '@/lib/mcp/config';
import { corsHeaders, jsonResponse } from '@/lib/mcp/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);
  try {
    const config = getMcpConfig(request);
    return jsonResponse(
      {
        resource: config.resource,
        authorization_servers: [config.issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: MCP_SCOPES,
        resource_documentation: `${config.baseUrl}/docs/mcp/README.md`
      },
      200,
      { ...corsHeaders(request, config, { allowAnyOrigin: true }), Vary: 'Origin' }
    );
  } catch {
    return jsonResponse({ error: 'temporarily_unavailable' }, 503);
  }
}

export async function OPTIONS(request: Request) {
  if (!isMcpEnabled()) return jsonResponse({ error: 'not_found' }, 404);
  try {
    const config = getMcpConfig(request);
    return new Response(null, { status: 204, headers: corsHeaders(request, config, { allowAnyOrigin: true }) });
  } catch {
    return jsonResponse({ error: 'temporarily_unavailable' }, 503);
  }
}

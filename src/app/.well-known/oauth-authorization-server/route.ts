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
        issuer: config.issuer,
        authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
        token_endpoint: `${config.baseUrl}/api/oauth/token`,
        registration_endpoint: `${config.baseUrl}/api/oauth/register`,
        revocation_endpoint: `${config.baseUrl}/api/oauth/revoke`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: MCP_SCOPES,
        resource_indicators_supported: true,
        authorization_response_iss_parameter_supported: true,
        service_documentation: `${config.baseUrl}/help/mcp`
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

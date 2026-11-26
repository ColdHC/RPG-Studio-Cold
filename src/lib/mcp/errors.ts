export type McpOAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_token'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable';

export class McpOAuthError extends Error {
  readonly code: McpOAuthErrorCode;
  readonly status: number;
  readonly publicDescription: string;

  constructor(code: McpOAuthErrorCode, publicDescription: string, status = 400) {
    super(publicDescription);
    this.name = 'McpOAuthError';
    this.code = code;
    this.status = status;
    this.publicDescription = publicDescription;
  }
}

export class McpToolError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly retryAfterSeconds?: number;

  constructor(publicMessage: string, status = 400, retryAfterSeconds?: number) {
    super(publicMessage);
    this.name = 'McpToolError';
    this.status = status;
    this.publicMessage = publicMessage;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

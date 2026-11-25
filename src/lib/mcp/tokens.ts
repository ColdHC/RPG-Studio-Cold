import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PKCE_MIN_LENGTH = 43;
const PKCE_MAX_LENGTH = 128;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]+$/;

export function randomToken(prefix: string, bytes = 32) {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

export function randomIdentifier(prefix: string, bytes = 24) {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

export function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidCodeChallenge(value: string | null | undefined): value is string {
  return !!value && value.length >= PKCE_MIN_LENGTH && value.length <= PKCE_MAX_LENGTH && BASE64URL.test(value);
}

export function isValidCodeVerifier(value: string | null | undefined): value is string {
  return !!value && value.length >= PKCE_MIN_LENGTH && value.length <= PKCE_MAX_LENGTH && PKCE_VERIFIER.test(value);
}

export function verifyPkceS256(verifier: string, challenge: string) {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  const calculated = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return safeEqual(calculated, challenge);
}

export function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined, maximum: number): number | null {
  if (!cursor) return 0;
  if (cursor.length > 256 || !BASE64URL.test(cursor)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown };
    if (typeof parsed.offset !== 'number' || !Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > maximum) {
      return null;
    }
    return parsed.offset;
  } catch {
    return null;
  }
}

export function truncateText(value: string, maximum: number) {
  if (value.length <= maximum) return { text: value, truncated: false };
  return { text: value.slice(0, maximum), truncated: true };
}

import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  hashToken,
  isValidCodeChallenge,
  isValidCodeVerifier,
  randomToken,
  truncateText,
  verifyPkceS256
} from './tokens';

describe('MCP token helpers', () => {
  it('verifies the RFC 7636 S256 example vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(verifier, `${challenge.slice(0, -1)}A`)).toBe(false);
  });

  it('rejects weak or malformed PKCE values', () => {
    expect(isValidCodeChallenge('short')).toBe(false);
    expect(isValidCodeChallenge('a'.repeat(129))).toBe(false);
    expect(isValidCodeChallenge('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier(`${'.'.repeat(21)}a${'~'.repeat(21)}`)).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43) + '=')).toBe(false);
  });

  it('hashes tokens deterministically without storing the raw value', () => {
    const token = randomToken('mcp_at');
    expect(token.startsWith('mcp_at_')).toBe(true);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(`${token}x`)).not.toBe(hashToken(token));
  });

  it('round-trips opaque pagination cursors and rejects invalid input', () => {
    expect(decodeCursor(encodeCursor(20), 1000)).toBe(20);
    expect(decodeCursor(null, 1000)).toBe(0);
    expect(decodeCursor('not-a-cursor!', 1000)).toBeNull();
    expect(decodeCursor(encodeCursor(1001), 1000)).toBeNull();
    expect(decodeCursor(encodeCursor(-1), 1000)).toBeNull();
  });

  it('truncates text without losing the flag', () => {
    expect(truncateText('abc', 10)).toEqual({ text: 'abc', truncated: false });
    expect(truncateText('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
  });
});

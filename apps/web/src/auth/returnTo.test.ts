import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearReturnTo,
  loginPathFor,
  peekReturnTo,
  rememberReturnTo,
  resolveReturnTo,
  safeReturnTo,
} from './returnTo';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

describe('safeReturnTo', () => {
  it.each(['/invite/abc', '/team?org=1', '/app'])('accepts %s', (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/a\nb',
    '',
    null,
    undefined,
    `/${'a'.repeat(600)}`,
  ])('refuses %s', (path) => {
    expect(safeReturnTo(path)).toBeNull();
  });
});

describe('remembered return path', () => {
  beforeEach(() => clearReturnTo());

  it('prefers and stores the query string', () => {
    rememberReturnTo('/older');
    expect(resolveReturnTo(`?returnTo=${encodeURIComponent('/invite/abc')}`)).toBe('/invite/abc');
    expect(peekReturnTo()).toBe('/invite/abc');
  });

  it('falls back to the stored path, and ignores an unsafe query', () => {
    rememberReturnTo('/invite/abc');
    expect(resolveReturnTo('?returnTo=https%3A%2F%2Fevil.example')).toBe('/invite/abc');
  });

  it('forgets after a day', () => {
    const now = Date.now();
    rememberReturnTo('/invite/abc', now - 25 * 60 * 60 * 1000);
    expect(peekReturnTo(now)).toBeNull();
  });

  it('builds a round-trippable login path', () => {
    const path = loginPathFor('/invite/a-b_c');
    expect(resolveReturnTo(path.slice(path.indexOf('?')))).toBe('/invite/a-b_c');
  });
});

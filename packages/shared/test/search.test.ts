import { describe, expect, it } from 'vitest';
import {
  SEARCH_IDENTIFIERS,
  SEARCH_IDENTIFIER_LABELS,
  globalSearchQuerySchema,
  normalizeIdentifier,
  parseSearchId,
  updateSearchIdentifiersSchema,
} from '../src';

describe('normalizeIdentifier', () => {
  it('lower-cases and drops spaces and hyphens', () => {
    expect(normalizeIdentifier('LAF5-00123')).toBe('laf500123');
    expect(normalizeIdentifier(' KA 01 ab-1234 ')).toBe('ka01ab1234');
    expect(normalizeIdentifier('\tMA1 X')).toBe('ma1x');
  });
  it('keeps other punctuation', () => {
    expect(normalizeIdentifier('a_b%c/d')).toBe('a_b%c/d');
  });
});

describe('parseSearchId', () => {
  it('reads prefixed ids in any case, with a hyphen, a space or nothing', () => {
    expect(parseSearchId('OM-00045')).toEqual({ prefix: 'OM', number: 45 });
    expect(parseSearchId('oe-45')).toEqual({ prefix: 'OE', number: 45 });
    expect(parseSearchId('TK 112')).toEqual({ prefix: 'TK', number: 112 });
    expect(parseSearchId('tk112')).toEqual({ prefix: 'TK', number: 112 });
    expect(parseSearchId(' TT-00004 ')).toEqual({ prefix: 'TT', number: 4 });
  });
  it('reads bare numbers, leading zeros included', () => {
    expect(parseSearchId('112')).toEqual({ number: 112 });
    expect(parseSearchId('00045')).toEqual({ number: 45 });
  });
  it('rejects junk, zero and other prefixes', () => {
    for (const text of ['', 'OM-', 'LAF5-00123', 'XX-1', '0', 'OM-0', '1234567890', 'om--1', '12a']) {
      expect(parseSearchId(text)).toBeNull();
    }
  });
});

describe('search schemas', () => {
  it('trims q and defaults the limit', () => {
    expect(globalSearchQuerySchema.parse({ q: '  laf ' })).toEqual({ q: 'laf', limit: 20 });
    expect(globalSearchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(globalSearchQuerySchema.safeParse({ q: 'x', limit: '101' }).success).toBe(false);
  });

  const all = SEARCH_IDENTIFIERS.map((identifier) => ({ identifier, enabled: true }));
  it('takes every identifier exactly once', () => {
    expect(updateSearchIdentifiersSchema.safeParse({ items: [...all].reverse() }).success).toBe(true);
    expect(updateSearchIdentifiersSchema.safeParse({ items: all.slice(1) }).success).toBe(false);
    const dup = [...all.slice(1), all[1]!];
    expect(updateSearchIdentifiersSchema.safeParse({ items: dup }).success).toBe(false);
  });
  it('needs at least one identifier on', () => {
    const off = all.map((i) => ({ ...i, enabled: false }));
    const result = updateSearchIdentifiersSchema.safeParse({ items: off });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('Keep at least one identifier on');
  });
  it('labels every identifier', () => {
    expect(Object.keys(SEARCH_IDENTIFIER_LABELS)).toEqual([...SEARCH_IDENTIFIERS]);
  });
});

import { describe, expect, it } from 'vitest';
import { emailSchema, passwordSchema } from '../src';

describe('passwordSchema', () => {
  it.each(['abcdefg1', 'Admin@1234', 'a1b2c3d4', 'longer password 123'])('accepts %s', (pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(true);
  });

  it.each([
    ['too short', 'abc12'],
    ['7 chars', 'abcde12'],
    ['no number', 'abcdefgh'],
    ['no letter', '12345678'],
    ['empty', ''],
  ])('rejects %s', (_label, pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it('explains what is missing', () => {
    const result = passwordSchema.safeParse('abcdefgh');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/number/);
  });
});

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  John.Doe@Intellicar.IN ')).toBe('john.doe@intellicar.in');
  });

  it('rejects invalid emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

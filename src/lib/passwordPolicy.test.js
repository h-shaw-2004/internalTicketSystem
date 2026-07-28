import { describe, expect, it } from 'vitest';
import { MIN_LENGTH, checkPassword, generatePassword } from './passwordPolicy';

describe('checkPassword', () => {
  it('accepts a password meeting every rule', () => {
    const { valid, results } = checkPassword('Str0ng!Passw0rd');
    expect(valid).toBe(true);
    expect(results.every((r) => r.met)).toBe(true);
  });

  it('counts 10 as long enough — the bound is inclusive', () => {
    // Nine characters, every other rule satisfied.
    expect(checkPassword('Ab3!efghi').valid).toBe(false);
    expect(checkPassword('Ab3!efghij').valid).toBe(true);
    expect(MIN_LENGTH).toBe(10);
  });

  it('names the specific rule that failed', () => {
    const failing = (password, id) =>
      expect(checkPassword(password).results.find((r) => r.id === id).met).toBe(false);

    failing('ab3!efghi', 'uppercase');
    failing('Abc!efghi', 'number');
    failing('Abc3efghi', 'special');
    failing('Ab3!efgh', 'length');
  });

  it('treats missing input as failing rather than throwing', () => {
    expect(checkPassword(undefined).valid).toBe(false);
    expect(checkPassword(null).valid).toBe(false);
    expect(checkPassword('').valid).toBe(false);
  });
});

describe('generatePassword', () => {
  it('always satisfies the policy it has to satisfy', () => {
    // Generated, so worth running enough times to catch a set being missed.
    for (let i = 0; i < 200; i += 1) {
      expect(checkPassword(generatePassword()).valid).toBe(true);
    }
  });

  it('honours the requested length', () => {
    expect(generatePassword()).toHaveLength(16);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it('refuses a length that could not meet the policy', () => {
    expect(() => generatePassword(4)).toThrow();
  });

  it('omits glyphs that are misread when typed by hand', () => {
    const passwords = Array.from({ length: 100 }, () => generatePassword(24)).join('');
    for (const ambiguous of ['0', 'O', '1', 'l', 'I']) {
      expect(passwords).not.toContain(ambiguous);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(seen.size).toBe(100);
  });
});

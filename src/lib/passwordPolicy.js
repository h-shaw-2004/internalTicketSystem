// Password complexity rules, and the generator for the temporary passwords
// handed out with new accounts.
//
// The rules live in one array so the checklist a user sees while typing and the
// check src/api/auth.js enforces can never drift apart — they are the same list.

// "10 characters or more", inclusive — 10 passes.
export const MIN_LENGTH = 10;

export const PASSWORD_RULES = [
  { id: 'length', label: '10 characters or more', test: (v) => v.length >= MIN_LENGTH },
  { id: 'uppercase', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'number', label: 'One number', test: (v) => /[0-9]/.test(v) },
  { id: 'special', label: 'One special character', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

/** Per-rule pass/fail for `value`, plus whether all of them hold. */
export function checkPassword(value) {
  const password = String(value ?? '');
  const results = PASSWORD_RULES.map(({ id, label, test }) => ({
    id,
    label,
    met: test(password),
  }));

  return { valid: results.every((r) => r.met), results };
}

// --------------------------------------------------------------------------
// Temporary password generation
//
// Ambiguous glyphs are left out of every set. These get read off a screen and
// typed by hand, and 0/O and 1/l/I are where that goes wrong.
// --------------------------------------------------------------------------

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*?-_=+';

const REQUIRED_SETS = [UPPERCASE, LOWERCASE, DIGITS, SPECIAL];
const ALL = REQUIRED_SETS.join('');

/**
 * Uniform random integer in [0, max).
 *
 * `% max` on its own skews towards low values whenever max does not divide
 * 2^32 evenly, so oversized draws are discarded rather than folded back in.
 */
function randomInt(max) {
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);

  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return value % max;
}

const pick = (set) => set[randomInt(set.length)];

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A random password that satisfies PASSWORD_RULES by construction: one
 * character from each required set, the remainder drawn from all of them, then
 * shuffled so the guaranteed characters aren't always in the same positions.
 */
export function generatePassword(length = 16) {
  if (length < REQUIRED_SETS.length || length < MIN_LENGTH) {
    throw new Error(`Password length must be at least ${Math.max(MIN_LENGTH, REQUIRED_SETS.length)}`);
  }

  const chars = REQUIRED_SETS.map(pick);
  while (chars.length < length) {
    chars.push(pick(ALL));
  }

  return shuffle(chars).join('');
}

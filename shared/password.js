// PBKDF2-SHA256 hashing over the Web Crypto API, so there is no dependency to
// swap out when this moves to the API server — Node exposes the same interface.
//
// Stored format: pbkdf2$sha256$<iterations>$<salt base64>$<hash base64>

const ITERATIONS = 210_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return false;
  }

  const [, , iterations, salt, expected] = parts;

  // Only base64 decoding is tolerated here — a malformed stored hash is a
  // legitimate "no match". Deriving happens outside the catch on purpose: a
  // missing Web Crypto implementation is a broken environment, not a wrong
  // password, and swallowing it turns every login into "incorrect password"
  // with nothing in the logs.
  let saltBytes;
  let expectedBytes;
  try {
    saltBytes = fromBase64(salt);
    expectedBytes = fromBase64(expected);
  } catch {
    return false;
  }

  const hash = await derive(password, saltBytes, Number(iterations));
  return timingSafeEqual(new Uint8Array(hash), expectedBytes);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

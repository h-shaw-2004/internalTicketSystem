import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';

// jsdom ships getRandomValues but not SubtleCrypto, which src/lib/password.js
// relies on. Browsers provide it, so this gap is the test environment's alone.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

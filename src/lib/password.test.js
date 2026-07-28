import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('salts each hash, so the same password hashes differently', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('rejects malformed or missing stored hashes instead of throwing', async () => {
    for (const stored of [undefined, null, '', 'plaintext', 'bcrypt$1$2$3$4']) {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    }
  });
});

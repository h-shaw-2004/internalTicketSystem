import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each case re-imports the module, since the config is read once at evaluation.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('supabase configuration', () => {
  it('reports missing config rather than throwing while importing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    // The whole point: importing must not throw. A throw here happens before
    // React mounts, so no error boundary can catch it and the user gets a blank
    // white page.
    const mod = await import('./supabase.js');

    expect(mod.configError).toMatch(/VITE_SUPABASE_URL/);
  });

  it('fails loudly if the unconfigured stub is actually used', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    const { supabase } = await import('./supabase.js');

    // Names the real problem instead of "cannot read properties of null".
    expect(() => supabase.from('users')).toThrow(/VITE_SUPABASE_URL/);
  });

  it('builds a real client when configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');

    const { configError, supabase } = await import('./supabase.js');

    expect(configError).toBeNull();
    expect(typeof supabase.from).toBe('function');
  });
});

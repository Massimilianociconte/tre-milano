import { describe, expect, it } from 'vitest';
import { loadSupabaseRuntimeConfig, numberEnv, requiredSecretEnv, requiredServerEnv, RuntimeConfigurationError, serverEnv } from '../../netlify/functions/_shared/env';

const reader = (values: Record<string, string>) => (name: string) => values[name];

describe('server environment boundary', () => {
  it('reads and trims process.env in the Node runtime used by Netlify Functions', () => {
    const variable = 'TRE_NETLIFY_NODE_RUNTIME_TEST';
    process.env[variable] = '  configured  ';
    try {
      expect(serverEnv(variable)).toBe('configured');
    } finally {
      delete process.env[variable];
    }
  });

  it('loads only an HTTPS Supabase URL and a non-trivial service key', () => {
    expect(loadSupabaseRuntimeConfig(reader({
      SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
    }))).toEqual({ url: 'https://project.supabase.co', apiKey: `sb_secret_${'x'.repeat(40)}` });
  });

  it('fails closed when a required secret is absent or an URL is unsafe', () => {
    expect(() => requiredServerEnv('SECRET', reader({}))).toThrow(RuntimeConfigurationError);
    expect(() => requiredSecretEnv('RATE_LIMIT_HASH_SECRET', 32, reader({ RATE_LIMIT_HASH_SECRET: 'too-short' }))).toThrow(RuntimeConfigurationError);
    expect(requiredSecretEnv('RATE_LIMIT_HASH_SECRET', 32, reader({ RATE_LIMIT_HASH_SECRET: 'r'.repeat(32) }))).toHaveLength(32);
    expect(() => loadSupabaseRuntimeConfig(reader({ SUPABASE_URL: 'http://remote.test', SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}` }))).toThrow(RuntimeConfigurationError);
  });

  it('supports the legacy service-role JWT only as a fallback', () => {
    expect(loadSupabaseRuntimeConfig(reader({
      SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt-key-that-is-long-enough-1234',
    })).apiKey).toContain('legacy-jwt');
  });

  it.each([
    'https://user:pass@project.supabase.co',
    'https://project.supabase.co/rest/v1',
    'https://project.supabase.co?redirect=evil',
    'https://project.supabase.co#fragment',
  ])('rejects a Supabase URL that is not a clean origin: %s', (url) => {
    expect(() => loadSupabaseRuntimeConfig(reader({
      SUPABASE_URL: url, SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
    }))).toThrow(RuntimeConfigurationError);
  });

  it('bounds numeric tuning values', () => {
    expect(numberEnv('LIMIT', 10, { min: 1, max: 20 }, reader({ LIMIT: '12' }))).toBe(12);
    expect(() => numberEnv('LIMIT', 10, { min: 1, max: 20 }, reader({ LIMIT: '100' }))).toThrow(RuntimeConfigurationError);
  });
});

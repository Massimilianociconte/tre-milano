import { describe, expect, it, vi } from 'vitest';
import { runCatalogMaintenance } from '../../netlify/functions/catalog-maintenance-scheduled';
import { RuntimeConfigurationError } from '../../netlify/functions/_shared/env';

describe('catalog maintenance schedule', () => {
  it('is a clean no-op in an unconfigured preview', async () => {
    await expect(runCatalogMaintenance({
      loadConfig: () => { throw new RuntimeConfigurationError('SUPABASE_SECRET_KEY'); },
      readEnv: (name) => name === 'PUBLIC_SITE_MODE' ? 'preview' : undefined,
      createClient: vi.fn() as never,
    })).resolves.toBeUndefined();
  });

  it('still fails closed in production without database secrets', async () => {
    await expect(runCatalogMaintenance({
      loadConfig: () => { throw new RuntimeConfigurationError('SUPABASE_SECRET_KEY'); },
      readEnv: (name) => name === 'PUBLIC_SITE_MODE' ? 'production' : undefined,
      createClient: vi.fn() as never,
    })).rejects.toBeInstanceOf(RuntimeConfigurationError);
  });
});

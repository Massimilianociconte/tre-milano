import type { Config } from '@netlify/functions';
import { loadSupabaseRuntimeConfig, RuntimeConfigurationError, serverEnv, type SupabaseRuntimeConfig } from './_shared/env';
import { createSupabaseAdminClient } from './_shared/supabase';

type MaintenanceDependencies = {
  loadConfig?: () => SupabaseRuntimeConfig;
  readEnv?: typeof serverEnv;
  createClient?: typeof createSupabaseAdminClient;
  fetchImpl?: typeof fetch;
};

export async function runCatalogMaintenance({
  loadConfig = loadSupabaseRuntimeConfig,
  readEnv = serverEnv,
  createClient = createSupabaseAdminClient,
  fetchImpl = fetch,
}: MaintenanceDependencies = {}) {
  try {
    const client = createClient({ config: loadConfig(), timeoutMs: 20_000 });
    const result = await client.rpc<Record<string, unknown>>('catalog_maintenance', {});
    console.info(JSON.stringify({ event: 'catalog.maintenance.succeeded', result }));
  } catch (error) {
    if (error instanceof RuntimeConfigurationError && readEnv('PUBLIC_SITE_MODE') !== 'production') {
      console.info(JSON.stringify({ event: 'catalog.maintenance.skipped_not_configured' }));
      return;
    }
    console.error(JSON.stringify({ event: 'catalog.maintenance.failed', error: error instanceof Error ? error.name : 'unknown' }));
    const webhook = readEnv('ALERT_WEBHOOK_URL');
    if (webhook && /^https:\/\//.test(webhook)) {
      await fetchImpl(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'catalog.maintenance.failed', at: new Date().toISOString() }), signal: AbortSignal.timeout(4_000),
      }).catch(() => undefined);
    }
    throw error;
  }
}

export default runCatalogMaintenance;

export const config: Config = { schedule: '17 3 * * *' };

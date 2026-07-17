import { assertWriteConfirmed, cliOption, createDataClient, loadDataEnv, parseBoundedInteger } from './data-lib.mjs';

/**
 * Promuove le osservazioni amministrative comunali in venue pubbliche
 * bronze/unverified "explore-only" tramite la RPC service-only
 * `promote_administrative_observations`.
 *
 * Sicurezza: dry-run per default; la scrittura richiede sia
 * `DATA_IMPORT_DRY_RUN=false` sia il flag esplicito `--confirm-write`.
 * La promozione non tocca record verificati e non abilita mai
 * `recommendation_eligible`.
 */
async function main() {
  const env = await loadDataEnv(cliOption('env'));
  const client = createDataClient(env);
  const max = parseBoundedInteger(cliOption('max') || '20000', '--max', 1, 50000);
  const sources = (cliOption('sources') || 'comune_milano_ds58,comune_milano_ds59,comune_milano_ds250')
    .split(',').map((value) => value.trim()).filter(Boolean);

  const wantsWrite = process.argv.includes('--confirm-write');
  if (wantsWrite) assertWriteConfirmed(env);

  const result = await client.rpc('promote_administrative_observations', {
    p_source_keys: sources,
    p_max: max,
    p_dry_run: !wantsWrite,
  });
  console.info(JSON.stringify({ sources, max, ...result }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

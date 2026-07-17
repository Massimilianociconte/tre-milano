import { assertWriteConfirmed, cliOption, createDataClient, loadDataEnv } from './data-lib.mjs';

/**
 * Revisione umana di una scheda explore-only.
 *
 *   node scripts/data-review-venue.mjs --env=.env.pipeline \
 *     --slug=bar-esempio-a1b2c3 --action=verify-silver \
 *     --reviewer="nome-revisore" [--name="Bar Esempio"] \
 *     [--category=caffe] [--neighborhood=brera] [--reason="sito ufficiale"] \
 *     --confirm-write
 *
 * Azioni: verify-silver (bronze -> silver verificata, con correzioni
 * opzionali) oppure unpublish. Ogni azione è tracciata in
 * venue_update_history con il revisore dichiarato. La promozione Gold resta
 * nel workflow editoriale ufficiale.
 */
async function main() {
  const env = await loadDataEnv(cliOption('env'));
  assertWriteConfirmed(env);
  const slug = cliOption('slug');
  const action = cliOption('action');
  const reviewer = cliOption('reviewer');
  if (!slug || !action || !reviewer) {
    throw new Error('Parametri obbligatori: --slug, --action=verify-silver|unpublish, --reviewer.');
  }
  const client = createDataClient(env);
  const result = await client.rpc('review_explore_venue', {
    p_slug: slug,
    p_action: action,
    p_reviewer: reviewer,
    p_display_name: cliOption('name') ?? null,
    p_category_slug: cliOption('category') ?? null,
    p_neighborhood_slug: cliOption('neighborhood') ?? null,
    p_reason: cliOption('reason') ?? null,
  });
  console.info(JSON.stringify(result));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

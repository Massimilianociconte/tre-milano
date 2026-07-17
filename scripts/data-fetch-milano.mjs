import { writeFile } from 'node:fs/promises';
import { assertWriteConfirmed, chunk, cliOption, createDataClient, loadDataEnv, parseBoundedInteger, readBoundedResponseText } from './data-lib.mjs';

export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_SOURCE_FEATURES = 50_000;

export const MILANO_OPEN_DATA_SOURCES = {
  comune_milano_ds58: {
    dataset: 'DS58', observedThrough: '2023-12-31',
    url: 'https://dati.comune.milano.it/dataset/f0671ce0-8c11-4ee8-95e5-c09913d00f83/resource/1623c617-028c-4f8a-9919-7f314701f50a/download/geocoded_batch_pe-dic-23_final_.geojson',
  },
  comune_milano_ds59: {
    dataset: 'DS59', observedThrough: '2023-12-31',
    url: 'https://dati.comune.milano.it/dataset/726fb09b-e2ce-4407-8579-51aef8027498/resource/b9186446-ae6d-4b22-bf7c-16dea78fe324/download/geocoded_batch_fp-dic-23_final_.geojson',
  },
  comune_milano_ds250: {
    dataset: 'DS250', observedThrough: '2023-12-31',
    url: 'https://dati.comune.milano.it/dataset/f0daf38a-1733-4cb1-9877-663519ced7c4/resource/aa6b66f7-480e-4812-bdd5-23ce2451c865/download/geocoded_batch_ae-dic-23_final.geojson',
  },
};

export function normalizeMilanoFeature(feature, source) {
  const properties = feature?.properties || {};
  const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : [];
  const longitude = Number(properties.LONG_X_4326 ?? coordinates[0]);
  const latitude = Number(properties.LAT_Y_4326 ?? coordinates[1]);
  const externalId = String(properties.Codice || '').trim();
  if (!externalId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const municipality = Number.parseInt(String(properties.MUNICIPIO || ''), 10);
  const postalCode = String(properties.CAP || '').replace(/\.0$/, '');
  return {
    externalId,
    payload: {
      observationKind: 'administrative_activity',
      label: properties.insegna || properties.denominazione_pe || properties.des_merceologica_p || properties.codice_ateco || null,
      observedThrough: source.observedThrough,
      dataset: source.dataset,
      administrativeCode: externalId,
      activityArea: properties['Area di Competenza'] || null,
      activityType: properties.denominazione_pe || properties.fuori_piano || properties.codice_ateco || properties.des_merceologica_p || null,
      address: {
        streetName: properties.DescrizioneVia || null,
        streetNumber: properties.Civico || null,
        postalCode: /^20\d{3}$/.test(postalCode) ? postalCode : null,
        formatted: properties.address_found || properties.Ubicazione || null,
        normalized: properties.address_found || properties.Ubicazione || null,
        municipality: Number.isInteger(municipality) && municipality >= 1 && municipality <= 9 ? municipality : null,
        neighborhood: properties.NIL || null,
        neighborhoodId: properties.ID_NIL ? String(properties.ID_NIL).replace(/\.0$/, '') : null,
        latitude,
        longitude,
      },
      disclosure: 'Anagrafica amministrativa con dati al 31/12/2023; non conferma nome commerciale, apertura attuale o idoneità editoriale.',
    },
  };
}

export async function fetchMilanoCollection(source, fetchImpl = fetch, options = {}) {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 750;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(source.url, {
        redirect: 'error',
        headers: { 'User-Agent': 'TRE-Milano-Data-Pipeline/1.0 (+https://tre-milano-preview-160726.netlify.app/fonti/)' }, signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) throw new Error(`HTTP_${response.status}_FINAL`);
        throw new Error(`HTTP_${response.status}`);
      }
      if (response.url && new URL(response.url).href !== new URL(source.url).href) throw new Error('DESTINATION_MISMATCH_FINAL');
      const body = await readBoundedResponseText(response, MAX_SOURCE_BYTES, `Download ${source.dataset}`);
      let collection;
      try { collection = JSON.parse(body); } catch { throw new Error('GEOJSON_INVALID_FINAL'); }
      if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('GEOJSON_INVALID_FINAL');
      if (collection.features.length > MAX_SOURCE_FEATURES) throw new Error('FEATURE_LIMIT_FINAL');
      return collection;
    } catch (error) {
      lastError = error;
      if (String(error?.message || '').endsWith('_FINAL')) throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, attempt * retryBaseDelayMs));
  }
  throw new Error(`Download ${source.dataset} non riuscito: ${lastError?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'}`);
}

async function main() {
  const sourceKey = cliOption('source');
  const source = sourceKey ? MILANO_OPEN_DATA_SOURCES[sourceKey] : null;
  if (!sourceKey || !source) throw new Error(`Usa --source=${Object.keys(MILANO_OPEN_DATA_SOURCES).join('|')}`);
  const collection = await fetchMilanoCollection(source);
  const records = collection.features.map((feature) => normalizeMilanoFeature(feature, source)).filter(Boolean);
  const output = cliOption('output');
  if (output) await writeFile(output, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.info(JSON.stringify({ source: sourceKey, downloaded: collection.features.length, valid: records.length, applied: false, output: output || null }));
    return;
  }
  const env = await loadDataEnv(cliOption('env'));
  assertWriteConfirmed(env);
  const batchSize = parseBoundedInteger(env.DATA_IMPORT_BATCH_SIZE || '250', 'DATA_IMPORT_BATCH_SIZE', 1, 500);
  const client = createDataClient(env);
  const runId = await client.rpc('begin_import_run', { p_source_key: sourceKey, p_trigger_kind: 'manual', p_requested_by: 'scripts/data-fetch-milano.mjs' });
  let processed = 0;
  let failed = 0;
  try {
    for (const batch of chunk(records, batchSize)) {
      const result = await client.rpc('ingest_source_observations_batch', { p_source_key: sourceKey, p_records: batch, p_import_run_id: runId });
      processed += Number(result.processed || 0);
      failed += Number(result.failed || 0);
    }
    await client.rpc('finish_import_run', {
      p_import_run_id: runId, p_status: failed ? 'partial' : 'succeeded', p_error_summary: failed ? `${failed} record non validi` : null,
      p_metrics: { downloaded: collection.features.length, valid: records.length, processed, failed, dataset: source.dataset },
    });
  } catch (error) {
    await client.rpc('finish_import_run', { p_import_run_id: runId, p_status: 'failed', p_error_summary: error.message, p_metrics: { processed, failed } }).catch(() => undefined);
    throw error;
  }
  console.info(JSON.stringify({ source: sourceKey, runId, downloaded: collection.features.length, processed, failed, applied: true }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

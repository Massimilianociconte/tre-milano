import { readFile, stat } from 'node:fs/promises';
import { assertWriteConfirmed, cliOption, createDataClient, loadDataEnv } from './data-lib.mjs';

export const IMPORT_LIMITS = Object.freeze({
  fileBytes: 64 * 1024 * 1024,
  records: 50_000,
  lineBytes: 256 * 1024,
  payloadBytes: 256 * 1024,
  contacts: 50,
  services: 100,
});

export async function parseImportFile(file) {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size > IMPORT_LIMITS.fileBytes) throw new Error('File import non valido o oltre il limite consentito.');
  const content = await readFile(file, 'utf8');
  const records = [];
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    if (Buffer.byteLength(rawLine, 'utf8') > IMPORT_LIMITS.lineBytes) throw new Error(`Riga ${index + 1} oltre il limite consentito.`);
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`JSON non valido alla riga ${index + 1}.`); }
    if (!record || Array.isArray(record) || typeof record !== 'object' || typeof record.externalId !== 'string' || !record.externalId.trim() || record.externalId.length > 256) {
      throw new Error(`Record non valido alla riga ${index + 1}.`);
    }
    if (!record.payload || Array.isArray(record.payload) || typeof record.payload !== 'object') throw new Error(`Payload non valido alla riga ${index + 1}.`);
    if (Buffer.byteLength(JSON.stringify(record.payload), 'utf8') > IMPORT_LIMITS.payloadBytes) throw new Error(`Payload oltre il limite alla riga ${index + 1}.`);
    if (Array.isArray(record.payload.contacts) && record.payload.contacts.length > IMPORT_LIMITS.contacts) throw new Error(`Troppi contatti alla riga ${index + 1}.`);
    if (Array.isArray(record.payload.services) && record.payload.services.length > IMPORT_LIMITS.services) throw new Error(`Troppi servizi alla riga ${index + 1}.`);
    records.push(record);
    if (records.length > IMPORT_LIMITS.records) throw new Error('Numero record oltre il limite consentito.');
  }
  return records;
}

async function main() {
  const sourceKey = cliOption('source');
  const file = cliOption('file');
  if (!sourceKey || !file) throw new Error('Uso: pnpm data:import -- --source=<source_key> --file=<records.ndjson>');
  const env = await loadDataEnv(cliOption('env'));
  assertWriteConfirmed(env);
  const records = await parseImportFile(file);
  const client = createDataClient(env);
  const runId = await client.rpc('begin_import_run', { p_source_key: sourceKey, p_trigger_kind: 'manual', p_requested_by: 'scripts/data-import.mjs' });
  let processed = 0;
  let failed = 0;
  try {
    for (const record of records) {
      if (!record || typeof record.externalId !== 'string' || typeof record.payload !== 'object') { failed += 1; continue; }
      try {
        const result = await client.rpc('ingest_venue_record', {
          p_source_key: sourceKey, p_external_id: record.externalId, p_payload: record.payload, p_import_run_id: runId,
        });
        if (result?.status === 'error') failed += 1;
        else processed += 1;
      } catch { failed += 1; }
    }
    await client.rpc('finish_import_run', {
      p_import_run_id: runId, p_status: failed ? 'partial' : 'succeeded', p_error_summary: failed ? `${failed} record non importati` : null,
      p_metrics: { received: records.length, processed, failed },
    });
  } catch (error) {
    await client.rpc('finish_import_run', { p_import_run_id: runId, p_status: 'failed', p_error_summary: error.message, p_metrics: { processed, failed } }).catch(() => undefined);
    throw error;
  }
  console.info(JSON.stringify({ runId, received: records.length, processed, failed }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

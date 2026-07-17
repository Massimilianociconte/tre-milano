import { cliOption, createDataClient, loadDataEnv, assertWriteConfirmed } from './data-lib.mjs';
import { parseImportFile } from './data-import.mjs';

const DEFAULT_SOURCE = 'official_venue_facts';

export async function withBoundedRetry(operation, options = {}) {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

async function main() {
  const file = cliOption('file') || 'data/official-venue-facts.ndjson';
  const sourceKey = cliOption('source') || DEFAULT_SOURCE;
  const reviewer = cliOption('reviewer');
  if (!reviewer || reviewer.trim().length < 3) {
    throw new Error('Uso: pnpm data:bootstrap:official -- --reviewer=<identificativo> [--file=<records.ndjson>]');
  }

  const env = await loadDataEnv(cliOption('env'));
  assertWriteConfirmed(env);
  const records = await parseImportFile(file);
  const client = createDataClient(env);
  const runId = await client.rpc('begin_import_run', {
    p_source_key: sourceKey,
    p_trigger_kind: 'manual',
    p_requested_by: reviewer.trim(),
  });

  let processed = 0;
  let failed = 0;
  try {
    for (const record of records) {
      try {
        const ingestion = await withBoundedRetry(() => client.rpc('ingest_venue_record', {
          p_source_key: sourceKey,
          p_external_id: record.externalId,
          p_payload: record.payload,
          p_import_run_id: runId,
        }));
        if (ingestion?.status === 'error') throw new Error(`Import rifiutato: ${ingestion.code || 'UNKNOWN'}`);

        const review = await withBoundedRetry(() => client.rpc('review_official_venue_record', {
          p_source_key: sourceKey,
          p_external_id: record.externalId,
          p_reviewer: reviewer.trim(),
        }));
        if (review?.status !== 'published') throw new Error('Revisione editoriale non completata.');
        processed += 1;
      } catch {
        failed += 1;
      }
    }

    await client.rpc('finish_import_run', {
      p_import_run_id: runId,
      p_status: failed ? 'partial' : 'succeeded',
      p_error_summary: failed ? `${failed} record non pubblicati` : null,
      p_metrics: {
        received: records.length,
        reviewedAndPublished: processed,
        failed,
        source: sourceKey,
      },
    });
  } catch (error) {
    await client.rpc('finish_import_run', {
      p_import_run_id: runId,
      p_status: 'failed',
      p_error_summary: error instanceof Error ? error.message : 'Errore inatteso',
      p_metrics: { processed, failed },
    }).catch(() => undefined);
    throw error;
  }

  console.info(JSON.stringify({ runId, received: records.length, processed, failed }));
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Bootstrap non riuscito.');
    process.exitCode = 1;
  });
}

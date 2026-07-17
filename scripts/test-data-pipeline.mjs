import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertWriteConfirmed, chunk, createDataClient, loadDataEnv, normalizeDataServiceUrl, parseBoundedInteger, readBoundedResponseText } from './data-lib.mjs';
import { fetchMilanoCollection, MAX_SOURCE_BYTES, normalizeMilanoFeature } from './data-fetch-milano.mjs';
import { IMPORT_LIMITS, parseImportFile } from './data-import.mjs';
import { withBoundedRetry } from './data-bootstrap-official.mjs';

test('le scritture richiedono insieme env=false e flag esplicito', () => {
  assert.throws(() => assertWriteConfirmed({ DATA_IMPORT_DRY_RUN: 'true' }, ['node', '--confirm-write']));
  assert.throws(() => assertWriteConfirmed({ DATA_IMPORT_DRY_RUN: 'false' }, ['node']));
  assert.throws(() => assertWriteConfirmed({}, ['node', '--confirm-write']));
  assert.doesNotThrow(() => assertWriteConfirmed({ DATA_IMPORT_DRY_RUN: 'false' }, ['node', '--confirm-write']));
});

test('la pipeline preferisce il file dedicato e mantiene il fallback .env', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tre-data-env-'));
  try {
    const pipeline = join(directory, '.env.pipeline');
    const legacy = join(directory, '.env');
    await writeFile(pipeline, 'TRE_PIPELINE_TEST=dedicated\n');
    await writeFile(legacy, 'TRE_PIPELINE_TEST=legacy\n');
    assert.equal((await loadDataEnv(undefined, [pipeline, legacy])).TRE_PIPELINE_TEST, 'dedicated');
    await rm(pipeline);
    assert.equal((await loadDataEnv(undefined, [pipeline, legacy])).TRE_PIPELINE_TEST, 'legacy');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('batch size rifiuta zero, NaN e valori oltre il limite DB', () => {
  for (const value of ['0', 'NaN', '501', '1.5']) assert.throws(() => parseBoundedInteger(value, 'BATCH', 1, 500));
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});

test('l’adapter comunale produce una osservazione e non una venue pubblicabile', () => {
  const result = normalizeMilanoFeature({
    properties: { Codice: 'PE/1', address_found: 'Via Test 1', MUNICIPIO: '1.0', NIL: 'DUOMO', LONG_X_4326: 9.19, LAT_Y_4326: 45.46 },
    geometry: { type: 'Point', coordinates: [9.19, 45.46] },
  }, { dataset: 'DS58', observedThrough: '2023-12-31' });
  assert.equal(result.payload.observationKind, 'administrative_activity');
  assert.match(result.payload.disclosure, /non conferma/i);
  assert.equal('officialName' in result.payload, false);
});

test('il client dati accetta solo HTTPS o host locali esatti', () => {
  assert.equal(normalizeDataServiceUrl('https://example.supabase.co/'), 'https://example.supabase.co');
  assert.equal(normalizeDataServiceUrl('http://localhost:54321'), 'http://localhost:54321');
  assert.throws(() => normalizeDataServiceUrl('http://localhost.evil.invalid'));
  assert.throws(() => normalizeDataServiceUrl('http://127.0.0.1.evil.invalid'));
  assert.throws(() => normalizeDataServiceUrl('https://user:pass@example.supabase.co'));
  assert.throws(() => normalizeDataServiceUrl('https://example.supabase.co/rest/v1'));
});

test('il nome RPC non può modificare il path', async () => {
  const client = createDataClient({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'x'.repeat(40) }, async () => {
    throw new Error('fetch non deve essere raggiunta');
  });
  await assert.rejects(() => client.rpc('../secrets', {}), /Nome RPC non valido/);
});

test('le risposte remote sono lette con un limite byte effettivo', async () => {
  const small = new Response('ok');
  assert.equal(await readBoundedResponseText(small, 2), 'ok');
  await assert.rejects(() => readBoundedResponseText(new Response('troppo'), 2), /oltre il limite/);
});

test('il fetch comunale vieta redirect e collezioni oltre soglia', async () => {
  let requestOptions;
  const collection = await fetchMilanoCollection(
    { dataset: 'TEST', url: 'https://data.example/source.geojson' },
    async (_url, options) => {
      requestOptions = options;
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
    },
    { retries: 1, timeoutMs: 1_000, retryBaseDelayMs: 0 },
  );
  assert.equal(requestOptions.redirect, 'error');
  assert.equal(collection.features.length, 0);
  const oversizedHeader = new Response('{}', { headers: { 'Content-Length': String(MAX_SOURCE_BYTES + 1) } });
  await assert.rejects(
    () => fetchMilanoCollection({ dataset: 'TEST', url: 'https://data.example/source.geojson' }, async () => oversizedHeader, { retries: 1, timeoutMs: 1_000, retryBaseDelayMs: 0 }),
    /NETWORK/,
  );
});

test('l’import NDJSON rifiuta record e payload oltre i limiti', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tre-data-import-'));
  try {
    const validPath = join(directory, 'valid.ndjson');
    await writeFile(validPath, `${JSON.stringify({ externalId: 'venue-1', payload: { name: 'Test' } })}\n`);
    assert.equal((await parseImportFile(validPath)).length, 1);
    const invalidPath = join(directory, 'invalid.ndjson');
    await writeFile(invalidPath, `${JSON.stringify({ externalId: 'venue-2', payload: { contacts: Array.from({ length: IMPORT_LIMITS.contacts + 1 }, () => ({})) } })}\n`);
    await assert.rejects(() => parseImportFile(invalidPath), /Troppi contatti/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('il bootstrap ufficiale usa retry limitati e idempotenti', async () => {
  let attempts = 0;
  const result = await withBoundedRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporaneo');
    return 'ok';
  }, { attempts: 3, baseDelayMs: 0 });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);

  await assert.rejects(
    () => withBoundedRetry(async () => { throw new Error('permanente'); }, { attempts: 2, baseDelayMs: 0 }),
    /permanente/,
  );
});

test('il bootstrap editoriale contiene solo record ufficiali completi e senza media di terzi', async () => {
  const content = await readFile('data/official-venue-facts.ndjson', 'utf8');
  const records = content.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.ok(records.length >= 3);
  for (const record of records) {
    assert.match(record.payload.sourceUrl, /^https:\/\//);
    assert.match(record.payload.canonicalSlug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(record.payload.address.geocodingAttribution, '© OpenStreetMap contributors');
    assert.ok(record.payload.weeklyHours.length >= 7);
    assert.ok(record.payload.contacts.some((contact) => contact.kind === 'website'));
    assert.equal('images' in record.payload, false);
    assert.equal('ratings' in record.payload, false);
  }
});

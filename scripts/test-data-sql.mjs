import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadModule, parseSync } from 'pgsql-parser';
import { auditMigrationSql, loadMigrations } from './data-audit-sql.mjs';

test('le migrazioni reali non contengono versioni o colonne duplicate', async () => {
  assert.deepEqual(auditMigrationSql(await loadMigrations()), []);
});

test('l’audit intercetta versioni, colonne e filtri duplicati', () => {
  const failures = auditMigrationSql([
    { path: '1_a.sql', sql: 'create table public.x (id uuid, id text);' },
    { path: '1_b.sql', sql: 'select 1;\nwhere ve.venue_id = v.id and ve.exception_date > now()\nwhere ve.venue_id = v.id and ve.exception_date > now()' },
  ]);
  assert.ok(failures.some((failure) => failure.includes('Versione migrazione duplicata')));
  assert.ok(failures.some((failure) => failure.includes('colonna duplicata')));
  assert.ok(failures.some((failure) => failure.includes('WHERE duplicata')));
});

test('PostgreSQL 17 parser accetta tutte le migrazioni e il seed', async () => {
  await loadModule();
  for (const migration of await loadMigrations()) assert.doesNotThrow(() => parseSync(migration.sql), migration.path);
  const seed = await readFile('supabase/seed.sql', 'utf8');
  assert.doesNotThrow(() => parseSync(seed), 'supabase/seed.sql');
});

test('la migrazione Explore mantiene guardie conservative, facet coerenti e orari verificati set-based', async () => {
  const sql = (await readFile(
    'supabase/migrations/20260718140840_catalog_explore_facets_hours_quality.sql',
    'utf8',
  )).toLocaleLowerCase('en-US');

  assert.match(sql, /new\.maturity = 'bronze'/);
  assert.match(sql, /new\.verification_status = 'unverified'/);
  assert.match(sql, /private\.is_clear_administrative_label\(new\.display_name\)/);
  assert.match(sql, /p_include_unverified boolean default false/);
  assert.match(sql, /p_open_now boolean default false/);
  assert.match(sql, /'subcategories', coalesce/);
  assert.match(sql, /'services', coalesce/);
  assert.match(sql, /p_subcategory_slugs text\[\] default null/);
  assert.match(sql, /sc\.slug = any\(p_subcategory_slugs\)/);
  assert.match(sql, /vh\.verified_at is not null/);
  assert.match(sql, /hours_source\.source_url as hours_source_url/);
  assert.match(sql, /opening\.is_open_now as open_now/);
  assert.match(sql, /open_now boolean,\s+verification_status public\.verification_status/);
  assert.match(sql, /now\(\) at time zone 'europe\/rome'/);
  assert.match(sql, /from public\.venue_hour_exceptions ve/);
  assert.match(sql, /and ve\.verified_at is not null/);
  assert.match(sql, /and not exists \(\s+select 1\s+from public\.venue_hour_exceptions ve\s+where ve\.venue_id = v\.id\s+and ve\.exception_date = clock\.local_date/);
  assert.match(sql, /from previous_windows w[\s\S]+and w\.closes_next_day[\s\S]+and clock\.local_time < w\.closes_at/);
  assert.match(sql, /private\.catalog_venue_source_attribution\(v\.id\)/);
  assert.match(sql, /observation\.linked_venue_id = p_venue_id/);
  assert.match(sql, /observation\.observed_through::timestamp/);
  assert.match(sql, /p_sort not in \('relevance', 'distance', 'price', 'rating', 'quality', 'name', 'newest'\)/);
  assert.match(sql, /scored\.sort_text > p_after_text collate "c"/);
  assert.match(sql, /extract\(epoch from base\.published_at\)/);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /revoke all on function public\.catalog_facets/);
  assert.match(sql, /grant execute on function public\.catalog_facets/);

  const attributionStart = sql.indexOf('create or replace function private.catalog_venue_source_attribution');
  const attributionEnd = sql.indexOf('revoke all on function private.catalog_venue_source_attribution');
  const attribution = sql.slice(attributionStart, attributionEnd);
  assert.ok(attributionStart >= 0 && attributionEnd > attributionStart);
  assert.doesNotMatch(attribution, /normalized_payload|external_id|payload_checksum/);
  assert.ok(
    sql.lastIndexOf('update public.venues')
      > sql.lastIndexOf('comment on function public.search_venues'),
    'table-locking operations must stay at the end of the migration',
  );
});

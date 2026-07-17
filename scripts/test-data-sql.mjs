import assert from 'node:assert/strict';
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
  const { readFile } = await import('node:fs/promises');
  const seed = await readFile('supabase/seed.sql', 'utf8');
  assert.doesNotThrow(() => parseSync(seed), 'supabase/seed.sql');
});

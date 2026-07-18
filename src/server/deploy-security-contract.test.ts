import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

describe('production deployment security contract', () => {
  it('does not publish test files as top-level Netlify Functions', () => {
    const functionEntries = readdirSync(path.join(projectRoot, 'netlify/functions'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    expect(functionEntries.filter((name) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name))).toEqual([]);
  });

  it('keeps every catalog table inside the fail-closed RLS block', () => {
    const migrationDirectory = path.join(projectRoot, 'supabase/migrations');
    const migrations = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFileSync(path.join(migrationDirectory, name), 'utf8'));
    const allSql = migrations.join('\n');
    const createdTables = [...allSql.matchAll(/create\s+table\s+public\.([a-z_]+)/gi)]
      .map((match) => match[1])
      .sort();
    const securityMigration = read('supabase/migrations/20260716215042_catalog_api_security.sql');
    const rlsBlock = securityMigration.match(/Data API is explicitly service-only[\s\S]*?array\[([\s\S]*?)\]\s*loop/i)?.[1] ?? '';
    const protectedTables = [...rlsBlock.matchAll(/'([a-z_]+)'/g)]
      .map((match) => match[1])
      .sort();

    expect(protectedTables).toEqual(createdTables);
    expect(securityMigration).toContain("revoke all on table public.%I from public, anon, authenticated");
    expect(securityMigration).toContain("alter table public.%I force row level security");
  });

  it('keeps modern Supabase credentials server-only and legacy keys out of the tracked template', () => {
    // `.env.production` non è più un template tracciato: il contratto vive su
    // `.env.example`. Il file locale, quando presente sulla macchina di chi
    // sviluppa, resta comunque vincolato dal test successivo.
    const source = read('.env.example');
    expect(source).toMatch(/^SUPABASE_SECRET_KEY=/m);
    expect(source).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=/m);
    expect(source).not.toMatch(/^PUBLIC_SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY=/m);
    expect(source).not.toMatch(/^PUBLIC_DEEPSEEK_API_KEY=/m);
    expect(source).not.toMatch(/^PUBLIC_TURNSTILE_SECRET_KEY=/m);
  });

  it('keeps .env.production untracked and, when present locally, free of client-exposed secrets', () => {
    // Il gitignore deve coprire `.env.*` senza mai reintrodurre la negazione
    // `!.env.production`: è l'invariante che tiene le credenziali di deploy
    // fuori dalla history pubblica.
    const gitignore = read('.gitignore');
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).not.toMatch(/^!\.env\.production$/m);

    if (!existsSync(path.join(projectRoot, '.env.production'))) return;
    const source = read('.env.production');
    expect(source).not.toMatch(/^PUBLIC_SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY=/m);
    expect(source).not.toMatch(/^PUBLIC_DEEPSEEK_API_KEY=/m);
    expect(source).not.toMatch(/^PUBLIC_TURNSTILE_SECRET_KEY=/m);
    expect(source).not.toMatch(/^SUPABASE_SERVICE_ROLE_KEY=/m);
  });

  it('anchors the Netlify Image CDN allowlist to the approved Supabase bucket', () => {
    const source = read('netlify.toml');
    const serializedPattern = source.match(/remote_images\s*=\s*\["([^"]+)"\]/)?.[1];
    expect(serializedPattern).toBeTruthy();
    const pattern = new RegExp(JSON.parse(`"${serializedPattern}"`));

    expect(pattern.test('https://glalvaiuhrohrvauuwcp.supabase.co/storage/v1/object/public/venue-media/notturno.webp')).toBe(true);
    expect(pattern.test('https://attacker.example/image.webp?next=https://glalvaiuhrohrvauuwcp.supabase.co/storage/v1/object/public/venue-media/notturno.webp')).toBe(false);
    expect(pattern.test('https://glalvaiuhrohrvauuwcp.supabase.co/storage/v1/object/public/other-bucket/notturno.webp')).toBe(false);
    expect(pattern.test('https://glalvaiuhrohrvauuwcp.supabase.co/storage/v1/object/public/venue-media/notturno.webp?redirect=https://attacker.example')).toBe(false);
  });
});

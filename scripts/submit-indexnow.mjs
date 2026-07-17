import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublicEnv } from './load-public-env.mjs';
import { venues } from '../src/data/venues.ts';
import { assertProductionCatalog } from '../src/domain/catalog-validation.ts';
import { assertProductionCollections, CURATED_COLLECTIONS } from '../src/config/collections.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadPublicEnv(projectRoot, 'production');
const send = process.argv.includes('--send');
const requestedPaths = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const site = new URL(env.PUBLIC_SITE_URL || 'https://tre-milano.example');
const key = env.INDEXNOW_KEY || '';

if (send && (env.PUBLIC_SITE_MODE !== 'production' || env.PUBLIC_DATA_MODE !== 'gold')) {
  throw new Error('IndexNow bloccato: --send richiede PUBLIC_SITE_MODE=production e PUBLIC_DATA_MODE=gold.');
}
if (send) {
  assertProductionCatalog(venues);
  assertProductionCollections(CURATED_COLLECTIONS, venues);
}

if (!requestedPaths.length) {
  console.error('Uso: pnpm indexnow -- /percorso-aggiornato/ [/altro/] [--send]');
  process.exit(1);
}
const siteHostname = site.hostname.toLowerCase();
if (
  site.protocol !== 'https:'
  || siteHostname.endsWith('.example')
  || siteHostname.endsWith('.test')
  || siteHostname.endsWith('.invalid')
  || siteHostname.endsWith('.local')
  || ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org', 'example.net'].includes(siteHostname)
) {
  throw new Error('IndexNow bloccato: configurare un PUBLIC_SITE_URL HTTPS reale.');
}
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  throw new Error('IndexNow bloccato: INDEXNOW_KEY deve contenere 8-128 caratteri alfanumerici o trattini.');
}

const manifest = JSON.parse(await readFile(path.join(projectRoot, 'src/config/indexable-routes.json'), 'utf8'));
const readyPaths = new Set(manifest.filter((route) => route.status === 'ready').map((route) => route.path));
const urlList = requestedPaths.map((requestedPath) => {
  const url = new URL(requestedPath, site);
  if (url.host !== site.host) throw new Error(`URL fuori host: ${url}`);
  if (url.search || url.hash) throw new Error(`IndexNow accetta soltanto URL canonici senza query o frammenti: ${url}`);
  if (!readyPaths.has(url.pathname)) throw new Error(`URL non ready nel manifest: ${url.pathname}`);
  return url.toString();
});

const payload = {
  host: site.host,
  key,
  keyLocation: new URL(`/${key}.txt`, site).toString(),
  urlList,
};

if (!send) {
  console.log(`Dry run IndexNow: ${urlList.length} URL materiali, nessun invio.\n${JSON.stringify(payload, null, 2)}`);
  process.exit(0);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});
if (!response.ok) throw new Error(`IndexNow ha risposto ${response.status}.`);
console.log(`IndexNow: inviate ${urlList.length} URL con stato ${response.status}.`);

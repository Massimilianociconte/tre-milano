import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublicEnv } from './load-public-env.mjs';
import { venues } from '../src/data/venues.ts';
import { assertProductionCatalog } from '../src/domain/catalog-validation.ts';
import { assertProductionCollections, CURATED_COLLECTIONS } from '../src/config/collections.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const env = loadPublicEnv(projectRoot, 'production');
const siteUrl = env.PUBLIC_SITE_URL || 'https://tre-milano.example';
const publicIndexing = env.PUBLIC_SITE_MODE === 'production' && env.PUBLIC_DATA_MODE === 'gold';
const sitemapRoot = path.join(distDir, 'sitemaps');
const sitemapIndexPath = path.join(distDir, 'sitemap-index.xml');

await rm(sitemapRoot, { recursive: true, force: true });
await rm(sitemapIndexPath, { force: true });

if (!publicIndexing) {
  console.log('Sitemap: omessa in modalità preview/fixture.');
  process.exit(0);
}

const parsedSite = new URL(siteUrl);
const parsedHostname = parsedSite.hostname.toLowerCase();
if (
  parsedSite.protocol !== 'https:'
  || parsedHostname.endsWith('.example')
  || parsedHostname.endsWith('.test')
  || parsedHostname.endsWith('.invalid')
  || parsedHostname.endsWith('.local')
  || ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org', 'example.net'].includes(parsedHostname)
) {
  throw new Error('Sitemap bloccata: PUBLIC_SITE_URL non è un host HTTPS pubblico.');
}
assertProductionCatalog(venues);
assertProductionCollections(CURATED_COLLECTIONS, venues);

const manifestPath = path.join(projectRoot, 'src/config/indexable-routes.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const readyRoutes = manifest.filter((route) => route.status === 'ready');

if (!readyRoutes.length) {
  throw new Error('Sitemap bloccata: il manifest non contiene URL con stato ready.');
}

for (const route of readyRoutes) {
  if (!/^\/.*\/$/.test(route.path) && route.path !== '/') throw new Error(`Path non canonico nel manifest: ${route.path}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(route.lastmod)) throw new Error(`lastmod non valido per ${route.path}`);
  const relativeHtml = route.path === '/' ? 'index.html' : path.join(route.path.replace(/^\/+/, ''), 'index.html');
  await access(path.join(distDir, relativeHtml));
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const grouped = new Map();
for (const route of readyRoutes) {
  const routes = grouped.get(route.segment) || [];
  routes.push(route);
  grouped.set(route.segment, routes);
}
await mkdir(sitemapRoot, { recursive: true });

const sitemapEntries = [];
for (const [segment, routes] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const body = routes
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((route) => [
      '  <url>',
      `    <loc>${escapeXml(new URL(route.path, parsedSite).toString())}</loc>`,
      `    <lastmod>${route.lastmod}</lastmod>`,
      `    <changefreq>${route.changefreq}</changefreq>`,
      `    <priority>${Number(route.priority).toFixed(1)}</priority>`,
      '  </url>',
    ].join('\n'))
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  const filename = `${segment}.xml`;
  await writeFile(path.join(sitemapRoot, filename), xml, 'utf8');
  sitemapEntries.push({ filename, lastmod: routes.map((route) => route.lastmod).sort().at(-1) });
}

const indexBody = sitemapEntries.map((entry) => [
  '  <sitemap>',
  `    <loc>${escapeXml(new URL(`/sitemaps/${entry.filename}`, parsedSite).toString())}</loc>`,
  `    <lastmod>${entry.lastmod}</lastmod>`,
  '  </sitemap>',
].join('\n')).join('\n');
const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexBody}\n</sitemapindex>\n`;
await writeFile(sitemapIndexPath, sitemapIndex, 'utf8');

if (env.INDEXNOW_KEY) {
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(env.INDEXNOW_KEY)) throw new Error('INDEXNOW_KEY non valida.');
  await writeFile(path.join(distDir, `${env.INDEXNOW_KEY}.txt`), env.INDEXNOW_KEY, 'utf8');
}

console.log(`Sitemap: ${readyRoutes.length} URL pronte in ${sitemapEntries.length} segmenti.`);

import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadPublicEnv } from './load-public-env.mjs';
import { hasAltAttribute } from './html-audit-lib.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const env = loadPublicEnv(projectRoot, 'production');
const publicIndexing = env.PUBLIC_SITE_MODE === 'production' && env.PUBLIC_DATA_MODE === 'gold';
const fixtureData = env.PUBLIC_DATA_MODE !== 'gold';
const siteUrl = env.PUBLIC_SITE_URL || 'https://tre-milano.example';
const manifestPath = path.join(projectRoot, 'src/config/indexable-routes.json');
const routeManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const htmlFiles = (await walk(distDir)).filter((file) => file.endsWith('.html'));
const failures = [];
const warnings = [];
let internalLinks = 0;
let previewServiceWorkerRegistrations = 0;
const manifestPaths = new Set();
const readyManifestRoutes = [];
const indexableHtmlRoutes = new Set();

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function diffSets(expected, actual) {
  return {
    missing: sorted(expected).filter((value) => !actual.has(value)),
    unexpected: sorted(actual).filter((value) => !expected.has(value)),
  };
}

function reportSetMismatch(label, expected, actual) {
  const { missing, unexpected } = diffSets(expected, actual);
  if (missing.length) failures.push(`${label}: mancanti ${missing.join(', ')}`);
  if (unexpected.length) failures.push(`${label}: inattesi ${unexpected.join(', ')}`);
}

function normalizeRoutePath(pathname) {
  if (pathname === '/') return pathname;
  return `${pathname.replace(/\/+$/, '')}/`;
}

function xmlText(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => xmlText(match[1]));
}

async function listXmlFiles(directory) {
  try {
    return (await walk(directory)).filter((file) => file.endsWith('.xml'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

for (const route of routeManifest) {
  if (!route || typeof route !== 'object') {
    failures.push('manifest indicizzazione: voce non valida');
    continue;
  }
  if (typeof route.path !== 'string' || (route.path !== '/' && !/^\/.*\/$/.test(route.path))) {
    failures.push(`manifest indicizzazione: path non canonico ${String(route.path)}`);
    continue;
  }
  if (manifestPaths.has(route.path)) failures.push(`manifest indicizzazione: path duplicato ${route.path}`);
  manifestPaths.add(route.path);
  if (!['draft', 'ready'].includes(route.status)) failures.push(`manifest indicizzazione: stato non valido per ${route.path}`);
  if (route.status === 'ready') readyManifestRoutes.push(route);
}

const readyManifestPaths = new Set(readyManifestRoutes.map((route) => route.path));

function routeFromFile(file) {
  const relative = path.relative(distDir, file).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
}

function targetFileFromHref(href) {
  const pathname = new URL(href, 'https://audit.invalid').pathname;
  if (pathname === '/') return path.join(distDir, 'index.html');
  const relative = pathname.replace(/^\/+/, '');
  return path.extname(relative) ? path.join(distDir, relative) : path.join(distDir, relative, 'index.html');
}

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const route = routeFromFile(file);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim();
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim();
  const robots = html.match(/<meta name="robots" content="([^"]*)"/)?.[1] || '';
  const robotsTokens = robots.toLowerCase().split(',').map((token) => token.trim()).filter(Boolean);
  const hasIndex = robotsTokens.includes('index');
  const hasNoindex = robotsTokens.includes('noindex');
  const hasFollow = robotsTokens.includes('follow');
  const hasNofollow = robotsTokens.includes('nofollow');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const h1Count = (html.match(/<h1(?:\s|>)/g) || []).length;
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  if (!title) failures.push(`${route}: title assente`);
  if (!description) failures.push(`${route}: meta description assente`);
  if (!robots) failures.push(`${route}: meta robots assente`);
  if (!canonical) failures.push(`${route}: canonical assente`);
  if (canonical && new URL(canonical).search) failures.push(`${route}: canonical contiene query`);
  if (h1Count !== 1) failures.push(`${route}: attesi 1 H1, trovati ${h1Count}`);
  if (!/<html lang="it-IT">/.test(html)) failures.push(`${route}: lang documento assente o errato`);
  if (duplicateIds.length) failures.push(`${route}: ID duplicati ${duplicateIds.join(', ')}`);
  for (const image of html.matchAll(/<img\b[^>]*>/g)) {
    if (!hasAltAttribute(image[0])) failures.push(`${route}: immagine senza attributo alt`);
    if (!/\swidth="\d+"/.test(image[0]) || !/\sheight="\d+"/.test(image[0])) {
      failures.push(`${route}: immagine senza dimensioni intrinseche`);
    }
    const source = image[0].match(/\ssrc="([^"]+)"/)?.[1];
    if (source?.startsWith('/') && !source.startsWith('//')) {
      try { await access(targetFileFromHref(source)); } catch { failures.push(`${route}: asset immagine assente ${source}`); }
    }
  }
  if (publicIndexing) {
    const expectedIndexable = readyManifestPaths.has(normalizeRoutePath(route));
    if (expectedIndexable) {
      if (!hasIndex || !hasFollow || hasNoindex || hasNofollow) failures.push(`${route}: manifest ready ma meta robots non indicizzabile (${robots || 'assente'})`);
      else indexableHtmlRoutes.add(normalizeRoutePath(route));
    } else if (!hasNoindex) {
      failures.push(`${route}: rotta non ready ma meta robots privo di noindex (${robots || 'assente'})`);
    }
  } else {
    if (!hasNoindex) failures.push(`${route}: preview priva di noindex`);
    if (/<link rel="sitemap"\b/i.test(html)) failures.push(`${route}: preview espone link sitemap`);
    if (/serviceWorker\.register\s*\(/.test(html)) previewServiceWorkerRegistrations += 1;
  }
  if (title && (title.length < 28 || title.length > 65)) warnings.push(`${route}: title ${title.length} caratteri`);
  if (description && (description.length < 105 || description.length > 165)) warnings.push(`${route}: description ${description.length} caratteri`);

  for (const scriptMatch of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    if (scriptMatch[1].includes('<')) failures.push(`${route}: JSON-LD contiene caratteri non serializzati in sicurezza`);
    try { JSON.parse(scriptMatch[1]); } catch { failures.push(`${route}: JSON-LD non valido`); }
  }
  if (fixtureData && route.startsWith('/locali/') && /"@type":"(?:LocalBusiness|BarOrPub|Restaurant|LiquorStore|CafeOrCoffeeShop)"/.test(html)) {
    failures.push(`${route}: schema LocalBusiness vietato sulle fixture`);
  }

  for (const link of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    const href = link[1];
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    internalLinks += 1;
    try { await access(targetFileFromHref(href)); } catch { failures.push(`${route}: link interno rotto ${href}`); }
  }
}

if (!publicIndexing && previewServiceWorkerRegistrations > 0) {
  failures.push(`preview registra il service worker in ${previewServiceWorkerRegistrations} HTML`);
}

if (publicIndexing) reportSetMismatch('manifest ready vs HTML indicizzabili', readyManifestPaths, indexableHtmlRoutes);

const robotsText = await readFile(path.join(distDir, 'robots.txt'), 'utf8');
if (!publicIndexing && !/User-agent: \*\nDisallow: \//.test(robotsText)) failures.push('robots.txt preview non bloccante');
const sitemapIndexPath = path.join(distDir, 'sitemap-index.xml');
const sitemapDirectory = path.join(distDir, 'sitemaps');
const sitemapFiles = await listXmlFiles(sitemapDirectory);
const netlifyHeadersPath = path.join(distDir, '_headers');
let netlifyHeaders = '';
try { netlifyHeaders = await readFile(netlifyHeadersPath, 'utf8'); } catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
if (!publicIndexing && !/^\/\*[\s\S]*X-Robots-Tag:\s*noindex/im.test(netlifyHeaders)) {
  failures.push('preview priva di X-Robots-Tag globale in dist/_headers');
}
if (publicIndexing && /X-Robots-Tag:\s*noindex/i.test(netlifyHeaders)) {
  failures.push('build production/gold conserva per errore il noindex globale della preview');
}
let sitemapIndexExists = true;
try {
  await access(sitemapIndexPath);
} catch {
  sitemapIndexExists = false;
}

if (!publicIndexing) {
  if (sitemapIndexExists) failures.push('sitemap index presente in preview');
  if (sitemapFiles.length) failures.push(`sitemap segmentate presenti in preview: ${sitemapFiles.map((file) => path.relative(distDir, file)).join(', ')}`);
} else if (!sitemapIndexExists) {
  failures.push('sitemap assente in build pubblica');
} else {
  let parsedSite;
  try {
    parsedSite = new URL(siteUrl);
  } catch {
    failures.push(`PUBLIC_SITE_URL non valida: ${siteUrl}`);
  }

  if (parsedSite) {
    const expectedPageUrls = new Set(readyManifestRoutes.map((route) => new URL(route.path, parsedSite).toString()));
    const expectedSitemapPaths = new Set(
      [...new Set(readyManifestRoutes.map((route) => route.segment))].map((segment) => `/sitemaps/${segment}.xml`),
    );
    const actualSitemapPaths = new Set(sitemapFiles.map((file) => `/${path.relative(distDir, file).split(path.sep).join('/')}`));
    reportSetMismatch('segmenti sitemap manifest vs file', expectedSitemapPaths, actualSitemapPaths);

    const sitemapIndexXml = await readFile(sitemapIndexPath, 'utf8');
    const sitemapIndexLocs = extractLocs(sitemapIndexXml);
    const duplicateSitemapIndexLocs = sorted(new Set(sitemapIndexLocs.filter((url, index) => sitemapIndexLocs.indexOf(url) !== index)));
    if (duplicateSitemapIndexLocs.length) failures.push(`sitemap index: URL duplicate ${duplicateSitemapIndexLocs.join(', ')}`);
    const indexedSitemapPaths = new Set();
    for (const loc of sitemapIndexLocs) {
      try {
        const url = new URL(loc);
        if (url.origin !== parsedSite.origin) failures.push(`sitemap index: origine inattesa ${url.origin}`);
        indexedSitemapPaths.add(url.pathname);
      } catch {
        failures.push(`sitemap index: URL non valida ${loc}`);
      }
    }
    reportSetMismatch('sitemap index vs segmenti attesi', expectedSitemapPaths, indexedSitemapPaths);

    const sitemapPageUrls = [];
    for (const file of sitemapFiles) {
      const xml = await readFile(file, 'utf8');
      sitemapPageUrls.push(...extractLocs(xml));
    }
    const duplicateSitemapUrls = sorted(new Set(sitemapPageUrls.filter((url, index) => sitemapPageUrls.indexOf(url) !== index)));
    if (duplicateSitemapUrls.length) failures.push(`sitemap: URL duplicate ${duplicateSitemapUrls.join(', ')}`);
    const actualPageUrls = new Set(sitemapPageUrls);
    reportSetMismatch('manifest ready vs URL sitemap', expectedPageUrls, actualPageUrls);
  }
}

const serviceWorker = await readFile(path.join(distDir, 'sw.js'), 'utf8');
if (!/["']\/preferiti\/["']/.test(serviceWorker) || !/["']\/profilo\/["']/.test(serviceWorker)) {
  failures.push('service worker privo delle shell private offline');
}
if (!serviceWorker.includes('/_astro/')) failures.push('service worker privo degli asset Astro hashed');
if (!serviceWorker.includes('/images/venue-cocktail.webp')) failures.push('service worker privo delle immagini venue offline');
if (!serviceWorker.includes("const NETWORK_ONLY_PATHS = ['/api/']")) {
  failures.push('service worker non mantiene le API network-only');
}
if (!serviceWorker.includes('"/cerca/"')) {
  failures.push('service worker privo della shell /cerca/ in precache');
}
const searchShellBranch = serviceWorker.match(/if \(isSearchShellNavigation\) \{([\s\S]*?)\n  \}/)?.[1] || '';
if (!searchShellBranch.includes("fetch(event.request).catch")) {
  failures.push('service worker privo del fallback offline dedicato alla ricerca');
}
if (!searchShellBranch.includes("caches.match('/cerca/', { ignoreSearch: true })")) {
  failures.push('service worker non risolve le query offline sulla shell neutra /cerca/');
}
if (searchShellBranch.includes('cache.put') || searchShellBranch.includes('caches.open')) {
  failures.push('service worker tenta di memorizzare una URL di ricerca personalizzata');
}
const searchShellBranchIndex = serviceWorker.indexOf('if (isSearchShellNavigation)');
const genericQueryBranchIndex = serviceWorker.indexOf('if (url.search)');
if (searchShellBranchIndex < 0 || genericQueryBranchIndex < searchShellBranchIndex) {
  failures.push('service worker intercetta la query prima del fallback neutro /cerca/');
}

const webManifest = JSON.parse(await readFile(path.join(distDir, 'manifest.webmanifest'), 'utf8'));
const manifestIcons = Array.isArray(webManifest.icons) ? webManifest.icons : [];
const iconPurposes = (icon) => String(icon?.purpose || 'any').split(/\s+/).filter(Boolean);
const anyIcons = manifestIcons.filter((icon) => iconPurposes(icon).includes('any'));
const maskableIcons = manifestIcons.filter((icon) => iconPurposes(icon).includes('maskable'));
if (!maskableIcons.length) failures.push('manifest PWA privo di icona maskable dedicata');
if (maskableIcons.some((icon) => iconPurposes(icon).includes('any'))) {
  failures.push('manifest PWA riusa una singola dichiarazione per purpose any e maskable');
}
const anyIconSources = new Set(anyIcons.map((icon) => icon.src));
if (maskableIcons.some((icon) => anyIconSources.has(icon.src))) {
  failures.push('manifest PWA riusa lo stesso asset per icone any e maskable');
}
for (const icon of maskableIcons) {
  try {
    await access(path.join(distDir, String(icon.src).replace(/^\/+/, '')));
  } catch {
    failures.push(`manifest PWA: asset maskable assente ${String(icon.src)}`);
  }
}
if (!serviceWorker.includes('/icon-maskable.svg')) failures.push('service worker privo dell’icona maskable');

const javascriptFiles = (await walk(path.join(distDir, '_astro'))).filter((file) => file.endsWith('.js'));
const compressedJavascriptBytes = (await Promise.all(
  javascriptFiles.map(async (file) => gzipSync(await readFile(file)).byteLength),
)).reduce((total, bytes) => total + bytes, 0);
if (compressedJavascriptBytes > 150 * 1024) {
  failures.push(`budget JavaScript superato: ${Math.ceil(compressedJavascriptBytes / 1024)} KB gzip`);
}

if (failures.length) {
  console.error(`Audit build fallito (${failures.length}):\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exit(1);
}

console.log(`Audit build: ${htmlFiles.length} HTML, ${internalLinks} link interni, ${Math.ceil(compressedJavascriptBytes / 1024)} KB JS gzip, 0 errori.`);
if (warnings.length) console.log(`Avvisi editoriali (${warnings.length}):\n- ${[...new Set(warnings)].join('\n- ')}`);

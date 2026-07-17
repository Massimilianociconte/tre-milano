import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublicEnv } from './load-public-env.mjs';

export const PREVIEW_ROBOTS_HEADER = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

export function renderNetlifyRobotsHeaders(publicIndexing) {
  return publicIndexing ? '' : `/*\n  X-Robots-Tag: ${PREVIEW_ROBOTS_HEADER}\n`;
}

const INLINE_SCRIPT_PATTERN = /<script(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/gi;

/**
 * Estrae gli hash sha256 (base64) degli script inline eseguibili di una
 * pagina. I blocchi dati (es. application/ld+json) non sono eseguibili e non
 * entrano nella policy; gli script con src esterno sono coperti da 'self'.
 */
export function collectInlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
    const attributes = match.groups.attributes || '';
    const body = match.groups.body || '';
    if (!body) continue;
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*"([^"]*)"/i)?.[1]?.toLowerCase();
    if (type && type !== 'module' && type !== 'text/javascript') continue;
    hashes.add(createHash('sha256').update(body, 'utf8').digest('base64'));
  }
  return hashes;
}

/**
 * CSP allineata alla policy storica di netlify.toml, ma senza 'unsafe-inline'
 * negli script: ogni inline eseguibile è ammesso soltanto tramite hash sha256
 * calcolato sull'output reale della build. Gli attributi style dei template
 * richiedono ancora 'unsafe-inline' in style-src.
 */
export function renderContentSecurityPolicy(scriptHashes) {
  const hashSources = [...scriptHashes].sort().map((hash) => `'sha256-${hash}'`).join(' ');
  const scriptSrc = hashSources ? `script-src 'self' ${hashSources}` : "script-src 'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "media-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function renderContentSecurityHeaders(scriptHashes) {
  return `/*\n  Content-Security-Policy: ${renderContentSecurityPolicy(scriptHashes)}\n`;
}

async function listHtmlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listHtmlFiles(fullPath));
    else if (entry.name.endsWith('.html')) files.push(fullPath);
  }
  return files;
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distRoot = path.join(projectRoot, 'dist');
  const outputPath = path.join(distRoot, '_headers');
  const env = loadPublicEnv(projectRoot, 'production');
  const publicIndexing = env.PUBLIC_SITE_MODE === 'production' && env.PUBLIC_DATA_MODE === 'gold';

  const htmlFiles = await listHtmlFiles(distRoot);
  if (!htmlFiles.length) throw new Error('Nessun HTML in dist: eseguire la build prima degli header.');
  const hashes = new Set();
  for (const file of htmlFiles) {
    for (const hash of collectInlineScriptHashes(await readFile(file, 'utf8'))) hashes.add(hash);
  }

  const contents = renderNetlifyRobotsHeaders(publicIndexing) + renderContentSecurityHeaders(hashes);
  await rm(outputPath, { force: true });
  await writeFile(outputPath, contents, 'utf8');
  console.log(`Netlify headers: CSP con ${hashes.size} hash di script inline su ${htmlFiles.length} HTML${publicIndexing ? '' : '; noindex globale preview/fixture attivo'}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

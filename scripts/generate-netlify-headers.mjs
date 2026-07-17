import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublicEnv } from './load-public-env.mjs';

export const PREVIEW_ROBOTS_HEADER = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

export function renderNetlifyRobotsHeaders(publicIndexing) {
  return publicIndexing ? '' : `/*\n  X-Robots-Tag: ${PREVIEW_ROBOTS_HEADER}\n`;
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outputPath = path.join(projectRoot, 'dist', '_headers');
  const env = loadPublicEnv(projectRoot, 'production');
  const publicIndexing = env.PUBLIC_SITE_MODE === 'production' && env.PUBLIC_DATA_MODE === 'gold';
  const contents = renderNetlifyRobotsHeaders(publicIndexing);
  await rm(outputPath, { force: true });
  if (contents) await writeFile(outputPath, contents, 'utf8');
  console.log(publicIndexing
    ? 'Netlify robots header: rimosso per build production/gold.'
    : 'Netlify robots header: noindex globale attivo in preview/fixture.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

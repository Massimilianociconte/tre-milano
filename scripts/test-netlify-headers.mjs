import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_ROBOTS_HEADER, renderNetlifyRobotsHeaders } from './generate-netlify-headers.mjs';

test('la preview aggiunge un X-Robots-Tag globale fail-closed', () => {
  const headers = renderNetlifyRobotsHeaders(false);
  assert.match(headers, /^\/\*\n/);
  assert.match(headers, new RegExp(`X-Robots-Tag: ${PREVIEW_ROBOTS_HEADER}`));
});

test('la build production/gold non eredita il noindex globale della preview', () => {
  assert.equal(renderNetlifyRobotsHeaders(true), '');
});

test('la CSP generata ammette solo gli inline con hash e mai unsafe-inline negli script', async () => {
  const { collectInlineScriptHashes, renderContentSecurityHeaders } = await import('./generate-netlify-headers.mjs');
  const html = [
    '<script>console.log(1)</script>',
    '<script type="module">init()</script>',
    '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
    '<script src="/bundle.js"></script>',
  ].join('\n');
  const hashes = collectInlineScriptHashes(html);
  assert.equal(hashes.size, 2);
  const block = renderContentSecurityHeaders(hashes);
  assert.match(block, /^\/\*\n  Content-Security-Policy: /);
  assert.match(block, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(block));
  assert.match(block, /frame-ancestors 'none'/);
});

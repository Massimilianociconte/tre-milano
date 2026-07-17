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

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNetlifyBuildEnvironment } from './run-netlify-build.mjs';

test('la preview usa il primary URL stabile prima del deploy URL', () => {
  const env = resolveNetlifyBuildEnvironment({
    URL: 'https://primary.example',
    DEPLOY_PRIME_URL: 'https://deploy-id.example',
  });
  assert.equal(env.PUBLIC_SITE_MODE, 'preview');
  assert.equal(env.PUBLIC_DATA_MODE, 'fixture');
  assert.equal(env.PUBLIC_SITE_URL, 'https://primary.example');
});

test('production Gold richiede un canonical esplicito', () => {
  assert.throws(() => resolveNetlifyBuildEnvironment({
    PUBLIC_SITE_MODE: 'production',
    PUBLIC_DATA_MODE: 'gold',
    URL: 'https://fallback.example',
  }), /PUBLIC_SITE_URL/);
});

test('production Gold conserva il canonical configurato', () => {
  const env = resolveNetlifyBuildEnvironment({
    PUBLIC_SITE_MODE: 'production',
    PUBLIC_DATA_MODE: 'gold',
    PUBLIC_SITE_URL: 'https://tre.example',
  });
  assert.equal(env.PUBLIC_SITE_URL, 'https://tre.example');
});

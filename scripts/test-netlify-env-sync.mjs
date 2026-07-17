import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaceholder, netlifySetArgs, NETLIFY_ENV_DEFINITIONS, parseEnv } from './sync-netlify-env.mjs';

test('il parser Netlify non interpreta sintassi shell', () => {
  const env = parseEnv("SAFE='value with spaces'\nLITERAL=$(do-not-run)\n# commento\n");
  assert.equal(env.SAFE, 'value with spaces');
  assert.equal(env.LITERAL, '$(do-not-run)');
});

test('placeholder e domini example vengono rifiutati', () => {
  assert.equal(isPlaceholder('YOUR_PROJECT_REF'), true);
  assert.equal(isPlaceholder('https://tre-milano.example'), true);
  assert.equal(isPlaceholder('https://tre-milano-preview-160726.netlify.app'), false);
});

test('la allowlist non può importare la service-role legacy o credenziali pipeline', () => {
  const keys = new Set(NETLIFY_ENV_DEFINITIONS.map(({ key }) => key));
  assert.equal(keys.has('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(keys.has('SUPABASE_ACCESS_TOKEN'), false);
  assert.equal(keys.has('SUPABASE_DB_URL'), false);
  assert.equal(keys.has('SUPABASE_SECRET_KEY'), true);
  assert.equal(keys.has('DEEPSEEK_API_KEY'), true);
});

test('un secret viene scritto una sola volta insieme al valore reale', () => {
  const definition = NETLIFY_ENV_DEFINITIONS.find(({ key }) => key === 'DEEPSEEK_API_KEY');
  assert.ok(definition);
  const args = netlifySetArgs(definition, 'secret-value-for-test');
  assert.deepEqual(args, [
    'env:set', 'DEEPSEEK_API_KEY', 'secret-value-for-test',
    '--context', 'production', '--force', '--secret',
  ]);
});

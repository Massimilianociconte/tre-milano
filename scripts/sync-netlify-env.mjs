import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export const NETLIFY_ENV_DEFINITIONS = [
  { key: 'PUBLIC_SITE_URL', required: true, scopes: ['builds', 'functions', 'runtime'] },
  { key: 'PUBLIC_SITE_MODE', required: true, scopes: ['builds', 'functions', 'runtime'] },
  { key: 'PUBLIC_DATA_MODE', required: true, scopes: ['builds'] },
  { key: 'PUBLIC_TURNSTILE_SITE_KEY', scopes: ['builds'] },
  { key: 'SUPABASE_URL', required: true, scopes: ['functions', 'runtime'] },
  { key: 'SUPABASE_SECRET_KEY', required: true, secret: true, scopes: ['functions', 'runtime'] },
  { key: 'RATE_LIMIT_HASH_SECRET', required: true, secret: true, scopes: ['functions', 'runtime'] },
  { key: 'DEEPSEEK_API_KEY', required: true, secret: true, scopes: ['functions', 'runtime'] },
  { key: 'DEEPSEEK_INTERPRETER_CACHE_TTL_SECONDS', scopes: ['functions', 'runtime'] },
  { key: 'DEEPSEEK_INTERPRETER_CACHE_MAX_ENTRIES', scopes: ['functions', 'runtime'] },
  { key: 'CATALOG_API_CACHE_SECONDS', scopes: ['functions', 'runtime'] },
  { key: 'CATALOG_API_RATE_LIMIT', scopes: ['functions', 'runtime'] },
  { key: 'TURNSTILE_SECRET_KEY', secret: true, scopes: ['functions', 'runtime'] },
  { key: 'TURNSTILE_EXPECTED_HOSTNAME', scopes: ['functions', 'runtime'] },
  { key: 'CLAIM_RETENTION_DAYS', scopes: ['functions', 'runtime'] },
  { key: 'CLAIM_RATE_LIMIT_PER_HOUR', scopes: ['functions', 'runtime'] },
  { key: 'CLAIM_NOTIFICATION_WEBHOOK_URL', secret: true, scopes: ['functions', 'runtime'] },
  { key: 'ALERT_WEBHOOK_URL', secret: true, scopes: ['functions', 'runtime'] },
  { key: 'INDEXNOW_KEY', scopes: ['builds'] },
];

export function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function isPlaceholder(value) {
  return /(?:YOUR_|CHANGE_ME|REPLACE_ME|\.example\b|<[^>]+>)/i.test(value);
}

export function netlifySetArgs(definition, value) {
  return [
    'env:set', definition.key, value,
    '--context', 'production',
    '--force',
    ...(definition.secret ? ['--secret'] : []),
  ];
}

async function runNetlify(args, sensitiveValue = '') {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(executable, ['netlify', ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) {
    const rawOutput = Buffer.concat(chunks).toString('utf8');
    const output = (sensitiveValue ? rawOutput.replaceAll(sensitiveValue, '[REDACTED]') : rawOutput).trim();
    throw new Error(output || `Netlify CLI terminata con codice ${code}`);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const path = process.argv.find((argument) => argument.startsWith('--env='))?.slice(6) || '.env.netlify.local';
  const onlyKey = process.argv.find((argument) => argument.startsWith('--only='))?.slice(7);
  const values = parseEnv(await readFile(path, 'utf8'));

  const missing = NETLIFY_ENV_DEFINITIONS
    .filter((definition) => definition.required)
    .filter((definition) => !values[definition.key] || isPlaceholder(values[definition.key]))
    .map((definition) => definition.key);
  if (missing.length) throw new Error(`Variabili obbligatorie mancanti o placeholder: ${missing.join(', ')}`);

  const state = JSON.parse(await readFile('.netlify/state.json', 'utf8'));
  const siteId = state.siteId;
  if (typeof siteId !== 'string' || !siteId) throw new Error('Progetto Netlify non collegato.');
  const site = JSON.parse(await runNetlify([
    'api', 'getSite', '--data', JSON.stringify({ site_id: siteId }),
  ]));
  const accountId = site.account_slug;
  if (typeof accountId !== 'string' || !accountId) throw new Error('Account Netlify non risolto.');
  const configured = [];
  const skipped = [];
  const selectedDefinitions = onlyKey
    ? NETLIFY_ENV_DEFINITIONS.filter((definition) => definition.key === onlyKey)
    : NETLIFY_ENV_DEFINITIONS;
  if (onlyKey && selectedDefinitions.length === 0) throw new Error(`Variabile non ammessa: ${onlyKey}`);

  for (const definition of selectedDefinitions) {
    const value = values[definition.key]?.trim();
    if (!value || isPlaceholder(value)) {
      skipped.push(definition.key);
      continue;
    }
    // `--secret` deve essere applicato nella stessa scrittura che contiene il
    // valore. Una seconda conversione senza valore può leggere la maschera
    // restituita dall'API e sovrascrivere accidentalmente il secret reale.
    await runNetlify(netlifySetArgs(definition, value), value);
    configured.push(definition.key);
    console.info(`Configurata ${definition.key}`);
  }

  const remoteVariables = JSON.parse(await runNetlify([
    'api', 'getEnvVars', '--data', JSON.stringify({ account_id: accountId, site_id: siteId }),
  ]));
  const remoteByKey = new Map(remoteVariables.map((variable) => [variable.key, variable]));
  for (const key of configured) {
    const definition = NETLIFY_ENV_DEFINITIONS.find((candidate) => candidate.key === key);
    const remote = remoteByKey.get(key);
    if (!remote || !remote.values?.some((entry) => entry.context === 'production')) {
      throw new Error(`Verifica remota fallita per ${key}`);
    }
    if (definition?.secret && (!remote.is_secret || remote.scopes.includes('post-processing'))) {
      throw new Error(`Boundary secret non applicato per ${key}`);
    }
  }
  console.info(JSON.stringify({
    configured,
    skipped,
    legacyServiceRoleImported: false,
    scopeMode: 'free-plan-compatible; secrets exclude post-processing',
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Sincronizzazione Netlify non riuscita.');
    process.exitCode = 1;
  });
}

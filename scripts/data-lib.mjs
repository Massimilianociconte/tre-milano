import { readFile } from 'node:fs/promises';

const MAX_RPC_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function loadDataEnv(path, fallbackPaths = ['.env.pipeline', '.env']) {
  let content = '';
  for (const candidate of path ? [path] : fallbackPaths) {
    try {
      content = await readFile(candidate, 'utf8');
      break;
    } catch { /* prova il fallback successivo */ }
  }
  if (!content) return { ...process.env };
  const fileValues = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fileValues[key] = value;
  }
  return { ...fileValues, ...process.env };
}

export function requiredDataEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Variabile server mancante: ${name}`);
  return value;
}

export function createDataClient(env, fetchImpl = fetch) {
  const url = normalizeDataServiceUrl(requiredDataEnv(env, 'SUPABASE_URL'));
  const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error('Variabile server mancante: SUPABASE_SECRET_KEY');
  if (key.length < 32) throw new Error('SUPABASE_SECRET_KEY non valida.');
  const timeoutMs = parseBoundedInteger(env.DATA_RPC_TIMEOUT_MS || '60000', 'DATA_RPC_TIMEOUT_MS', 1000, 120000);
  return {
    async rpc(name, parameters) {
      const rpcName = normalizeRpcName(name);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${url}/rest/v1/rpc/${rpcName}`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            apikey: key,
            ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
            'Content-Type': 'application/json', Accept: 'application/json',
          },
          body: JSON.stringify(parameters), signal: controller.signal,
        });
        const body = await readBoundedResponseText(response, MAX_RPC_RESPONSE_BYTES, `RPC ${rpcName}`);
        if (!response.ok) {
          let code = `HTTP_${response.status}`;
          try { code = JSON.parse(body).code || code; } catch { /* keep sanitized code */ }
          throw new Error(`RPC ${rpcName} non riuscita: ${code}`);
        }
        return body ? JSON.parse(body) : null;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error(`RPC ${rpcName} non riuscita: TIMEOUT`);
        if (error instanceof Error && error.message.startsWith(`RPC ${rpcName} non riuscita:`)) throw error;
        throw new Error(`RPC ${rpcName} non riuscita: NETWORK`);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function normalizeDataServiceUrl(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('SUPABASE_URL non valida.'); }
  const exactLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && exactLocalHost)) throw new Error('SUPABASE_URL non valida.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error('SUPABASE_URL non valida.');
  }
  return parsed.origin;
}

export function normalizeRpcName(raw) {
  if (typeof raw !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(raw)) throw new Error('Nome RPC non valido.');
  return raw;
}

export async function readBoundedResponseText(response, maximumBytes, context = 'Risposta') {
  const contentLength = Number(response.headers?.get?.('content-length'));
  const contentRange = response.headers?.get?.('content-range') || '';
  const rangeTotal = Number(contentRange.match(/\/(\d+)$/)?.[1]);
  if ((Number.isFinite(contentLength) && contentLength > maximumBytes) || (Number.isFinite(rangeTotal) && rangeTotal > maximumBytes)) {
    throw new Error(`${context} oltre il limite consentito.`);
  }
  if (!response.body?.getReader) {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw new Error(`${context} oltre il limite consentito.`);
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${context} oltre il limite consentito.`);
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

export function parseBoundedInteger(raw, name, minimum, maximum) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} deve essere un intero tra ${minimum} e ${maximum}.`);
  return value;
}

export function assertWriteConfirmed(env, args = process.argv) {
  if (env.DATA_IMPORT_DRY_RUN !== 'false' || !args.includes('--confirm-write')) {
    throw new Error('Import bloccato: imposta DATA_IMPORT_DRY_RUN=false e aggiungi --confirm-write.');
  }
}

export function cliOption(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function chunk(values, size) {
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error('Batch size deve essere un intero tra 1 e 500.');
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

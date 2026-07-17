declare const Netlify: { env: { get(name: string): string | undefined } } | undefined;
declare const process: { env: Record<string, string | undefined> } | undefined;

export class RuntimeConfigurationError extends Error {
  constructor(public readonly variable: string) {
    super(`Missing or invalid server configuration: ${variable}`);
    this.name = 'RuntimeConfigurationError';
  }
}

export function serverEnv(name: string) {
  // Some Netlify Function runtimes expose a `Netlify` global while keeping
  // environment variables on Node's `process.env`. An absent/unsupported
  // first surface must therefore fall through to the Node runtime.
  let netlifyValue: string | undefined;
  if (typeof Netlify !== 'undefined') {
    try { netlifyValue = Netlify.env.get(name); } catch { /* Node fallback below. */ }
  }
  const processValue = typeof process !== 'undefined' ? process.env[name] : undefined;
  return (netlifyValue || processValue)?.trim() || undefined;
}

export function requiredServerEnv(name: string, read = serverEnv) {
  const value = read(name);
  if (!value) throw new RuntimeConfigurationError(name);
  return value;
}

export function requiredSecretEnv(name: string, minimumLength = 32, read = serverEnv) {
  const value = requiredServerEnv(name, read);
  if (value.length < minimumLength) throw new RuntimeConfigurationError(name);
  return value;
}

export type SupabaseRuntimeConfig = { url: string; apiKey: string };

export function loadSupabaseRuntimeConfig(read = serverEnv): SupabaseRuntimeConfig {
  const url = requiredServerEnv('SUPABASE_URL', read).replace(/\/$/, '');
  const apiKey = read('SUPABASE_SECRET_KEY') || read('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey) throw new RuntimeConfigurationError('SUPABASE_SECRET_KEY');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeConfigurationError('SUPABASE_URL');
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new RuntimeConfigurationError('SUPABASE_URL');
  }
  if (apiKey.length < 32) throw new RuntimeConfigurationError('SUPABASE_SECRET_KEY');
  return { url, apiKey };
}

export function numberEnv(name: string, fallback: number, bounds: { min: number; max: number }, read = serverEnv) {
  const raw = read(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) throw new RuntimeConfigurationError(name);
  return value;
}

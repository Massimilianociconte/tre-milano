import { loadSupabaseRuntimeConfig, type SupabaseRuntimeConfig } from './env';

export class SupabaseRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message = 'Database request failed') {
    super(message);
    this.name = 'SupabaseRequestError';
  }
}

type ClientOptions = {
  config?: SupabaseRuntimeConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createSupabaseAdminClient({
  config = loadSupabaseRuntimeConfig(),
  fetchImpl = fetch,
  timeoutMs = 5_000,
}: ClientOptions = {}) {
  const request = async <T>(path: string, init: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set('apikey', config.apiKey);
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json');
      if (!config.apiKey.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${config.apiKey}`);
      const response = await fetchImpl(`${config.url}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
      const body = await response.text();
      if (!response.ok) {
        let code = 'database_error';
        try { code = (JSON.parse(body) as { code?: string }).code || code; } catch { /* sanitized below */ }
        throw new SupabaseRequestError(response.status, code);
      }
      if (!body) return undefined as T;
      return JSON.parse(body) as T;
    } catch (error) {
      if (error instanceof SupabaseRequestError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new SupabaseRequestError(504, 'database_timeout');
      throw new SupabaseRequestError(503, 'database_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    rpc<T>(functionName: string, parameters: Record<string, unknown>) {
      if (!/^[a-z][a-z0-9_]*$/.test(functionName)) throw new Error('Invalid RPC name');
      return request<T>(`/rest/v1/rpc/${functionName}`, { method: 'POST', body: JSON.stringify(parameters) });
    },
  };
}

export type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

import type { SupabaseAdminClient } from './supabase';
import { keyedHash } from './http';

type RateLimitRow = { allowed: boolean; request_count: number; retry_after_seconds: number };

export async function consumeRateLimit(options: {
  client: SupabaseAdminClient;
  identifier: string;
  hashSecret: string;
  route: string;
  limit: number;
  windowSeconds: number;
}) {
  const bucket = await keyedHash(options.identifier, options.hashSecret);
  const rows = await options.client.rpc<RateLimitRow[]>('consume_api_rate_limit', {
    p_bucket_key: bucket,
    p_route_key: options.route,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Invalid rate-limit response');
  return { allowed: rows[0].allowed, count: rows[0].request_count, retryAfterSeconds: rows[0].retry_after_seconds };
}

import type { Context } from '@netlify/functions';
import type { CatalogProblem } from '../../../src/domain/catalog-api';

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const PROBLEM_TYPE_NAMESPACE = 'urn:tre-milano:problem:http-status';

export function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(BASE_HEADERS);
  new Headers(headers).forEach((headerValue, headerName) => {
    responseHeaders.set(headerName, headerValue);
  });
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

export function problem(status: number, title: string, options: { type?: string; detail?: string; requestId?: string; headers?: HeadersInit } = {}) {
  const body: CatalogProblem = {
    type: options.type || `${PROBLEM_TYPE_NAMESPACE}:${status}`,
    title,
    status,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
  };
  // Error responses are intentionally non-cacheable, but still vary by Origin:
  // otherwise a CDN is free to reuse a same-origin denial for a different
  // request context (or vice versa) before the Function is reached.
  return json(body, status, { 'Cache-Control': 'no-store', Vary: 'Origin', ...options.headers });
}

export function isSameOriginOrServerRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export async function readJsonBody(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyError('too_large');
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestBodyError('unsupported_media');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestBodyError('too_large');
  try { return JSON.parse(text) as unknown; } catch { throw new RequestBodyError('invalid_json'); }
}

export class RequestBodyError extends Error {
  constructor(public readonly reason: 'too_large' | 'unsupported_media' | 'invalid_json') {
    super(reason);
    this.name = 'RequestBodyError';
  }
}

export function clientIp(context: Context) {
  return context.ip || 'unknown';
}

export async function keyedHash(value: string, secret: string) {
  const bytes = new TextEncoder().encode(`${secret}\u0000${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function responseEtag(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `"${hash}"`;
}

export function cacheWindowTimestamp(cacheSeconds: number, now = Date.now()) {
  if (!Number.isFinite(now)) throw new TypeError('Invalid cache timestamp');
  if (!Number.isFinite(cacheSeconds) || cacheSeconds <= 0) return new Date(now).toISOString();
  const windowMilliseconds = Math.max(1_000, Math.floor(cacheSeconds * 1_000));
  return new Date(Math.floor(now / windowMilliseconds) * windowMilliseconds).toISOString();
}

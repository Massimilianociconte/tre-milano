import type { Config, Context } from '@netlify/functions';
import { loadSupabaseRuntimeConfig, numberEnv, requiredSecretEnv, requiredServerEnv, RuntimeConfigurationError, serverEnv } from './_shared/env';
import { clientIp, isSameOriginOrServerRequest, json, problem, readJsonBody, RequestBodyError } from './_shared/http';
import { consumeRateLimit } from './_shared/rate-limit';
import { createSupabaseAdminClient, SupabaseRequestError } from './_shared/supabase';

const CLAIM_KINDS = new Set(['claim', 'correction', 'removal', 'closure', 'transfer']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9][0-9]{6,14}$/;

function isSafePublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^(?:10|127)\./.test(host) || /^192\.168\./.test(host)
      || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
    return url.protocol === 'https:' && !url.username && !url.password && !privateIpv4
      && !['localhost', '0.0.0.0', '127.0.0.1'].includes(host)
      && !/\.(?:local|localhost|internal|test|invalid|example)$/.test(host);
  } catch { return false; }
}

type ClaimPayload = {
  venueSlug?: unknown; kind?: unknown; claimantName?: unknown; claimantRole?: unknown;
  claimantEmail?: unknown; claimantPhone?: unknown; businessWebsite?: unknown;
  detail?: unknown; evidenceUrls?: unknown; privacyNoticeAccepted?: unknown; turnstileToken?: unknown;
};

export async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string,
  expected: { hostname: string; action: string },
  fetchImpl = fetch,
) {
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal,
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    return result.success === true && result.hostname === expected.hostname && result.action === expected.action;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') return problem(405, 'Metodo non consentito', { requestId: context.requestId });
  if (!isSameOriginOrServerRequest(request)) return problem(403, 'Origine non consentita', { requestId: context.requestId });
  try {
    const payload = await readJsonBody(request, 16_384) as ClaimPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return problem(400, 'Richiesta non valida', { requestId: context.requestId });
    const venueSlug = typeof payload.venueSlug === 'string' ? payload.venueSlug.trim() : '';
    const kind = typeof payload.kind === 'string' ? payload.kind : '';
    const name = typeof payload.claimantName === 'string' ? payload.claimantName.trim() : '';
    const role = typeof payload.claimantRole === 'string' ? payload.claimantRole.trim() : '';
    const email = typeof payload.claimantEmail === 'string' ? payload.claimantEmail.trim().toLowerCase() : '';
    const phone = typeof payload.claimantPhone === 'string' ? payload.claimantPhone.trim() : '';
    const website = typeof payload.businessWebsite === 'string' ? payload.businessWebsite.trim() : '';
    const detail = typeof payload.detail === 'string' ? payload.detail.trim() : '';
    const evidence = Array.isArray(payload.evidenceUrls) ? payload.evidenceUrls : [];
    const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
    if (!SLUG.test(venueSlug) || !CLAIM_KINDS.has(kind) || name.length < 2 || name.length > 160
      || role.length < 2 || role.length > 160 || !EMAIL.test(email) || detail.length < 20 || detail.length > 4000
      || payload.privacyNoticeAccepted !== true || (phone && !PHONE.test(phone)) || evidence.length > 8
      || evidence.some((value) => typeof value !== 'string' || !isSafePublicHttpsUrl(value) || value.length > 1000)
      || (website && (!isSafePublicHttpsUrl(website) || website.length > 1000))) {
      return problem(400, 'Richiesta non valida', { requestId: context.requestId });
    }

    const ip = clientIp(context);
    const client = createSupabaseAdminClient({ config: loadSupabaseRuntimeConfig() });
    const rate = await consumeRateLimit({
      client, identifier: `${ip}:${email}`, hashSecret: requiredSecretEnv('RATE_LIMIT_HASH_SECRET'),
      route: 'venue:claims', limit: numberEnv('CLAIM_RATE_LIMIT_PER_HOUR', 5, { min: 1, max: 100 }), windowSeconds: 3600,
    });
    if (!rate.allowed) return problem(429, 'Troppe richieste', {
      requestId: context.requestId, detail: 'Riprova più tardi.', headers: { 'Retry-After': String(rate.retryAfterSeconds) },
    });
    const turnstileSecret = requiredServerEnv('TURNSTILE_SECRET_KEY');
    const expectedHostname = serverEnv('TURNSTILE_EXPECTED_HOSTNAME') || new URL(requiredServerEnv('PUBLIC_SITE_URL')).hostname;
    if (!token || !(await verifyTurnstile(token, ip, turnstileSecret, { hostname: expectedHostname, action: 'venue_claim' }))) {
      return problem(400, 'Verifica anti-abuso non riuscita', { requestId: context.requestId });
    }
    const claimId = await client.rpc<string>('submit_venue_claim', {
      p_venue_slug: venueSlug, p_kind: kind, p_claimant_name: name, p_claimant_role: role,
      p_claimant_email: email, p_claimant_phone: phone || null, p_business_website: website || null,
      p_detail: detail, p_evidence_urls: evidence, p_notice_acknowledged_at: new Date().toISOString(),
      p_retention_days: numberEnv('CLAIM_RETENTION_DAYS', 365, { min: 30, max: 1095 }),
    });
    const webhook = serverEnv('CLAIM_NOTIFICATION_WEBHOOK_URL');
    if (webhook && /^https:\/\//.test(webhook)) {
      context.waitUntil(fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'venue_claim.received', claimId, venueSlug, kind }), signal: AbortSignal.timeout(4_000),
      }).then(() => undefined).catch(() => undefined));
    }
    return json({ status: 'received', claimId }, 202, { 'Cache-Control': 'no-store' });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      if (error.reason === 'too_large') return problem(413, 'Richiesta troppo grande', { requestId: context.requestId });
      if (error.reason === 'unsupported_media') return problem(415, 'Formato non supportato', { requestId: context.requestId });
      return problem(400, 'JSON non valido', { requestId: context.requestId });
    }
    if (error instanceof RuntimeConfigurationError) return problem(503, 'Servizio claim non configurato', { requestId: context.requestId });
    if (error instanceof SupabaseRequestError) return problem(503, 'Servizio claim temporaneamente non disponibile', { requestId: context.requestId });
    return problem(500, 'Errore interno', { requestId: context.requestId });
  }
};

export const config: Config = {
  path: '/api/venue-claims', method: 'POST',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 3600, windowLimit: 12 },
};

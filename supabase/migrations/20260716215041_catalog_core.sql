-- TRE Milano production catalog foundation.
-- This migration intentionally creates no public read policy: all access goes
-- through the constrained RPCs used by the Netlify server layer.

create schema if not exists extensions;
create schema if not exists private;

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

comment on schema private is 'TRE Milano internal helpers; never expose through the Data API.';
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.is_safe_public_https_url(value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select value ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/|$)'
    and lower(split_part(split_part(substring(value from 9), '/', 1), ':', 1)) not in ('localhost', '0.0.0.0', '127.0.0.1')
    and lower(split_part(split_part(substring(value from 9), '/', 1), ':', 1)) !~ '^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
    and lower(split_part(split_part(substring(value from 9), '/', 1), ':', 1)) !~ '\.(local|localhost|internal|test|invalid|example)$';
$$;

create or replace function private.are_safe_public_https_urls(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_values), 0) <= 8
    and not exists (select 1 from unnest(coalesce(p_values, '{}')) value where not private.is_safe_public_https_url(value));
$$;

revoke all on function private.is_safe_public_https_url(text) from public, anon, authenticated;
revoke all on function private.are_safe_public_https_urls(text[]) from public, anon, authenticated;
grant execute on function private.is_safe_public_https_url(text) to service_role;
grant execute on function private.are_safe_public_https_urls(text[]) to service_role;

create type public.venue_lifecycle_status as enum (
  'draft', 'active', 'temporarily_closed', 'permanently_closed', 'moved', 'archived'
);
create type public.verification_status as enum (
  'unverified', 'pending', 'verified', 'disputed', 'rejected'
);
create type public.maturity_tier as enum ('bronze', 'silver', 'gold', 'platinum');
create type public.source_kind as enum (
  'institutional', 'open_data', 'official_website', 'official_social',
  'licensed_api', 'editorial', 'user_report'
);
create type public.contact_kind as enum ('phone', 'email', 'website', 'instagram', 'facebook', 'tiktok', 'other_social');
create type public.image_rights_status as enum ('owned', 'licensed', 'official_permission', 'open_license', 'unknown', 'rejected');
create type public.import_run_status as enum ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');
create type public.claim_kind as enum ('claim', 'correction', 'removal', 'closure', 'transfer');
create type public.claim_status as enum ('pending', 'identity_review', 'accepted', 'rejected', 'completed', 'withdrawn');
create type public.report_status as enum ('received', 'triaged', 'accepted', 'rejected', 'resolved');

create table public.municipalities (
  id smallint primary key check (id between 1 and 9),
  name text not null unique,
  boundary extensions.geometry(multipolygon, 4326),
  updated_at timestamptz not null default now()
);

create table public.neighborhoods (
  id uuid primary key default gen_random_uuid(),
  municipality_id smallint references public.municipalities(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  aliases text[] not null default '{}',
  boundary extensions.geometry(multipolygon, 4326),
  centroid extensions.geography(point, 4326),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique,
  description text,
  display_order smallint not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  description text,
  active boolean not null default true,
  unique (category_id, name)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (source_key ~ '^[a-z0-9]+(?:[_-][a-z0-9]+)*$'),
  name text not null,
  kind public.source_kind not null,
  base_url text,
  api_url text,
  terms_url text,
  license_name text,
  license_url text,
  attribution_text text,
  commercial_use_allowed boolean not null default false,
  derivative_use_allowed boolean not null default false,
  raw_payload_retention_days integer not null default 30 check (raw_payload_retention_days between 0 and 3650),
  reliability_score numeric(4,3) not null default 0.500 check (reliability_score between 0 and 1),
  priority smallint not null default 100 check (priority between 1 and 1000),
  refresh_interval interval not null default interval '30 days' check (refresh_interval >= interval '1 hour'),
  enabled boolean not null default false,
  requires_manual_review boolean not null default true,
  last_success_at timestamptz,
  next_refresh_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (base_url is null or base_url ~ '^https://'),
  check (api_url is null or api_url ~ '^https://'),
  check (terms_url is null or terms_url ~ '^https://'),
  check (license_url is null or license_url ~ '^https://')
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  official_name text not null check (char_length(official_name) between 1 and 180),
  display_name text not null check (char_length(display_name) between 1 and 180),
  description text,
  short_description text check (short_description is null or char_length(short_description) <= 320),
  category_id uuid not null references public.categories(id) on delete restrict,
  subcategory_id uuid references public.subcategories(id) on delete set null,
  lifecycle_status public.venue_lifecycle_status not null default 'draft',
  verification_status public.verification_status not null default 'unverified',
  maturity public.maturity_tier not null default 'bronze',
  quality_score numeric(5,2) not null default 0 check (quality_score between 0 and 100),
  completeness_score numeric(5,2) not null default 0 check (completeness_score between 0 and 100),
  confidence_score numeric(4,3) not null default 0 check (confidence_score between 0 and 1),
  recommendation_eligible boolean not null default false,
  identity_fingerprint text unique,
  semantic_text text,
  search_document tsvector generated always as (
    setweight(to_tsvector('italian', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('italian', coalesce(short_description, '')), 'B') ||
    setweight(to_tsvector('italian', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('italian', coalesce(semantic_text, '')), 'B')
  ) stored,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  verified_at timestamptz,
  stale_after timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subcategory_id is null or category_id is not null),
  check (recommendation_eligible = false or (
    lifecycle_status = 'active' and verification_status = 'verified'
    and maturity in ('gold', 'platinum') and confidence_score >= 0.7
  )),
  check (published_at is null or lifecycle_status <> 'draft')
);

create table public.venue_addresses (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  neighborhood_id uuid references public.neighborhoods(id) on delete set null,
  municipality_id smallint references public.municipalities(id) on delete restrict,
  label text not null default 'Sede principale',
  street_name text not null,
  street_number text,
  postal_code text check (postal_code is null or postal_code ~ '^20[0-9]{3}$'),
  locality text not null default 'Milano' check (locality = 'Milano'),
  province text not null default 'MI' check (province = 'MI'),
  country_code text not null default 'IT' check (country_code = 'IT'),
  formatted_address text not null,
  normalized_address text not null,
  latitude double precision not null check (latitude between 45.30 and 45.65),
  longitude double precision not null check (longitude between 8.90 and 9.45),
  location extensions.geography(point, 4326) not null,
  geocoding_provider text,
  geocoding_precision text,
  geocoded_at timestamptz,
  is_primary boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from),
  check (extensions.st_dwithin(location, extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography, 1))
);

create unique index venue_addresses_one_current_primary_idx
  on public.venue_addresses (venue_id)
  where is_primary and valid_until is null;

create table public.venue_contacts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  kind public.contact_kind not null,
  value text not null check (char_length(value) between 3 and 500),
  normalized_value text not null,
  is_official boolean not null default false,
  is_primary boolean not null default false,
  verification_status public.verification_status not null default 'unverified',
  verified_at timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, kind, normalized_value),
  check (
    (kind = 'phone' and value ~ '^\+[1-9][0-9]{6,14}$')
    or (kind = 'email' and value ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (kind in ('website', 'instagram', 'facebook', 'tiktok', 'other_social') and private.is_safe_public_https_url(value))
  ),
  check (valid_until is null or verified_at is null or valid_until > verified_at)
);

create unique index venue_contacts_one_primary_per_kind_idx
  on public.venue_contacts (venue_id, kind)
  where is_primary;

create table public.venue_hours (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  sequence smallint not null default 1 check (sequence between 1 and 8),
  opens_at time,
  closes_at time,
  closes_next_day boolean not null default false,
  is_closed boolean not null default false,
  valid_from date not null default current_date,
  valid_until date,
  timezone text not null default 'Europe/Rome' check (timezone = 'Europe/Rome'),
  verified_at timestamptz,
  unique (venue_id, weekday, sequence, valid_from),
  check ((is_closed and opens_at is null and closes_at is null) or (not is_closed and opens_at is not null and closes_at is not null)),
  check (valid_until is null or valid_until >= valid_from)
);

create table public.venue_hour_exceptions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  exception_date date not null,
  sequence smallint not null default 1 check (sequence between 1 and 8),
  opens_at time,
  closes_at time,
  closes_next_day boolean not null default false,
  is_closed boolean not null default false,
  note text,
  verified_at timestamptz,
  unique (venue_id, exception_date, sequence),
  check ((is_closed and opens_at is null and closes_at is null) or (not is_closed and opens_at is not null and closes_at is not null))
);

create table public.venue_prices (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  currency char(3) not null default 'EUR' check (currency = 'EUR'),
  price_level smallint check (price_level between 1 and 4),
  average_spend_cents integer check (average_spend_cents between 0 and 1000000),
  minimum_spend_cents integer check (minimum_spend_cents between 0 and 1000000),
  maximum_spend_cents integer check (maximum_spend_cents between 0 and 1000000),
  pricing_note text,
  verified_at timestamptz,
  valid_until timestamptz,
  updated_at timestamptz not null default now(),
  check (minimum_spend_cents is null or maximum_spend_cents is null or minimum_spend_cents <= maximum_spend_cents),
  check (valid_until is null or verified_at is null or valid_until > verified_at)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique,
  description text,
  active boolean not null default true
);

create table public.venue_services (
  venue_id uuid not null references public.venues(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  available boolean not null default true,
  details text,
  verification_status public.verification_status not null default 'unverified',
  verified_at timestamptz,
  primary key (venue_id, service_id)
);

create table public.venue_images (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  storage_path text,
  external_url text,
  alt_text text not null check (char_length(alt_text) between 3 and 300),
  caption text,
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  mime_type text not null check (mime_type in ('image/avif', 'image/webp', 'image/jpeg', 'image/png')),
  rights_status public.image_rights_status not null default 'unknown',
  rights_holder text,
  license_name text,
  license_url text,
  attribution_text text,
  source_url text,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  is_primary boolean not null default false,
  display_order smallint not null default 100,
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check ((storage_path is not null)::integer + (external_url is not null)::integer = 1),
  check (external_url is null or external_url ~ '^https://'),
  check (source_url is null or source_url ~ '^https://'),
  check (rights_status in ('unknown', 'rejected') or (rights_holder is not null and approved_at is not null)),
  check (expires_at is null or approved_at is null or expires_at > approved_at)
);

create unique index venue_images_one_primary_idx on public.venue_images (venue_id) where is_primary;

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null,
  venue_id uuid references public.venues(id) on delete set null,
  source_url text,
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  raw_payload jsonb,
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fetched_at timestamptz not null,
  expires_at timestamptz,
  deleted_at_source boolean not null default false,
  unique (source_id, external_id),
  check (source_url is null or source_url ~ '^https://'),
  check (expires_at is null or expires_at > fetched_at)
);

create table public.source_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null,
  observation_kind text not null check (observation_kind in ('administrative_activity', 'poi', 'closure_signal', 'address_signal')),
  source_label text,
  formatted_address text,
  normalized_address text,
  municipality_id smallint references public.municipalities(id) on delete restrict,
  neighborhood_label text,
  latitude double precision check (latitude is null or latitude between 45.30 and 45.65),
  longitude double precision check (longitude is null or longitude between 8.90 and 9.45),
  location extensions.geography(point, 4326),
  observed_through date,
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  candidate_status text not null default 'unreviewed' check (candidate_status in ('unreviewed', 'linked', 'rejected', 'stale')),
  linked_venue_id uuid references public.venues(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_id, external_id),
  check ((latitude is null and longitude is null and location is null) or (latitude is not null and longitude is not null and location is not null)),
  check (location is null or extensions.st_dwithin(location, extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography, 1))
);

create table public.venue_field_sources (
  venue_id uuid not null references public.venues(id) on delete cascade,
  field_path text not null check (field_path ~ '^[a-z][a-z0-9_.]*$'),
  source_record_id uuid not null references public.source_records(id) on delete restrict,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  observed_at timestamptz not null,
  valid_until timestamptz,
  selected boolean not null default true,
  primary key (venue_id, field_path, source_record_id),
  check (valid_until is null or valid_until > observed_at)
);

create unique index venue_field_sources_one_selected_idx
  on public.venue_field_sources (venue_id, field_path)
  where selected;

create table public.review_aggregates (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  rating numeric(3,2) not null check (rating between 0 and 5),
  review_count integer not null check (review_count >= 0),
  rating_scale numeric(3,1) not null default 5 check (rating_scale > 0),
  observed_at timestamptz not null,
  source_url text not null check (source_url ~ '^https://'),
  unique (venue_id, source_id, observed_at)
);

create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  methodology_version text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ranking_entries (
  ranking_id uuid not null references public.rankings(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete restrict,
  rank smallint not null check (rank > 0),
  score numeric(9,6),
  rationale text not null,
  data_snapshot_at timestamptz not null,
  primary key (ranking_id, venue_id),
  unique (ranking_id, rank)
);

create table public.podiums (
  id uuid primary key default gen_random_uuid(),
  query_fingerprint text not null,
  ranking_version text not null,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > generated_at)
);

create table public.podium_entries (
  podium_id uuid not null references public.podiums(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete restrict,
  rank smallint not null check (rank between 1 and 3),
  score numeric(9,6) not null,
  rationale jsonb not null check (jsonb_typeof(rationale) = 'object'),
  primary key (podium_id, rank),
  unique (podium_id, venue_id)
);

create table public.guides (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  dek text,
  body_markdown text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  author_name text not null,
  reviewed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.guide_venues (
  guide_id uuid not null references public.guides(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete restrict,
  display_order smallint not null default 100,
  editorial_note text,
  primary key (guide_id, venue_id)
);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues(id) on delete set null,
  kind public.claim_kind not null default 'correction',
  reporter_email extensions.citext,
  detail text not null check (char_length(detail) between 20 and 4000),
  evidence_urls text[] not null default '{}',
  status public.report_status not null default 'received',
  source_ip_hash text,
  user_agent_hash text,
  privacy_notice_acknowledged_at timestamptz not null,
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (private.are_safe_public_https_urls(evidence_urls)),
  check (retention_until > created_at)
);

create table public.venue_claims (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  kind public.claim_kind not null default 'claim',
  claimant_name text not null check (char_length(claimant_name) between 2 and 160),
  claimant_role text not null check (char_length(claimant_role) between 2 and 160),
  claimant_email extensions.citext not null,
  claimant_email_hash text not null,
  claimant_phone text,
  business_website text,
  detail text not null check (char_length(detail) between 20 and 4000),
  evidence_urls text[] not null default '{}',
  status public.claim_status not null default 'pending',
  identity_verified_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  privacy_notice_acknowledged_at timestamptz not null,
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (claimant_email::text ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check (claimant_phone is null or claimant_phone ~ '^\+[1-9][0-9]{6,14}$'),
  check (business_website is null or private.is_safe_public_https_url(business_website)),
  check (private.are_safe_public_https_urls(evidence_urls)),
  check (retention_until > created_at)
);

create table public.venue_update_history (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues(id) on delete cascade,
  source_record_id uuid references public.source_records(id) on delete set null,
  actor_type text not null check (actor_type in ('pipeline', 'editor', 'claimant', 'system')),
  actor_id uuid,
  change_type text not null,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  venue_id_a uuid not null references public.venues(id) on delete cascade,
  venue_id_b uuid not null references public.venues(id) on delete cascade,
  name_similarity numeric(5,4) check (name_similarity between 0 and 1),
  distance_meters numeric(10,2) check (distance_meters is null or distance_meters >= 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'merged', 'distinct', 'ignored')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (venue_id_a <> venue_id_b),
  unique (venue_id_a, venue_id_b)
);

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  status public.import_run_status not null default 'queued',
  trigger_kind text not null default 'manual' check (trigger_kind in ('manual', 'scheduled', 'webhook', 'retry')),
  requested_by text,
  cursor jsonb,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_created integer not null default 0 check (records_created >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  records_skipped integer not null default 0 check (records_skipped >= 0),
  records_failed integer not null default 0 check (records_failed >= 0),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create table public.import_errors (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  external_id text,
  error_code text not null,
  message text not null,
  retryable boolean not null default false,
  payload_excerpt jsonb,
  occurred_at timestamptz not null default now()
);

create table public.import_queue (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  source_record_external_id text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed', 'dead_letter')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.api_rate_limits (
  bucket_key text not null,
  route_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (bucket_key, route_key, window_started_at),
  check (expires_at > window_started_at)
);

-- Spatial, text and operational indexes reflect the actual API access paths.
create index municipalities_boundary_gist_idx on public.municipalities using gist (boundary);
create index neighborhoods_boundary_gist_idx on public.neighborhoods using gist (boundary);
create index neighborhoods_centroid_gist_idx on public.neighborhoods using gist (centroid);
create index venue_addresses_location_gist_idx on public.venue_addresses using gist (location);
create index venue_addresses_normalized_trgm_idx on public.venue_addresses using gin (normalized_address extensions.gin_trgm_ops);
create index venues_search_document_gin_idx on public.venues using gin (search_document);
create index venues_display_name_trgm_idx on public.venues using gin (display_name extensions.gin_trgm_ops);
create index venues_public_filter_idx on public.venues (category_id, maturity, quality_score desc, id)
  where lifecycle_status = 'active' and verification_status = 'verified' and published_at is not null;
create index venues_stale_idx on public.venues (stale_after) where lifecycle_status in ('active', 'temporarily_closed');
create index venue_contacts_lookup_idx on public.venue_contacts (venue_id, kind, verification_status);
create index venue_hours_lookup_idx on public.venue_hours (venue_id, weekday, valid_from, valid_until);
create index venue_hour_exceptions_lookup_idx on public.venue_hour_exceptions (venue_id, exception_date);
create index venue_services_service_idx on public.venue_services (service_id, venue_id) where available;
create index source_records_venue_idx on public.source_records (venue_id, last_seen_at desc);
create index source_records_expiry_idx on public.source_records (expires_at) where expires_at is not null;
create index source_observations_location_gist_idx on public.source_observations using gist (location);
create index source_observations_review_idx on public.source_observations (candidate_status, source_id, last_seen_at desc);
create index review_aggregates_latest_idx on public.review_aggregates (venue_id, source_id, observed_at desc);
create index podiums_lookup_idx on public.podiums (query_fingerprint, ranking_version, expires_at, generated_at desc);
create index venue_claims_status_idx on public.venue_claims (status, created_at);
create index venue_claims_email_hash_idx on public.venue_claims (claimant_email_hash, created_at desc);
create index user_reports_status_idx on public.user_reports (status, created_at);
create index update_history_venue_idx on public.venue_update_history (venue_id, created_at desc);
create index import_runs_due_idx on public.import_runs (status, next_retry_at, created_at);
create index import_queue_claim_idx on public.import_queue (status, available_at, id);
create index api_rate_limits_expiry_idx on public.api_rate_limits (expires_at);

comment on table public.review_aggregates is 'Source-specific aggregates only. Never blend or republish individual reviews without a compatible license.';
comment on table public.venue_images is 'Only approved, attributable, licensed/owned media may be published.';
comment on column public.source_records.raw_payload is 'Retain only for the source-specific period and only when the source license/terms allow it.';

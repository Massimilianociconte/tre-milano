-- Editorial workflow for official first-party facts. Automated ingestion stays
-- draft-only; this explicit service-role action validates and publishes a
-- record after a human/source review. No third-party review or media data is
-- promoted by this workflow.

insert into public.neighborhoods(
  municipality_id,
  slug,
  name,
  aliases,
  centroid,
  published
) values
  (1, 'duomo', 'Duomo', array['Centro storico', 'Piazza del Duomo'], extensions.st_setsrid(extensions.st_makepoint(9.1900, 45.4647), 4326)::extensions.geography, true),
  (1, 'porta-venezia', 'Porta Venezia', array['Porta Orientale'], extensions.st_setsrid(extensions.st_makepoint(9.2057, 45.4730), 4326)::extensions.geography, true),
  (8, 'monumentale', 'Monumentale', array['Ceresio', 'Cimitero Monumentale'], extensions.st_setsrid(extensions.st_makepoint(9.1803, 45.4835), 4326)::extensions.geography, true),
  (1, 'brera', 'Brera', array['Borgonuovo'], extensions.st_setsrid(extensions.st_makepoint(9.1889, 45.4721), 4326)::extensions.geography, true),
  (1, 'quadrilatero-della-moda', 'Quadrilatero della moda', array['Montenapoleone', 'Via Manzoni'], extensions.st_setsrid(extensions.st_makepoint(9.1940, 45.4699), 4326)::extensions.geography, true)
on conflict (slug) do update set
  municipality_id = excluded.municipality_id,
  name = excluded.name,
  aliases = excluded.aliases,
  centroid = excluded.centroid,
  published = excluded.published,
  updated_at = now();

-- This source accepts only manually assembled facts from a venue's own
-- website. Enabling it allows draft ingestion; publication still requires the
-- review RPC below.
update public.sources
set enabled = true,
    requires_manual_review = true,
    updated_at = now()
where source_key = 'official_venue_facts';

create or replace function public.review_official_venue_record(
  p_source_key text,
  p_external_id text,
  p_reviewer text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_source public.sources%rowtype;
  v_geo_source public.sources%rowtype;
  v_record public.source_records%rowtype;
  v_geo_record_id uuid;
  v_payload jsonb;
  v_geo_payload jsonb;
  v_venue_id uuid;
  v_slug text;
  v_geo_external_id text;
  v_geo_url text;
  v_stale_days integer;
  v_hours_count integer;
begin
  if char_length(trim(coalesce(p_reviewer, ''))) not between 3 and 120
    or char_length(trim(coalesce(p_external_id, ''))) not between 1 and 300 then
    raise exception 'invalid_editorial_review' using errcode = '22023';
  end if;

  select * into v_source
  from public.sources
  where source_key = p_source_key
    and enabled
    and kind in ('official_website', 'official_social')
    and commercial_use_allowed
    and derivative_use_allowed;

  if not found then
    raise exception 'official_source_not_approved' using errcode = '42501';
  end if;

  select sr.* into v_record
  from public.source_records sr
  where sr.source_id = v_source.id
    and sr.external_id = p_external_id
    and sr.venue_id is not null
    and not sr.deleted_at_source
    and (sr.expires_at is null or sr.expires_at > now())
  for update;

  if not found or v_record.source_url is null
    or not private.is_safe_public_https_url(v_record.source_url) then
    raise exception 'official_source_record_not_reviewable' using errcode = '22023';
  end if;

  v_payload := v_record.normalized_payload;
  v_venue_id := v_record.venue_id;
  v_slug := trim(coalesce(v_payload->>'canonicalSlug', ''));
  v_stale_days := coalesce(nullif(v_payload->>'staleDays', '')::integer, 60);
  v_hours_count := case
    when jsonb_typeof(v_payload->'weeklyHours') = 'array'
      then jsonb_array_length(v_payload->'weeklyHours')
    else 0
  end;
  v_geo_external_id := trim(coalesce(v_payload #>> '{address,geocodingExternalId}', ''));
  v_geo_url := trim(coalesce(v_payload #>> '{address,geocodingSourceUrl}', ''));

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(v_slug) > 120
    or v_stale_days not between 14 and 180
    or v_hours_count not between 1 and 56 then
    raise exception 'official_review_payload_invalid' using errcode = '22023';
  end if;

  if char_length(v_geo_external_id) not between 3 and 256
    or not private.is_safe_public_https_url(v_geo_url) then
    raise exception 'geocoding_provenance_required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.duplicate_candidates candidate
    where candidate.status = 'pending'
      and v_venue_id in (candidate.venue_id_a, candidate.venue_id_b)
  ) then
    raise exception 'duplicate_review_required' using errcode = '55000';
  end if;

  -- Replace only the current weekly schedule. Historical rows are retained by
  -- the source record and the venue update log, while the public schedule is
  -- kept unambiguous.
  delete from public.venue_hours where venue_id = v_venue_id;

  insert into public.venue_hours(
    venue_id,
    weekday,
    sequence,
    opens_at,
    closes_at,
    closes_next_day,
    is_closed,
    valid_from,
    verified_at
  )
  select
    v_venue_id,
    (hour_entry->>'weekday')::smallint,
    coalesce(nullif(hour_entry->>'sequence', '')::smallint, 1),
    case when coalesce((hour_entry->>'isClosed')::boolean, false)
      then null else (hour_entry->>'opensAt')::time end,
    case when coalesce((hour_entry->>'isClosed')::boolean, false)
      then null else (hour_entry->>'closesAt')::time end,
    coalesce((hour_entry->>'closesNextDay')::boolean, false),
    coalesce((hour_entry->>'isClosed')::boolean, false),
    current_date,
    now()
  from jsonb_array_elements(v_payload->'weeklyHours') hour_entry;

  update public.venue_contacts
  set is_official = true,
      verification_status = 'verified',
      verified_at = now(),
      updated_at = now()
  where venue_id = v_venue_id
    and is_official
    and valid_until is null;

  if not exists (
    select 1 from public.venue_contacts contact
    where contact.venue_id = v_venue_id
      and contact.verification_status = 'verified'
      and contact.kind = 'website'
  ) then
    raise exception 'official_website_contact_required' using errcode = '22023';
  end if;

  update public.venue_services
  set verification_status = 'verified',
      verified_at = now()
  where venue_id = v_venue_id and available;

  if jsonb_typeof(v_payload->'price') = 'object'
    and nullif(v_payload #>> '{price,level}', '') is not null then
    update public.venue_prices
    set verified_at = now(),
        valid_until = now() + make_interval(days => v_stale_days),
        updated_at = now()
    where venue_id = v_venue_id;
  end if;

  insert into public.venue_field_sources(
    venue_id,
    field_path,
    source_record_id,
    confidence,
    observed_at,
    valid_until,
    selected
  )
  select
    v_venue_id,
    fact.field_path,
    v_record.id,
    v_source.reliability_score,
    v_record.fetched_at,
    v_record.expires_at,
    true
  from unnest(array[
    'address', 'contacts', 'description', 'hours', 'services'
  ]) as fact(field_path)
  on conflict (venue_id, field_path, source_record_id) do update set
    confidence = excluded.confidence,
    observed_at = excluded.observed_at,
    valid_until = excluded.valid_until,
    selected = true;

  -- Coordinates are attributed separately from venue-owned facts. The OSM
  -- source remains excluded from automatic catalog promotion; this record is
  -- provenance for the one-off manual Nominatim lookup only.
  select * into v_geo_source
  from public.sources
  where source_key = 'openstreetmap';

  if not found then
    raise exception 'geocoding_source_missing' using errcode = '55000';
  end if;

  v_geo_payload := jsonb_build_object(
    'provider', v_payload #>> '{address,geocodingProvider}',
    'externalId', v_geo_external_id,
    'sourceUrl', v_geo_url,
    'attribution', v_payload #>> '{address,geocodingAttribution}',
    'latitude', v_payload #>> '{address,latitude}',
    'longitude', v_payload #>> '{address,longitude}',
    'geocodedAt', v_payload #>> '{address,geocodedAt}'
  );

  insert into public.source_records(
    source_id,
    external_id,
    venue_id,
    source_url,
    payload_checksum,
    raw_payload,
    normalized_payload,
    fetched_at,
    expires_at,
    last_seen_at
  ) values (
    v_geo_source.id,
    v_geo_external_id,
    v_venue_id,
    v_geo_url,
    encode(extensions.digest(v_geo_payload::text, 'sha256'), 'hex'),
    null,
    v_geo_payload,
    coalesce(nullif(v_payload #>> '{address,geocodedAt}', '')::timestamptz, now()),
    now() + interval '180 days',
    now()
  )
  on conflict (source_id, external_id) do update set
    venue_id = excluded.venue_id,
    source_url = excluded.source_url,
    payload_checksum = excluded.payload_checksum,
    normalized_payload = excluded.normalized_payload,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    last_seen_at = now(),
    deleted_at_source = false
  returning id into v_geo_record_id;

  insert into public.venue_field_sources(
    venue_id,
    field_path,
    source_record_id,
    confidence,
    observed_at,
    valid_until,
    selected
  ) values (
    v_venue_id,
    'address.geolocation',
    v_geo_record_id,
    v_geo_source.reliability_score,
    now(),
    now() + interval '180 days',
    true
  )
  on conflict (venue_id, field_path, source_record_id) do update set
    confidence = excluded.confidence,
    observed_at = excluded.observed_at,
    valid_until = excluded.valid_until,
    selected = true;

  update public.venues
  set slug = v_slug,
      lifecycle_status = 'active',
      verification_status = 'verified',
      verified_at = now(),
      published_at = coalesce(published_at, now()),
      stale_after = now() + make_interval(days => v_stale_days),
      recommendation_eligible = false,
      last_seen_at = greatest(last_seen_at, v_record.last_seen_at),
      updated_at = now()
  where id = v_venue_id;

  perform private.refresh_venue_quality(v_venue_id);

  insert into public.venue_update_history(
    venue_id,
    source_record_id,
    actor_type,
    change_type,
    new_values,
    reason
  ) values (
    v_venue_id,
    v_record.id,
    'editor',
    'official_facts_verified_and_published',
    jsonb_build_object(
      'source', p_source_key,
      'externalId', p_external_id,
      'reviewer', trim(p_reviewer),
      'staleDays', v_stale_days
    ),
    'Official first-party facts reviewed; third-party ratings and media excluded'
  );

  return jsonb_build_object(
    'status', 'published',
    'venueId', v_venue_id,
    'slug', v_slug,
    'verifiedAt', now(),
    'reviewRequiredBy', now() + make_interval(days => v_stale_days)
  );
end;
$$;

revoke all on function public.review_official_venue_record(text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_official_venue_record(text, text, text)
  to service_role;

comment on function public.review_official_venue_record is
  'Service-only editorial gate for current facts imported from official venue websites. It never approves third-party reviews or media.';

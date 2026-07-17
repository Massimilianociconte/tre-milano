-- Constrained service-only catalog API, keyset pagination and fail-closed RLS.

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'municipalities', 'neighborhoods', 'categories', 'sources', 'venues',
    'venue_addresses', 'venue_contacts', 'venue_prices', 'rankings', 'guides',
    'user_reports', 'venue_claims', 'import_runs', 'import_queue'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      table_name || '_touch_updated_at', table_name
    );
  end loop;
end;
$$;

create or replace function private.normalize_identity(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g'));
$$;

revoke all on function private.normalize_identity(text) from public, anon, authenticated;
grant execute on function private.normalize_identity(text) to service_role;

create or replace function public.search_venues(
  p_query text default null,
  p_category_slugs text[] default null,
  p_neighborhood_slugs text[] default null,
  p_service_slugs text[] default null,
  p_min_price_level smallint default null,
  p_max_price_level smallint default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_meters integer default null,
  p_min_latitude double precision default null,
  p_min_longitude double precision default null,
  p_max_latitude double precision default null,
  p_max_longitude double precision default null,
  p_sort text default 'relevance',
  p_after_value double precision default null,
  p_after_id uuid default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  slug text,
  name text,
  short_description text,
  category_slug text,
  category_name text,
  subcategory_slug text,
  neighborhood_slug text,
  neighborhood_name text,
  municipality_id smallint,
  latitude double precision,
  longitude double precision,
  formatted_address text,
  price_level smallint,
  average_spend_cents integer,
  rating numeric,
  review_count bigint,
  review_source_count bigint,
  rating_sources jsonb,
  image_url text,
  image_alt text,
  service_slugs text[],
  maturity public.maturity_tier,
  quality_score numeric,
  confidence_score numeric,
  verified_at timestamptz,
  distance_meters double precision,
  relevance_score double precision,
  sort_value double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_query is not null and char_length(p_query) > 200 then
    raise exception 'query_too_long' using errcode = '22023';
  end if;
  if p_sort not in ('relevance', 'distance', 'price', 'rating', 'quality') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 51 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'incomplete_origin' using errcode = '22023';
  end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'invalid_origin' using errcode = '22023';
  end if;
  if p_radius_meters is not null and (p_latitude is null or p_radius_meters < 100 or p_radius_meters > 50000) then
    raise exception 'invalid_radius' using errcode = '22023';
  end if;
  if num_nonnulls(p_min_latitude, p_min_longitude, p_max_latitude, p_max_longitude) not in (0, 4) then
    raise exception 'incomplete_bbox' using errcode = '22023';
  end if;
  if p_min_latitude is not null and (
    p_min_latitude >= p_max_latitude or p_min_longitude >= p_max_longitude
    or p_min_latitude not between -90 and 90 or p_max_latitude not between -90 and 90
    or p_min_longitude not between -180 and 180 or p_max_longitude not between -180 and 180
  ) then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;

  return query
  with base as (
    select
      v.id,
      v.slug,
      v.display_name as name,
      v.short_description,
      c.slug as category_slug,
      c.name as category_name,
      sc.slug as subcategory_slug,
      n.slug as neighborhood_slug,
      n.name as neighborhood_name,
      a.municipality_id,
      a.latitude,
      a.longitude,
      a.formatted_address,
      vp.price_level,
      vp.average_spend_cents,
      reviews.rating,
      reviews.review_count,
      reviews.source_count as review_source_count,
      reviews.rating_sources,
      image.image_url,
      image.alt_text as image_alt,
      services.service_slugs,
      v.maturity,
      v.quality_score,
      v.confidence_score,
      v.verified_at,
      case when p_latitude is null then null else
        extensions.st_distance(
          a.location,
          extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography
        )
      end as distance_meters,
      case when nullif(trim(p_query), '') is null then 0::double precision else
        (
          ts_rank_cd(v.search_document, websearch_to_tsquery('italian', p_query), 32)::double precision * 0.8
          + extensions.similarity(v.display_name, p_query)::double precision * 0.2
        )
      end as relevance_score
    from public.venues v
    join public.categories c on c.id = v.category_id and c.active
    left join public.subcategories sc on sc.id = v.subcategory_id and sc.active
    join public.venue_addresses a on a.venue_id = v.id and a.is_primary and a.valid_until is null
    left join public.neighborhoods n on n.id = a.neighborhood_id
    left join public.venue_prices vp on vp.venue_id = v.id
      and vp.verified_at is not null and (vp.valid_until is null or vp.valid_until > now())
    left join lateral (
      select
        round(sum(latest.rating * latest.review_count)::numeric / nullif(sum(latest.review_count), 0), 2) as rating,
        sum(latest.review_count)::bigint as review_count,
        count(*)::bigint as source_count,
        jsonb_agg(jsonb_build_object(
          'sourceKey', src.source_key, 'sourceName', src.name, 'value', latest.rating,
          'scale', latest.rating_scale, 'count', latest.review_count,
          'observedAt', latest.observed_at, 'sourceUrl', latest.source_url
        ) order by src.priority, src.name) as rating_sources
      from (
        select distinct on (ra.source_id) ra.source_id, ra.rating, ra.rating_scale, ra.review_count, ra.observed_at, ra.source_url
        from public.review_aggregates ra
        where ra.venue_id = v.id
        order by ra.source_id, ra.observed_at desc
      ) latest
      join public.sources src on src.id = latest.source_id
    ) reviews on true
    left join lateral (
      select coalesce(vi.external_url, '/storage/v1/object/public/venue-media/' || vi.storage_path) as image_url, vi.alt_text
      from public.venue_images vi
      where vi.venue_id = v.id
        and vi.is_primary
        and vi.approved_at is not null
        and vi.rights_status in ('owned', 'licensed', 'official_permission', 'open_license')
        and (vi.expires_at is null or vi.expires_at > now())
      limit 1
    ) image on true
    left join lateral (
      select coalesce(array_agg(s.slug order by s.slug), '{}') as service_slugs
      from public.venue_services vs
      join public.services s on s.id = vs.service_id and s.active
      where vs.venue_id = v.id and vs.available and vs.verification_status = 'verified'
    ) services on true
    where v.lifecycle_status = 'active'
      and v.verification_status = 'verified'
      and v.published_at is not null
      and (v.stale_after is null or v.stale_after > now())
      and (p_category_slugs is null or c.slug = any(p_category_slugs))
      and (p_neighborhood_slugs is null or n.slug = any(p_neighborhood_slugs))
      and (p_min_price_level is null or vp.price_level >= p_min_price_level)
      and (p_max_price_level is null or vp.price_level <= p_max_price_level)
      and (p_service_slugs is null or not exists (
        select 1 from unnest(p_service_slugs) requested(slug)
        where not exists (
          select 1 from public.venue_services vs2
          join public.services s2 on s2.id = vs2.service_id
          where vs2.venue_id = v.id and vs2.available and vs2.verification_status = 'verified' and s2.slug = requested.slug
        )
      ))
      and (nullif(trim(p_query), '') is null or (
        v.search_document @@ websearch_to_tsquery('italian', p_query)
        or extensions.similarity(v.display_name, p_query) >= 0.24
      ))
      and (p_radius_meters is null or extensions.st_dwithin(
        a.location,
        extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography,
        p_radius_meters
      ))
      and (p_min_latitude is null or extensions.st_intersects(
        a.location::extensions.geometry,
        extensions.st_makeenvelope(p_min_longitude, p_min_latitude, p_max_longitude, p_max_latitude, 4326)
      ))
  ), scored as (
    select base.*,
      case p_sort
        when 'distance' then coalesce(base.distance_meters, 1e15)
        when 'price' then coalesce(base.average_spend_cents::double precision, 1e15)
        when 'rating' then coalesce(base.rating::double precision, -1)
        when 'quality' then base.quality_score::double precision
        else base.relevance_score
      end as sort_value
    from base
  )
  select scored.*
  from scored
  where p_after_value is null or p_after_id is null or
    case when p_sort in ('distance', 'price') then
      scored.sort_value > p_after_value or (scored.sort_value = p_after_value and scored.id > p_after_id)
    else
      scored.sort_value < p_after_value or (scored.sort_value = p_after_value and scored.id > p_after_id)
    end
  order by
    case when p_sort in ('distance', 'price') then scored.sort_value end asc nulls last,
    case when p_sort not in ('distance', 'price') then scored.sort_value end desc nulls last,
    scored.id asc
  limit p_limit;
end;
$$;

create or replace function public.get_venue_detail(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'slug', v.slug,
    'name', v.display_name,
    'officialName', v.official_name,
    'description', v.description,
    'shortDescription', v.short_description,
    'category', jsonb_build_object('slug', c.slug, 'name', c.name),
    'subcategory', case when sc.id is null then null else jsonb_build_object('slug', sc.slug, 'name', sc.name) end,
    'status', v.lifecycle_status,
    'verification', jsonb_build_object(
      'status', v.verification_status, 'maturity', v.maturity, 'qualityScore', v.quality_score,
      'completenessScore', v.completeness_score, 'confidenceScore', v.confidence_score,
      'verifiedAt', v.verified_at, 'staleAfter', v.stale_after
    ),
    'address', jsonb_build_object(
      'formatted', a.formatted_address, 'streetName', a.street_name, 'streetNumber', a.street_number,
      'postalCode', a.postal_code, 'locality', a.locality, 'municipality', a.municipality_id,
      'neighborhood', case when n.id is null then null else jsonb_build_object('slug', n.slug, 'name', n.name) end,
      'latitude', a.latitude, 'longitude', a.longitude
    ),
    'price', case when vp.venue_id is null then null else jsonb_build_object(
      'currency', vp.currency, 'level', vp.price_level, 'averageSpendCents', vp.average_spend_cents,
      'minimumSpendCents', vp.minimum_spend_cents, 'maximumSpendCents', vp.maximum_spend_cents,
      'note', vp.pricing_note, 'verifiedAt', vp.verified_at, 'validUntil', vp.valid_until
    ) end,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', vc.kind, 'value', vc.value, 'official', vc.is_official, 'primary', vc.is_primary) order by vc.is_primary desc, vc.kind)
      from public.venue_contacts vc
      where vc.venue_id = v.id and vc.verification_status = 'verified' and (vc.valid_until is null or vc.valid_until > now())
    ), '[]'::jsonb),
    'weeklyHours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', vh.weekday, 'sequence', vh.sequence, 'opensAt', vh.opens_at,
        'closesAt', vh.closes_at, 'closesNextDay', vh.closes_next_day, 'closed', vh.is_closed
      ) order by vh.weekday, vh.sequence)
      from public.venue_hours vh
      where vh.venue_id = v.id and current_date between vh.valid_from and coalesce(vh.valid_until, 'infinity'::date)
    ), '[]'::jsonb),
    'hourExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', ve.exception_date, 'sequence', ve.sequence, 'opensAt', ve.opens_at,
        'closesAt', ve.closes_at, 'closesNextDay', ve.closes_next_day, 'closed', ve.is_closed, 'note', ve.note
      ) order by ve.exception_date, ve.sequence)
      from public.venue_hour_exceptions ve
      where ve.venue_id = v.id and ve.exception_date between current_date and current_date + 90
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name, 'details', vs.details) order by s.name)
      from public.venue_services vs join public.services s on s.id = vs.service_id
      where vs.venue_id = v.id and vs.available and vs.verification_status = 'verified' and s.active
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'url', coalesce(vi.external_url, '/storage/v1/object/public/venue-media/' || vi.storage_path),
        'alt', vi.alt_text, 'caption', vi.caption, 'width', vi.width, 'height', vi.height,
        'rights', vi.rights_status, 'rightsHolder', vi.rights_holder, 'attribution', vi.attribution_text
      ) order by vi.is_primary desc, vi.display_order)
      from public.venue_images vi
      where vi.venue_id = v.id and vi.approved_at is not null
        and vi.rights_status in ('owned', 'licensed', 'official_permission', 'open_license')
        and (vi.expires_at is null or vi.expires_at > now())
    ), '[]'::jsonb),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', src.name, 'rating', latest.rating, 'scale', latest.rating_scale,
        'reviewCount', latest.review_count, 'observedAt', latest.observed_at, 'sourceUrl', latest.source_url
      ) order by src.priority, src.name)
      from (
        select distinct on (ra.source_id) ra.* from public.review_aggregates ra
        where ra.venue_id = v.id order by ra.source_id, ra.observed_at desc
      ) latest join public.sources src on src.id = latest.source_id
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'name', src.name, 'kind', src.kind, 'url', src.base_url,
        'license', src.license_name, 'licenseUrl', src.license_url,
        'attribution', src.attribution_text, 'lastObservedAt', sr.last_seen_at
      ))
      from public.source_records sr join public.sources src on src.id = sr.source_id
      where sr.venue_id = v.id
    ), '[]'::jsonb)
  )
  from public.venues v
  join public.categories c on c.id = v.category_id
  left join public.subcategories sc on sc.id = v.subcategory_id
  join public.venue_addresses a on a.venue_id = v.id and a.is_primary and a.valid_until is null
  left join public.neighborhoods n on n.id = a.neighborhood_id
  left join public.venue_prices vp on vp.venue_id = v.id
    and vp.verified_at is not null and (vp.valid_until is null or vp.valid_until > now())
  where v.slug = p_slug
    and v.lifecycle_status in ('active', 'temporarily_closed')
    and v.verification_status = 'verified'
    and v.published_at is not null
    and (v.stale_after is null or v.stale_after > now())
  limit 1;
$$;

create or replace function public.catalog_facets(
  p_min_latitude double precision default null,
  p_min_longitude double precision default null,
  p_max_latitude double precision default null,
  p_max_longitude double precision default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as (
    select v.id, c.slug category_slug, c.name category_name, n.slug neighborhood_slug, n.name neighborhood_name, vp.price_level
    from public.venues v
    join public.categories c on c.id = v.category_id and c.active
    join public.venue_addresses a on a.venue_id = v.id and a.is_primary and a.valid_until is null
    left join public.neighborhoods n on n.id = a.neighborhood_id
    left join public.venue_prices vp on vp.venue_id = v.id
      and vp.verified_at is not null and (vp.valid_until is null or vp.valid_until > now())
    where v.lifecycle_status = 'active' and v.verification_status = 'verified' and v.published_at is not null
      and (v.stale_after is null or v.stale_after > now())
      and (p_min_latitude is null or extensions.st_intersects(
        a.location::extensions.geometry,
        extensions.st_makeenvelope(p_min_longitude, p_min_latitude, p_max_longitude, p_max_latitude, 4326)
      ))
  )
  select jsonb_build_object(
    'total', (select count(*) from eligible),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('slug', category_slug, 'name', category_name, 'count', count) order by count desc, category_name)
      from (select category_slug, category_name, count(*) count from eligible group by category_slug, category_name) x), '[]'::jsonb),
    'neighborhoods', coalesce((select jsonb_agg(jsonb_build_object('slug', neighborhood_slug, 'name', neighborhood_name, 'count', count) order by count desc, neighborhood_name)
      from (select neighborhood_slug, neighborhood_name, count(*) count from eligible where neighborhood_slug is not null group by neighborhood_slug, neighborhood_name) x), '[]'::jsonb),
    'priceLevels', coalesce((select jsonb_agg(jsonb_build_object('level', price_level, 'count', count) order by price_level)
      from (select price_level, count(*) count from eligible where price_level is not null group by price_level) x), '[]'::jsonb)
  );
$$;

create or replace function public.consume_api_rate_limit(
  p_bucket_key text,
  p_route_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, request_count integer, retry_after_seconds integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if char_length(p_bucket_key) not between 16 and 128 or char_length(p_route_key) not between 1 and 100
    or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_rate_limit' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits(bucket_key, route_key, window_started_at, request_count, expires_at)
  values (p_bucket_key, p_route_key, v_window, 1, v_window + make_interval(secs => p_window_seconds * 2))
  on conflict (bucket_key, route_key, window_started_at)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning public.api_rate_limits.request_count into v_count;
  return query select v_count <= p_limit, v_count,
    greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - v_now)))::integer);
end;
$$;

create or replace function public.submit_venue_claim(
  p_venue_slug text,
  p_kind public.claim_kind,
  p_claimant_name text,
  p_claimant_role text,
  p_claimant_email text,
  p_claimant_phone text,
  p_business_website text,
  p_detail text,
  p_evidence_urls text[],
  p_notice_acknowledged_at timestamptz,
  p_retention_days integer default 365
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_venue_id uuid;
  v_claim_id uuid;
  v_email text := lower(trim(p_claimant_email));
begin
  if p_retention_days not between 30 and 1095 or p_notice_acknowledged_at is null or p_notice_acknowledged_at > now() + interval '5 minutes' then
    raise exception 'invalid_privacy_notice_acknowledgement' using errcode = '22023';
  end if;
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(trim(p_claimant_name)) not between 2 and 160
    or char_length(trim(p_claimant_role)) not between 2 and 160
    or char_length(trim(p_detail)) not between 20 and 4000
    or coalesce(array_length(p_evidence_urls, 1), 0) > 8
    or exists (select 1 from unnest(coalesce(p_evidence_urls, '{}')) u where u !~ '^https://') then
    raise exception 'invalid_claim' using errcode = '22023';
  end if;
  select id into v_venue_id from public.venues where slug = p_venue_slug limit 1;
  if v_venue_id is null then
    raise exception 'venue_not_found' using errcode = 'P0002';
  end if;
  insert into public.venue_claims(
    venue_id, kind, claimant_name, claimant_role, claimant_email, claimant_email_hash,
    claimant_phone, business_website, detail, evidence_urls, privacy_notice_acknowledged_at, retention_until
  ) values (
    v_venue_id, p_kind, trim(p_claimant_name), trim(p_claimant_role), v_email,
    encode(extensions.digest(v_email, 'sha256'), 'hex'), nullif(trim(p_claimant_phone), ''),
    nullif(trim(p_business_website), ''), trim(p_detail), coalesce(p_evidence_urls, '{}'),
    p_notice_acknowledged_at, now() + make_interval(days => p_retention_days)
  ) returning id into v_claim_id;
  return v_claim_id;
end;
$$;

-- Data API is explicitly service-only. RLS is enabled and forced as defense in depth.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'municipalities', 'neighborhoods', 'categories', 'subcategories', 'sources', 'venues',
    'venue_addresses', 'venue_contacts', 'venue_hours', 'venue_hour_exceptions', 'venue_prices',
    'services', 'venue_services', 'venue_images', 'source_records', 'source_observations', 'venue_field_sources',
    'review_aggregates', 'rankings', 'ranking_entries', 'podiums', 'podium_entries', 'guides',
    'guide_venues', 'user_reports', 'venue_claims', 'venue_update_history', 'duplicate_candidates',
    'import_runs', 'import_errors', 'import_queue', 'api_rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.search_venues(text, text[], text[], text[], smallint, smallint, double precision, double precision, integer, double precision, double precision, double precision, double precision, text, double precision, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_venue_detail(text) from public, anon, authenticated;
revoke all on function public.catalog_facets(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.submit_venue_claim(text, public.claim_kind, text, text, text, text, text, text, text[], timestamptz, integer) from public, anon, authenticated;

grant execute on function public.search_venues(text, text[], text[], text[], smallint, smallint, double precision, double precision, integer, double precision, double precision, double precision, double precision, text, double precision, uuid, integer) to service_role;
grant execute on function public.get_venue_detail(text) to service_role;
grant execute on function public.catalog_facets(double precision, double precision, double precision, double precision) to service_role;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.submit_venue_claim(text, public.claim_kind, text, text, text, text, text, text, text[], timestamptz, integer) to service_role;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;

comment on function public.search_venues is 'Service-only keyset-paginated catalog search with PostGIS, FTS and explicit source-safe fields.';
comment on function public.get_venue_detail is 'Service-only public venue passport projection. PII and internal moderation fields are never returned.';

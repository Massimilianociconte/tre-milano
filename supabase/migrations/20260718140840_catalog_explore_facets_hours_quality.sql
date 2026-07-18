-- Align the Explore facets with the explicitly expanded public catalog, keep
-- administrative labels out of publication, and expose verified weekly hours
-- in the list projection without per-venue API queries.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function private.is_clear_administrative_label(p_value text)
returns boolean
language sql
immutable
returns null on null input
set search_path = ''
as $$
  select
    trim(p_value) ~* '^[0-9]{2}(\.[0-9]{2}){1,2}[[:space:]]*-[[:space:]]*'
    or lower(regexp_replace(trim(p_value), '[[:space:]]+', ' ', 'g')) in (
      'ristorazione senza somministrazione',
      'ristorazione senza somministrazione con preparazione di cibi da asporto',
      'produzione di pasticceria fresca',
      'produzione di gelati',
      'produzione di prodotti di pasticceria',
      'gelaterie e pasticcerie',
      'attività di ristorazione senza somministrazione',
      'attivita di ristorazione senza somministrazione',
      'laboratorio per la produzione di alimenti',
      'laboratorio artigianale per la produzione di alimenti'
    )
    or lower(regexp_replace(trim(p_value), '[[:space:]]+', ' ', 'g')) ~
      '^(nuova apertura di )?(laboratorio|produzione) (artigianale )?(di|per la produzione di) (pasticceria|gelati|prodotti alimentari|alimenti)( fresca)?$';
$$;

revoke all on function private.is_clear_administrative_label(text) from public, anon, authenticated;
grant execute on function private.is_clear_administrative_label(text) to service_role;
comment on function private.is_clear_administrative_label is
  'Conservative detector for numeric activity codes and unambiguous licence descriptions; never infers that an ordinary category word is not a trading name.';

create or replace function private.guard_bronze_administrative_label()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.maturity = 'bronze'
    and new.verification_status = 'unverified'
    and new.published_at is not null
    and coalesce(private.is_clear_administrative_label(new.display_name), false) then
    new.published_at := null;
    new.lifecycle_status := 'draft';
    new.recommendation_eligible := false;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_bronze_administrative_label() from public, anon, authenticated;
grant execute on function private.guard_bronze_administrative_label() to service_role;

drop function if exists public.catalog_facets(
  double precision,
  double precision,
  double precision,
  double precision
);

create or replace function public.catalog_facets(
  p_min_latitude double precision default null,
  p_min_longitude double precision default null,
  p_max_latitude double precision default null,
  p_max_longitude double precision default null,
  p_include_unverified boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if num_nonnulls(p_min_latitude, p_min_longitude, p_max_latitude, p_max_longitude) not in (0, 4) then
    raise exception 'incomplete_bbox' using errcode = '22023';
  end if;
  if p_min_latitude is not null and (
    p_min_latitude >= p_max_latitude
    or p_min_longitude >= p_max_longitude
    or p_min_latitude not between -90 and 90
    or p_max_latitude not between -90 and 90
    or p_min_longitude not between -180 and 180
    or p_max_longitude not between -180 and 180
  ) then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;

  with eligible as (
    select
      v.id,
      c.slug as category_slug,
      c.name as category_name,
      sc.slug as subcategory_slug,
      sc.name as subcategory_name,
      n.slug as neighborhood_slug,
      n.name as neighborhood_name,
      vp.price_level
    from public.venues v
    join public.categories c on c.id = v.category_id and c.active
    left join public.subcategories sc on sc.id = v.subcategory_id and sc.active
    join public.venue_addresses a
      on a.venue_id = v.id and a.is_primary and a.valid_until is null
    left join public.neighborhoods n on n.id = a.neighborhood_id
    left join public.venue_prices vp
      on vp.venue_id = v.id
      and vp.verified_at is not null
      and (vp.valid_until is null or vp.valid_until > now())
    where v.lifecycle_status = 'active'
      and v.published_at is not null
      and (
        v.verification_status = 'verified'
        or (p_include_unverified and v.verification_status in ('unverified', 'pending'))
      )
      and (v.stale_after is null or v.stale_after > now())
      and (p_min_latitude is null or extensions.st_intersects(
        a.location::extensions.geometry,
        extensions.st_makeenvelope(
          p_min_longitude,
          p_min_latitude,
          p_max_longitude,
          p_max_latitude,
          4326
        )
      ))
  )
  select jsonb_build_object(
    'total', (select count(*) from eligible),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object('slug', category_slug, 'name', category_name, 'count', category_count)
        order by category_count desc, category_name
      )
      from (
        select category_slug, category_name, count(*) as category_count
        from eligible
        group by category_slug, category_name
      ) category_counts
    ), '[]'::jsonb),
    'subcategories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slug', subcategory_slug,
          'name', subcategory_name,
          'categorySlug', category_slug,
          'count', subcategory_count
        )
        order by subcategory_count desc, subcategory_name
      )
      from (
        select
          subcategory_slug,
          subcategory_name,
          category_slug,
          count(*) as subcategory_count
        from eligible
        where subcategory_slug is not null
        group by subcategory_slug, subcategory_name, category_slug
      ) subcategory_counts
    ), '[]'::jsonb),
    'neighborhoods', coalesce((
      select jsonb_agg(
        jsonb_build_object('slug', neighborhood_slug, 'name', neighborhood_name, 'count', neighborhood_count)
        order by neighborhood_count desc, neighborhood_name
      )
      from (
        select neighborhood_slug, neighborhood_name, count(*) as neighborhood_count
        from eligible
        where neighborhood_slug is not null
        group by neighborhood_slug, neighborhood_name
      ) neighborhood_counts
    ), '[]'::jsonb),
    'priceLevels', coalesce((
      select jsonb_agg(
        jsonb_build_object('level', price_level, 'count', price_count)
        order by price_level
      )
      from (
        select price_level, count(*) as price_count
        from eligible
        where price_level is not null
        group by price_level
      ) price_counts
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object('slug', service_slug, 'name', service_name, 'count', service_count)
        order by service_count desc, service_name
      )
      from (
        select s.slug as service_slug, s.name as service_name, count(distinct e.id) as service_count
        from eligible e
        join public.venue_services vs
          on vs.venue_id = e.id
          and vs.available
          and vs.verification_status = 'verified'
        join public.services s on s.id = vs.service_id and s.active
        group by s.slug, s.name
      ) service_counts
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.catalog_facets(
  double precision,
  double precision,
  double precision,
  double precision,
  boolean
) from public, anon, authenticated;
grant execute on function public.catalog_facets(
  double precision,
  double precision,
  double precision,
  double precision,
  boolean
) to service_role;
comment on function public.catalog_facets is
  'Service-only facets. The explicit include flag mirrors search_venues and keeps the verified-only default backward compatible.';

create or replace function private.catalog_venue_source_attribution(p_venue_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with evidence as (
    select
      sr.source_id,
      sr.last_seen_at as observed_at
    from public.source_records sr
    where sr.venue_id = p_venue_id

    union all

    select
      observation.source_id,
      coalesce(
        (
          observation.observed_through::timestamp + interval '12 hours'
        ) at time zone 'Europe/Rome',
        observation.last_seen_at
      ) as observed_at
    from public.source_observations observation
    where observation.linked_venue_id = p_venue_id
      and observation.candidate_status = 'linked'
  ), attributed as (
    select
      source.id,
      source.name,
      source.kind,
      source.base_url,
      source.license_name,
      source.license_url,
      source.attribution_text,
      source.priority,
      max(evidence.observed_at) as last_observed_at
    from evidence
    join public.sources source on source.id = evidence.source_id
    group by
      source.id,
      source.name,
      source.kind,
      source.base_url,
      source.license_name,
      source.license_url,
      source.attribution_text,
      source.priority
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', attributed.name,
    'kind', attributed.kind,
    'url', attributed.base_url,
    'license', attributed.license_name,
    'licenseUrl', attributed.license_url,
    'attribution', attributed.attribution_text,
    'lastObservedAt', attributed.last_observed_at
  ) order by attributed.priority, attributed.name), '[]'::jsonb)
  from attributed;
$$;

revoke all on function private.catalog_venue_source_attribution(uuid) from public, anon, authenticated;
grant execute on function private.catalog_venue_source_attribution(uuid) to service_role;
comment on function private.catalog_venue_source_attribution is
  'Public-safe attribution derived from source records and linked observations. Never exposes raw payloads, external identifiers or review state.';

create or replace function public.get_venue_detail(p_slug text, p_include_unverified boolean default false)
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
      select jsonb_agg(jsonb_build_object(
        'kind', vc.kind,
        'value', vc.value,
        'official', vc.is_official,
        'primary', vc.is_primary
      ) order by vc.is_primary desc, vc.kind)
      from public.venue_contacts vc
      where vc.venue_id = v.id
        and vc.verification_status = 'verified'
        and (vc.valid_until is null or vc.valid_until > now())
    ), '[]'::jsonb),
    'weeklyHours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', vh.weekday,
        'sequence', vh.sequence,
        'opensAt', vh.opens_at,
        'closesAt', vh.closes_at,
        'closesNextDay', vh.closes_next_day,
        'closed', vh.is_closed
      ) order by vh.weekday, vh.sequence)
      from public.venue_hours vh
      where vh.venue_id = v.id
        and vh.verified_at is not null
        and current_date between vh.valid_from and coalesce(vh.valid_until, 'infinity'::date)
    ), '[]'::jsonb),
    'hourExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', ve.exception_date,
        'sequence', ve.sequence,
        'opensAt', ve.opens_at,
        'closesAt', ve.closes_at,
        'closesNextDay', ve.closes_next_day,
        'closed', ve.is_closed,
        'note', ve.note
      ) order by ve.exception_date, ve.sequence)
      from public.venue_hour_exceptions ve
      where ve.venue_id = v.id
        and ve.verified_at is not null
        and ve.exception_date between current_date and current_date + 90
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', s.slug,
        'name', s.name,
        'details', vs.details
      ) order by s.name)
      from public.venue_services vs
      join public.services s on s.id = vs.service_id
      where vs.venue_id = v.id
        and vs.available
        and vs.verification_status = 'verified'
        and s.active
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'url', coalesce(vi.external_url, '/storage/v1/object/public/venue-media/' || vi.storage_path),
        'alt', vi.alt_text,
        'caption', vi.caption,
        'width', vi.width,
        'height', vi.height,
        'rights', vi.rights_status,
        'rightsHolder', vi.rights_holder,
        'attribution', vi.attribution_text
      ) order by vi.is_primary desc, vi.display_order)
      from public.venue_images vi
      where vi.venue_id = v.id
        and vi.approved_at is not null
        and vi.rights_status in ('owned', 'licensed', 'official_permission', 'open_license')
        and (vi.expires_at is null or vi.expires_at > now())
    ), '[]'::jsonb),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', src.name,
        'rating', latest.rating,
        'scale', latest.rating_scale,
        'reviewCount', latest.review_count,
        'observedAt', latest.observed_at,
        'sourceUrl', latest.source_url
      ) order by src.priority, src.name)
      from (
        select distinct on (ra.source_id) ra.*
        from public.review_aggregates ra
        where ra.venue_id = v.id
        order by ra.source_id, ra.observed_at desc
      ) latest
      join public.sources src on src.id = latest.source_id
    ), '[]'::jsonb),
    'sources', private.catalog_venue_source_attribution(v.id)
  )
  from public.venues v
  join public.categories c on c.id = v.category_id
  left join public.subcategories sc on sc.id = v.subcategory_id
  join public.venue_addresses a
    on a.venue_id = v.id and a.is_primary and a.valid_until is null
  left join public.neighborhoods n on n.id = a.neighborhood_id
  left join public.venue_prices vp
    on vp.venue_id = v.id
    and vp.verified_at is not null
    and (vp.valid_until is null or vp.valid_until > now())
  where v.slug = p_slug
    and v.lifecycle_status in ('active', 'temporarily_closed')
    and v.published_at is not null
    and (
      v.verification_status = 'verified'
      or (p_include_unverified and v.verification_status in ('unverified', 'pending'))
    )
    and (v.stale_after is null or v.stale_after > now())
  limit 1;
$$;

revoke all on function public.get_venue_detail(text, boolean) from public, anon, authenticated;
grant execute on function public.get_venue_detail(text, boolean) to service_role;
comment on function public.get_venue_detail is
  'Service-only venue passport. Linked administrative observations contribute attribution only; internal payloads and identifiers remain private.';

drop function if exists public.search_venues(
  text,
  text[],
  text[],
  text[],
  smallint,
  smallint,
  double precision,
  double precision,
  integer,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  double precision,
  uuid,
  integer,
  boolean
);

create or replace function public.search_venues(
  p_query text default null,
  p_category_slugs text[] default null,
  p_subcategory_slugs text[] default null,
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
  p_after_text text default null,
  p_after_id uuid default null,
  p_limit integer default 24,
  p_include_unverified boolean default false,
  p_open_now boolean default false
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
  weekly_hours jsonb,
  hours_source_url text,
  open_now boolean,
  verification_status public.verification_status,
  maturity public.maturity_tier,
  quality_score numeric,
  confidence_score numeric,
  verified_at timestamptz,
  published_at timestamptz,
  distance_meters double precision,
  relevance_score double precision,
  sort_value double precision,
  sort_text text
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
  if p_sort not in ('relevance', 'distance', 'price', 'rating', 'quality', 'name', 'newest') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 51 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'incomplete_origin' using errcode = '22023';
  end if;
  if p_latitude is not null and (
    p_latitude not between -90 and 90
    or p_longitude not between -180 and 180
  ) then
    raise exception 'invalid_origin' using errcode = '22023';
  end if;
  if p_radius_meters is not null and (
    p_latitude is null
    or p_radius_meters < 100
    or p_radius_meters > 50000
  ) then
    raise exception 'invalid_radius' using errcode = '22023';
  end if;
  if num_nonnulls(p_min_latitude, p_min_longitude, p_max_latitude, p_max_longitude) not in (0, 4) then
    raise exception 'incomplete_bbox' using errcode = '22023';
  end if;
  if p_min_latitude is not null and (
    p_min_latitude >= p_max_latitude
    or p_min_longitude >= p_max_longitude
    or p_min_latitude not between -90 and 90
    or p_max_latitude not between -90 and 90
    or p_min_longitude not between -180 and 180
    or p_max_longitude not between -180 and 180
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
      hours.weekly_hours,
      hours_source.source_url as hours_source_url,
      opening.is_open_now as open_now,
      v.verification_status,
      v.maturity,
      v.quality_score,
      v.confidence_score,
      v.verified_at,
      v.published_at,
      case when p_latitude is null then null else
        extensions.st_distance(
          a.location,
          extensions.st_setsrid(
            extensions.st_makepoint(p_longitude, p_latitude),
            4326
          )::extensions.geography
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
    join public.venue_addresses a
      on a.venue_id = v.id and a.is_primary and a.valid_until is null
    left join public.neighborhoods n on n.id = a.neighborhood_id
    cross join lateral (
      select
        snapshot.local_now::date as local_date,
        snapshot.local_now::time as local_time,
        extract(dow from snapshot.local_now)::smallint as weekday
      from (
        select now() at time zone 'Europe/Rome' as local_now
      ) snapshot
    ) clock
    left join public.venue_prices vp
      on vp.venue_id = v.id
      and vp.verified_at is not null
      and (vp.valid_until is null or vp.valid_until > now())
    left join lateral (
      select
        round(
          sum(latest.rating * latest.review_count)::numeric / nullif(sum(latest.review_count), 0),
          2
        ) as rating,
        sum(latest.review_count)::bigint as review_count,
        count(*)::bigint as source_count,
        jsonb_agg(jsonb_build_object(
          'sourceKey', src.source_key,
          'sourceName', src.name,
          'value', latest.rating,
          'scale', latest.rating_scale,
          'count', latest.review_count,
          'observedAt', latest.observed_at,
          'sourceUrl', latest.source_url
        ) order by src.priority, src.name) as rating_sources
      from (
        select distinct on (ra.source_id)
          ra.source_id,
          ra.rating,
          ra.rating_scale,
          ra.review_count,
          ra.observed_at,
          ra.source_url
        from public.review_aggregates ra
        where ra.venue_id = v.id
        order by ra.source_id, ra.observed_at desc
      ) latest
      join public.sources src on src.id = latest.source_id
    ) reviews on true
    left join lateral (
      select
        coalesce(vi.external_url, '/storage/v1/object/public/venue-media/' || vi.storage_path) as image_url,
        vi.alt_text
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
      where vs.venue_id = v.id
        and vs.available
        and vs.verification_status = 'verified'
    ) services on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'weekday', vh.weekday,
        'sequence', vh.sequence,
        'opensAt', case when vh.opens_at is null then null else to_char(vh.opens_at, 'HH24:MI') end,
        'closesAt', case when vh.closes_at is null then null else to_char(vh.closes_at, 'HH24:MI') end,
        'closesNextDay', vh.closes_next_day,
        'closed', vh.is_closed,
        'verifiedAt', vh.verified_at,
        'validUntil', vh.valid_until
      ) order by vh.weekday, vh.sequence), '[]'::jsonb) as weekly_hours
      from public.venue_hours vh
      where vh.venue_id = v.id
        and vh.verified_at is not null
        and clock.local_date between vh.valid_from and coalesce(vh.valid_until, 'infinity'::date)
    ) hours on true
    left join lateral (
      select vc.value as source_url
      from public.venue_contacts vc
      where vc.venue_id = v.id
        and vc.kind = 'website'
        and vc.is_official
        and vc.verification_status = 'verified'
        and (vc.valid_until is null or vc.valid_until > now())
      order by vc.is_primary desc, vc.verified_at desc nulls last, vc.id
      limit 1
    ) hours_source on true
    left join lateral (
      with current_windows as (
        select
          ve.is_closed,
          ve.opens_at,
          ve.closes_at,
          ve.closes_next_day
        from public.venue_hour_exceptions ve
        where ve.venue_id = v.id
          and ve.exception_date = clock.local_date
          and ve.verified_at is not null

        union all

        select
          vh.is_closed,
          vh.opens_at,
          vh.closes_at,
          vh.closes_next_day
        from public.venue_hours vh
        where vh.venue_id = v.id
          and vh.weekday = clock.weekday
          and vh.verified_at is not null
          and clock.local_date between vh.valid_from and coalesce(vh.valid_until, 'infinity'::date)
          and not exists (
            select 1
            from public.venue_hour_exceptions ve
            where ve.venue_id = v.id
              and ve.exception_date = clock.local_date
              and ve.verified_at is not null
          )
      ), previous_windows as (
        select
          ve.is_closed,
          ve.opens_at,
          ve.closes_at,
          ve.closes_next_day
        from public.venue_hour_exceptions ve
        where ve.venue_id = v.id
          and ve.exception_date = clock.local_date - 1
          and ve.verified_at is not null

        union all

        select
          vh.is_closed,
          vh.opens_at,
          vh.closes_at,
          vh.closes_next_day
        from public.venue_hours vh
        where vh.venue_id = v.id
          and vh.weekday = ((clock.weekday + 6) % 7)::smallint
          and vh.verified_at is not null
          and clock.local_date - 1 between vh.valid_from and coalesce(vh.valid_until, 'infinity'::date)
          and not exists (
            select 1
            from public.venue_hour_exceptions ve
            where ve.venue_id = v.id
              and ve.exception_date = clock.local_date - 1
              and ve.verified_at is not null
          )
      )
      select (
        exists (
          select 1
          from current_windows w
          where not w.is_closed
            and w.opens_at is not null
            and w.closes_at is not null
            and (
              (
                not w.closes_next_day
                and w.closes_at > w.opens_at
                and clock.local_time >= w.opens_at
                and clock.local_time < w.closes_at
              )
              or (
                w.closes_next_day
                and w.closes_at <= w.opens_at
                and clock.local_time >= w.opens_at
              )
            )
        )
        or exists (
          select 1
          from previous_windows w
          where not w.is_closed
            and w.opens_at is not null
            and w.closes_at is not null
            and w.closes_next_day
            and w.closes_at <= w.opens_at
            and clock.local_time < w.closes_at
        )
      ) as is_open_now
    ) opening on true
    where v.lifecycle_status = 'active'
      and v.published_at is not null
      and (
        v.verification_status = 'verified'
        or (p_include_unverified and v.verification_status in ('unverified', 'pending'))
      )
      and (v.stale_after is null or v.stale_after > now())
      and (p_category_slugs is null or c.slug = any(p_category_slugs))
      and (p_subcategory_slugs is null or sc.slug = any(p_subcategory_slugs))
      and (p_neighborhood_slugs is null or n.slug = any(p_neighborhood_slugs))
      and (p_min_price_level is null or vp.price_level >= p_min_price_level)
      and (p_max_price_level is null or vp.price_level <= p_max_price_level)
      and (not p_open_now or (
        opening.is_open_now
        and hours_source.source_url is not null
      ))
      and (p_service_slugs is null or not exists (
        select 1
        from unnest(p_service_slugs) requested(slug)
        where not exists (
          select 1
          from public.venue_services vs2
          join public.services s2 on s2.id = vs2.service_id
          where vs2.venue_id = v.id
            and vs2.available
            and vs2.verification_status = 'verified'
            and s2.slug = requested.slug
        )
      ))
      and (nullif(trim(p_query), '') is null or (
        v.search_document @@ websearch_to_tsquery('italian', p_query)
        or extensions.similarity(v.display_name, p_query) >= 0.24
      ))
      and (p_radius_meters is null or extensions.st_dwithin(
        a.location,
        extensions.st_setsrid(
          extensions.st_makepoint(p_longitude, p_latitude),
          4326
        )::extensions.geography,
        p_radius_meters
      ))
      and (p_min_latitude is null or extensions.st_intersects(
        a.location::extensions.geometry,
        extensions.st_makeenvelope(
          p_min_longitude,
          p_min_latitude,
          p_max_longitude,
          p_max_latitude,
          4326
        )
      ))
  ), scored as (
    select
      base.*,
      case p_sort
        when 'distance' then coalesce(base.distance_meters, 1e15)
        when 'price' then coalesce(base.average_spend_cents::double precision, 1e15)
        when 'rating' then coalesce(base.rating::double precision, -1)
        when 'quality' then base.quality_score::double precision
        when 'newest' then extract(epoch from base.published_at)::double precision
        else base.relevance_score
      end as sort_value,
      case when p_sort = 'name' then lower(base.name) collate "C" end as sort_text
    from base
  )
  select scored.*
  from scored
  where case
    when p_sort = 'name' then
      p_after_text is null
      or p_after_id is null
      or scored.sort_text > p_after_text collate "C"
      or (scored.sort_text = p_after_text collate "C" and scored.id > p_after_id)
    when p_sort in ('distance', 'price') then
      p_after_value is null
      or p_after_id is null
      or scored.sort_value > p_after_value
      or (scored.sort_value = p_after_value and scored.id > p_after_id)
    else
      p_after_value is null
      or p_after_id is null
      or scored.sort_value < p_after_value
      or (scored.sort_value = p_after_value and scored.id > p_after_id)
    end
  order by
    case when p_sort = 'name' then scored.sort_text end asc nulls last,
    case when p_sort in ('distance', 'price') then scored.sort_value end asc nulls last,
    case when p_sort not in ('distance', 'price', 'name') then scored.sort_value end desc nulls last,
    scored.id asc
  limit p_limit;
end;
$$;

revoke all on function public.search_venues(
  text,
  text[],
  text[],
  text[],
  text[],
  smallint,
  smallint,
  double precision,
  double precision,
  integer,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  double precision,
  text,
  uuid,
  integer,
  boolean,
  boolean
) from public, anon, authenticated;
grant execute on function public.search_venues(
  text,
  text[],
  text[],
  text[],
  text[],
  smallint,
  smallint,
  double precision,
  double precision,
  integer,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  double precision,
  text,
  uuid,
  integer,
  boolean,
  boolean
) to service_role;
comment on function public.search_venues is
  'Service-only catalog search. Open-now is evaluated in Europe/Rome from verified exceptions and weekly schedules before pagination; unverified expansion remains explicit.';

-- Existing records are changed only when they are currently published,
-- Bronze, unverified, and clearly carry an administrative description. Keep
-- table-locking work last because these locks remain until transaction commit.
update public.venues
set published_at = null,
    lifecycle_status = 'draft',
    recommendation_eligible = false
where maturity = 'bronze'
  and verification_status = 'unverified'
  and published_at is not null
  and private.is_clear_administrative_label(display_name);

drop trigger if exists venues_guard_bronze_administrative_label on public.venues;
create trigger venues_guard_bronze_administrative_label
before insert or update of display_name, maturity, verification_status, published_at, lifecycle_status
on public.venues
for each row execute function private.guard_bronze_administrative_label();

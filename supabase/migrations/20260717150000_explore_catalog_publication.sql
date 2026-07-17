-- Pubblicazione esplorativa del catalogo amministrativo.
-- 1. search_venues e get_venue_detail accettano p_include_unverified (default false:
--    nessun cambiamento per i consumatori esistenti). Le schede unverified/bronze
--    diventano raggiungibili SOLO su richiesta esplicita e restano escluse dal
--    podio (recommendation_eligible resta vincolato a Gold/Platinum verificati).
-- 2. promote_administrative_observations: promozione set-based, idempotente e
--    con dry-run delle osservazioni comunali in venue bronze/unverified
--    pubblicate come "explore-only", con dedup, mappatura categorie,
--    quartiere, provenance della fonte e disclosure temporale.

drop function if exists public.search_venues(text, text[], text[], text[], smallint, smallint, double precision, double precision, integer, double precision, double precision, double precision, double precision, text, double precision, uuid, integer);

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
  p_limit integer default 24,
  p_include_unverified boolean default false
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
      and v.published_at is not null
      and (
        v.verification_status = 'verified'
        or (p_include_unverified and v.verification_status in ('unverified', 'pending'))
      )
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


revoke all on function public.search_venues(text, text[], text[], text[], smallint, smallint, double precision, double precision, integer, double precision, double precision, double precision, double precision, text, double precision, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.search_venues(text, text[], text[], text[], smallint, smallint, double precision, double precision, integer, double precision, double precision, double precision, double precision, text, double precision, uuid, integer, boolean) to service_role;
comment on function public.search_venues is 'Service-only catalog search. p_include_unverified=true expands to explore-only bronze records; default keeps the verified contract.';

drop function if exists public.get_venue_detail(text);

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
comment on function public.get_venue_detail is 'Service-only public venue passport projection. p_include_unverified=true also serves explore-only bronze records; PII and internal moderation fields are never returned.';

create or replace function public.promote_administrative_observations(
  p_source_keys text[] default array['comune_milano_ds58', 'comune_milano_ds59', 'comune_milano_ds250'],
  p_max integer default 20000,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_candidates integer := 0;
  v_promoted integer := 0;
  v_skipped_existing integer := 0;
begin
  if p_max < 1 or p_max > 50000 then
    raise exception 'invalid_max' using errcode = '22023';
  end if;

  create temp table promo_candidates on commit drop as
  with raw as (
    select
      o.id as observation_id,
      s.source_key,
      o.external_id,
      trim(o.source_label) as display_name,
      o.formatted_address,
      coalesce(nullif(trim(o.normalized_address), ''), trim(o.formatted_address)) as normalized_address,
      o.municipality_id,
      nullif(trim(o.neighborhood_label), '') as neighborhood_label,
      o.latitude,
      o.longitude,
      o.location,
      o.observed_through,
      o.normalized_payload as payload,
      lower(regexp_replace(trim(o.source_label), '\s+', ' ', 'g')) as norm_name
    from public.source_observations o
    join public.sources s on s.id = o.source_id
    where s.source_key = any (p_source_keys)
      and o.observation_kind = 'administrative_activity'
      and o.candidate_status = 'unreviewed'
      and o.linked_venue_id is null
      and o.source_label is not null
      and char_length(trim(o.source_label)) between 2 and 120
      and trim(o.source_label) !~ '^[0-9.]+$'
      and o.latitude is not null
      and o.formatted_address is not null
  ), dedup as (
    select raw.*, row_number() over (
      partition by raw.norm_name, coalesce(lower(raw.normalized_address), round(raw.latitude::numeric, 4)::text || ':' || round(raw.longitude::numeric, 4)::text)
      order by
        case raw.source_key when 'comune_milano_ds58' then 1 when 'comune_milano_ds59' then 2 else 3 end,
        raw.observed_through desc nulls last,
        raw.external_id
    ) as rn
    from raw
  )
  select
    dedup.*,
    encode(extensions.digest(convert_to(dedup.norm_name || '|' || lower(coalesce(dedup.normalized_address, '')), 'UTF8'), 'sha256'), 'hex') as fingerprint,
    lower(coalesce(dedup.payload->>'activityType', '') || ' ' || coalesce(dedup.payload->>'label', '')) as type_text
  from dedup
  where dedup.rn = 1
  limit p_max;

  select count(*) into v_candidates from promo_candidates;

  -- Scarta candidati che replicano un locale già in catalogo: stesso nome
  -- normalizzato entro 150 m, oppure fingerprint identico.
  delete from promo_candidates pc
  where exists (
    select 1
    from public.venues v
    left join public.venue_addresses va
      on va.venue_id = v.id and va.is_primary and va.valid_until is null
    where v.identity_fingerprint = pc.fingerprint
      or (
        lower(v.display_name) = pc.norm_name
        and va.location is not null
        and extensions.st_dwithin(va.location, pc.location, 150)
      )
  );
  get diagnostics v_skipped_existing = row_count;

  if p_dry_run then
    return jsonb_build_object(
      'dryRun', true,
      'candidates', v_candidates,
      'skippedExisting', v_skipped_existing,
      'promotable', v_candidates - v_skipped_existing
    );
  end if;

  with mapped as (
    select
      pc.*,
      case
        when pc.type_text ~ 'pasticc' then 'pasticceria'
        when pc.type_text ~ 'gelat' then 'gelateria'
        when pc.type_text ~ 'enotec|vinerie|wine bar' then 'enoteca'
        when pc.type_text ~ '\mpub\M|birrer' then 'pub'
        when pc.type_text ~ 'discotec|sala da ballo|night club' then 'club'
        when pc.type_text ~ 'albergh|hotel' then 'hotel'
        when pc.type_text ~ 'ristor|trattor|osteri|pizzer|agriturism' then 'ristorante'
        when pc.type_text ~ '\mbar\M|caff|bottegh' then 'caffe'
        else 'altro'
      end as category_slug,
      regexp_replace(
        left(
          regexp_replace(
            regexp_replace(
              translate(pc.norm_name, 'àáâäèéêëìíîïòóôöùúûüçñ’''`', 'aaaaeeeeiiiioooouuuucn   '),
              '[^a-z0-9]+', '-', 'g'
            ),
            '(^-+|-+$)', '', 'g'
          ),
          60
        ),
        '-+$', ''
      ) as base_slug
    from promo_candidates pc
  ), prepared as (
    select
      mapped.*,
      case
        when mapped.base_slug = '' then 'locale-' || right(md5(mapped.source_key || mapped.external_id), 8)
        else mapped.base_slug || '-' || right(md5(mapped.source_key || mapped.external_id), 6)
      end as slug
    from mapped
  ), inserted as (
    insert into public.venues (
      slug, official_name, display_name, short_description,
      category_id, lifecycle_status, verification_status, maturity,
      quality_score, completeness_score, confidence_score,
      recommendation_eligible, identity_fingerprint, semantic_text,
      first_seen_at, last_seen_at, published_at
    )
    select
      p.slug,
      p.display_name,
      p.display_name,
      'Scheda importata dall''anagrafica del Comune di Milano (dati amministrativi al ' ||
        coalesce(to_char(p.observed_through, 'DD/MM/YYYY'), '31/12/2023') ||
        '). Nome, apertura attuale e dettagli non ancora verificati dalla redazione.',
      c.id,
      'active',
      'unverified',
      'bronze',
      10, 20, 0.30,
      false,
      p.fingerprint,
      trim(coalesce(p.payload->>'activityType', '') || ' ' || coalesce(p.neighborhood_label, '')),
      now(), now(), now()
    from prepared p
    join public.categories c on c.slug = p.category_slug
    on conflict (identity_fingerprint) do nothing
    returning id, slug, identity_fingerprint
  ), addressed as (
    insert into public.venue_addresses (
      venue_id, neighborhood_id, municipality_id, street_name, street_number,
      postal_code, formatted_address, normalized_address, latitude, longitude,
      location, geocoding_provider, geocoding_precision, geocoded_at, is_primary
    )
    select
      i.id,
      n.id,
      p.municipality_id,
      coalesce(nullif(trim(p.payload->'address'->>'streetName'), ''), p.formatted_address),
      nullif(trim(p.payload->'address'->>'streetNumber'), ''),
      case when p.payload->'address'->>'postalCode' ~ '^20[0-9]{3}$' then p.payload->'address'->>'postalCode' end,
      p.formatted_address,
      p.normalized_address,
      p.latitude,
      p.longitude,
      p.location,
      'comune-milano-open-data',
      'address',
      now(),
      true
    from prepared p
    join inserted i on i.identity_fingerprint = p.fingerprint
    left join public.neighborhoods n
      on lower(n.name) = lower(p.neighborhood_label)
      or lower(p.neighborhood_label) = any (select lower(a) from unnest(n.aliases) a)
    returning venue_id
  )
  update public.source_observations o
  set candidate_status = 'linked',
      linked_venue_id = i.id,
      last_seen_at = now()
  from prepared p
  join inserted i on i.identity_fingerprint = p.fingerprint
  where o.id = p.observation_id;

  select count(*) into v_promoted from public.venues v
  where v.maturity = 'bronze' and v.verification_status = 'unverified' and v.published_at is not null;

  return jsonb_build_object(
    'dryRun', false,
    'candidates', v_candidates,
    'skippedExisting', v_skipped_existing,
    'bronzePublishedTotal', v_promoted
  );
end;
$$;

revoke all on function public.promote_administrative_observations(text[], integer, boolean) from public, anon, authenticated;
grant execute on function public.promote_administrative_observations(text[], integer, boolean) to service_role;
comment on function public.promote_administrative_observations is 'Bulk, idempotent promotion of reviewed-source administrative observations into explore-only bronze venues. Dry-run by default; never touches verified records nor recommendation eligibility.';

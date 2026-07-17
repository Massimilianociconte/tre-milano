-- Licensed source registry, conservative normalization/deduplication and
-- operational maintenance. Imports create draft records; publication always
-- remains an explicit editorial/verification action.

insert into public.municipalities(id, name) values
  (1, 'Municipio 1'), (2, 'Municipio 2'), (3, 'Municipio 3'),
  (4, 'Municipio 4'), (5, 'Municipio 5'), (6, 'Municipio 6'),
  (7, 'Municipio 7'), (8, 'Municipio 8'), (9, 'Municipio 9')
on conflict (id) do update set name = excluded.name;

insert into public.categories(slug, name, display_order) values
  ('cocktail-bar', 'Cocktail bar', 10), ('ristorante', 'Ristorante', 20),
  ('enoteca', 'Enoteca', 30), ('rooftop', 'Rooftop', 40),
  ('caffe', 'Caffè', 50), ('pasticceria', 'Pasticceria', 60),
  ('gelateria', 'Gelateria', 70), ('pub', 'Pub', 80),
  ('club', 'Club', 90), ('hotel', 'Hotel', 100),
  ('spazio-culturale', 'Spazio culturale', 110), ('mercato', 'Mercato', 120),
  ('altro', 'Altro', 999)
on conflict (slug) do update set name = excluded.name, display_order = excluded.display_order;

insert into public.services(slug, name) values
  ('accesso-sedia-rotelle', 'Accesso in sedia a rotelle'),
  ('bagno-accessibile', 'Bagno accessibile'),
  ('tavoli-esterni', 'Tavoli esterni'),
  ('terrazza', 'Terrazza'),
  ('prenotazione', 'Prenotazione'),
  ('asporto', 'Asporto'),
  ('consegna', 'Consegna'),
  ('wifi', 'Wi-Fi'),
  ('musica-live', 'Musica dal vivo'),
  ('opzioni-vegane', 'Opzioni vegane'),
  ('opzioni-senza-glutine', 'Opzioni senza glutine'),
  ('pet-friendly', 'Animali ammessi'),
  ('parcheggio', 'Parcheggio'),
  ('eventi-privati', 'Eventi privati')
on conflict (slug) do update set name = excluded.name;

insert into public.sources(
  source_key, name, kind, base_url, api_url, terms_url, license_name, license_url,
  attribution_text, commercial_use_allowed, derivative_use_allowed,
  raw_payload_retention_days, reliability_score, priority, refresh_interval,
  enabled, requires_manual_review, next_refresh_at, metadata
) values
  (
    'comune_milano_ds58', 'Comune di Milano — Pubblici esercizi in piano', 'open_data',
    'https://dati.comune.milano.it/',
    'https://dati.comune.milano.it/dataset/f0671ce0-8c11-4ee8-95e5-c09913d00f83/resource/1623c617-028c-4f8a-9919-7f314701f50a/download/geocoded_batch_pe-dic-23_final_.geojson',
    'https://dati.comune.milano.it/', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
    'Fonte: Comune di Milano — dati.comune.milano.it (CC BY 4.0)', true, true,
    0, 0.720, 30, interval '90 days', false, true, null,
    '{"adapter":"milano_geojson","dataset":"DS58","dataThrough":"2023-12-31","neverInferOpen":true,"observationKind":"administrative_activity"}'::jsonb
  ),
  (
    'comune_milano_ds59', 'Comune di Milano — Pubblici esercizi fuori piano', 'open_data',
    'https://dati.comune.milano.it/',
    'https://dati.comune.milano.it/dataset/726fb09b-e2ce-4407-8579-51aef8027498/resource/b9186446-ae6d-4b22-bf7c-16dea78fe324/download/geocoded_batch_fp-dic-23_final_.geojson',
    'https://dati.comune.milano.it/', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
    'Fonte: Comune di Milano — dati.comune.milano.it (CC BY 4.0)', true, true,
    0, 0.700, 31, interval '90 days', false, true, null,
    '{"adapter":"milano_geojson","dataset":"DS59","dataThrough":"2023-12-31","neverInferOpen":true,"observationKind":"administrative_activity"}'::jsonb
  ),
  (
    'comune_milano_ds250', 'Comune di Milano — Attività economiche alimentari', 'open_data',
    'https://dati.comune.milano.it/',
    'https://dati.comune.milano.it/dataset/f0daf38a-1733-4cb1-9877-663519ced7c4/resource/aa6b66f7-480e-4812-bdd5-23ce2451c865/download/geocoded_batch_ae-dic-23_final.geojson',
    'https://dati.comune.milano.it/', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
    'Fonte: Comune di Milano — dati.comune.milano.it (CC BY 4.0)', true, true,
    0, 0.700, 32, interval '90 days', false, true, null,
    '{"adapter":"milano_geojson","dataset":"DS250","dataThrough":"2023-12-31","neverInferOpen":true,"observationKind":"administrative_activity"}'::jsonb
  ),
  (
    'openstreetmap', 'OpenStreetMap contributors', 'open_data',
    'https://www.openstreetmap.org/', 'https://overpass-api.de/api/interpreter',
    'https://operations.osmfoundation.org/policies/tiles/', 'ODbL 1.0', 'https://opendatacommons.org/licenses/odbl/1-0/',
    '© OpenStreetMap contributors', true, true, 0, 0.650, 70, interval '30 days',
    false, true, null,
    '{"adapter":"overpass","requiresDedicatedEndpointForScale":true,"neverImportImages":true,"neverInferOpen":true}'::jsonb
  ),
  (
    'official_venue_facts', 'Siti e canali ufficiali delle attività', 'official_website',
    null, null, null, 'Fatti verificati manualmente', null,
    'Fonte ufficiale indicata campo per campo', true, true, 0, 0.950, 10,
    interval '30 days', false, false, null,
    '{"adapter":"manual","allowedFields":["name","address","contacts","hours","price","services","booking"],"mediaRequiresSeparateRights":true}'::jsonb
  )
on conflict (source_key) do update set
  name = excluded.name,
  api_url = excluded.api_url,
  terms_url = excluded.terms_url,
  license_name = excluded.license_name,
  license_url = excluded.license_url,
  attribution_text = excluded.attribution_text,
  commercial_use_allowed = excluded.commercial_use_allowed,
  derivative_use_allowed = excluded.derivative_use_allowed,
  reliability_score = excluded.reliability_score,
  priority = excluded.priority,
  metadata = excluded.metadata,
  updated_at = now();

create or replace function private.refresh_venue_quality(p_venue_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_score numeric := 0;
  v_confidence numeric := 0;
  v_sources integer := 0;
  v_status public.verification_status;
  v_lifecycle public.venue_lifecycle_status;
  v_has_approved_image boolean;
begin
  select
    15
    + case when nullif(trim(v.description), '') is not null then 10 else 0 end
    + case when exists (select 1 from public.venue_addresses a where a.venue_id = v.id and a.is_primary and a.valid_until is null) then 20 else 0 end
    + case when exists (select 1 from public.venue_contacts c where c.venue_id = v.id and c.verification_status = 'verified') then 10 else 0 end
    + case when exists (select 1 from public.venue_hours h where h.venue_id = v.id and (h.valid_until is null or h.valid_until >= current_date)) then 10 else 0 end
    + case when exists (
        select 1 from public.venue_prices p
        where p.venue_id = v.id and p.price_level is not null
          and p.verified_at is not null and (p.valid_until is null or p.valid_until > now())
      ) then 10 else 0 end
    + case when exists (select 1 from public.venue_services s where s.venue_id = v.id and s.verification_status = 'verified') then 10 else 0 end
    + case when exists (select 1 from public.venue_images i where i.venue_id = v.id and i.approved_at is not null and i.rights_status in ('owned', 'licensed', 'official_permission', 'open_license')) then 15 else 0 end,
    v.verification_status,
    v.lifecycle_status,
    exists (select 1 from public.venue_images i where i.venue_id = v.id and i.approved_at is not null and i.rights_status in ('owned', 'licensed', 'official_permission', 'open_license'))
  into v_score, v_status, v_lifecycle, v_has_approved_image
  from public.venues v where v.id = p_venue_id;

  select coalesce(avg(src.reliability_score * vfs.confidence), 0), count(distinct src.id)
  into v_confidence, v_sources
  from public.venue_field_sources vfs
  join public.source_records sr on sr.id = vfs.source_record_id
  join public.sources src on src.id = sr.source_id
  where vfs.venue_id = p_venue_id
    and vfs.selected
    and (vfs.valid_until is null or vfs.valid_until > now())
    and vfs.observed_at <= now()
    and not sr.deleted_at_source
    and (sr.expires_at is null or sr.expires_at > now())
    and src.enabled
    and src.commercial_use_allowed
    and src.derivative_use_allowed;

  update public.venues set
    completeness_score = least(100, v_score),
    quality_score = least(100, v_score * 0.7 + v_confidence * 30),
    confidence_score = least(1, v_confidence),
    maturity = case
      when v_score >= 92 and v_confidence >= 0.85 and v_sources >= 2 and v_status = 'verified' and v_has_approved_image then 'platinum'::public.maturity_tier
      when v_score >= 80 and v_confidence >= 0.70 and v_status = 'verified' and v_has_approved_image then 'gold'::public.maturity_tier
      when v_score >= 50 then 'silver'::public.maturity_tier
      else 'bronze'::public.maturity_tier
    end,
    recommendation_eligible = (
      v_score >= 80 and v_confidence >= 0.70 and v_status = 'verified'
      and v_lifecycle = 'active' and v_has_approved_image
    ),
    updated_at = now()
  where id = p_venue_id;
end;
$$;

create or replace function public.begin_import_run(
  p_source_key text,
  p_trigger_kind text default 'manual',
  p_requested_by text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_source public.sources%rowtype;
  v_run_id uuid;
begin
  select * into v_source from public.sources where source_key = p_source_key and enabled for update;
  if not found then raise exception 'source_not_enabled' using errcode = '22023'; end if;
  if not v_source.commercial_use_allowed or not v_source.derivative_use_allowed then
    raise exception 'source_license_not_approved' using errcode = '42501';
  end if;
  if p_trigger_kind not in ('manual', 'scheduled', 'webhook', 'retry') then
    raise exception 'invalid_trigger_kind' using errcode = '22023';
  end if;
  insert into public.import_runs(source_id, status, trigger_kind, requested_by, started_at, attempts)
  values (v_source.id, 'running', p_trigger_kind, left(p_requested_by, 200), now(), 1)
  returning id into v_run_id;
  return v_run_id;
end;
$$;

create or replace function public.ingest_source_observation(
  p_source_key text,
  p_external_id text,
  p_payload jsonb,
  p_import_run_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_source public.sources%rowtype;
  v_run public.import_runs%rowtype;
  v_lat double precision;
  v_lng double precision;
  v_checksum text;
  v_id uuid;
begin
  if jsonb_typeof(p_payload) <> 'object' or char_length(p_external_id) not between 1 and 300 then
    raise exception 'invalid_observation' using errcode = '22023';
  end if;
  select * into v_source from public.sources where source_key = p_source_key and enabled;
  if not found or not v_source.commercial_use_allowed or not v_source.derivative_use_allowed then
    raise exception 'source_not_approved' using errcode = '42501';
  end if;
  select * into v_run from public.import_runs where id = p_import_run_id and source_id = v_source.id and status = 'running';
  if not found then raise exception 'import_run_not_running' using errcode = '55000'; end if;

  v_lat := nullif(p_payload #>> '{address,latitude}', '')::double precision;
  v_lng := nullif(p_payload #>> '{address,longitude}', '')::double precision;
  if (v_lat is null) <> (v_lng is null) or v_lat is not null and (v_lat not between 45.30 and 45.65 or v_lng not between 8.90 and 9.45) then
    raise exception 'invalid_milan_coordinates' using errcode = '22023';
  end if;
  v_checksum := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');

  insert into public.source_observations(
    source_id, external_id, observation_kind, source_label, formatted_address,
    normalized_address, municipality_id, neighborhood_label, latitude, longitude,
    location, observed_through, payload_checksum, normalized_payload, last_seen_at
  ) values (
    v_source.id, p_external_id,
    coalesce(nullif(p_payload->>'observationKind', ''), 'administrative_activity'),
    nullif(p_payload->>'label', ''), nullif(p_payload #>> '{address,formatted}', ''),
    nullif(p_payload #>> '{address,normalized}', ''), nullif(p_payload #>> '{address,municipality}', '')::smallint,
    nullif(p_payload #>> '{address,neighborhood}', ''), v_lat, v_lng,
    case when v_lat is null then null else extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography end,
    nullif(p_payload->>'observedThrough', '')::date, v_checksum, p_payload, now()
  )
  on conflict (source_id, external_id) do update set
    source_label = excluded.source_label,
    formatted_address = excluded.formatted_address,
    normalized_address = excluded.normalized_address,
    municipality_id = excluded.municipality_id,
    neighborhood_label = excluded.neighborhood_label,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    location = excluded.location,
    observed_through = excluded.observed_through,
    payload_checksum = excluded.payload_checksum,
    normalized_payload = excluded.normalized_payload,
    last_seen_at = now()
  returning id into v_id;

  update public.import_runs set records_seen = records_seen + 1, records_updated = records_updated + 1 where id = p_import_run_id;
  return jsonb_build_object('status', 'observation_stored', 'observationId', v_id, 'publicVenueCreated', false);
end;
$$;

create or replace function public.ingest_venue_record(
  p_source_key text,
  p_external_id text,
  p_payload jsonb,
  p_import_run_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_source public.sources%rowtype;
  v_run public.import_runs%rowtype;
  v_category_id uuid;
  v_subcategory_id uuid;
  v_neighborhood_id uuid;
  v_venue_id uuid;
  v_source_record_id uuid;
  v_existing_status public.verification_status;
  v_name text := trim(coalesce(p_payload->>'officialName', ''));
  v_display_name text := trim(coalesce(nullif(p_payload->>'displayName', ''), p_payload->>'officialName', ''));
  v_normalized_address text := trim(coalesce(p_payload #>> '{address,normalized}', ''));
  v_fingerprint text;
  v_checksum text;
  v_lat double precision;
  v_lng double precision;
  v_created boolean := false;
begin
  if coalesce(jsonb_typeof(p_payload), 'null') <> 'object' or char_length(p_external_id) not between 1 and 300
    or char_length(v_name) not between 1 and 180 or char_length(v_normalized_address) < 5 then
    raise exception 'invalid_venue_payload' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 262144 then
    raise exception 'venue_payload_too_large' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'contacts') = 'array' and jsonb_array_length(p_payload->'contacts') > 50 then
    raise exception 'too_many_contacts' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'services') = 'array' and jsonb_array_length(p_payload->'services') > 100 then
    raise exception 'too_many_services' using errcode = '22023';
  end if;
  select * into v_source from public.sources where source_key = p_source_key and enabled;
  if not found or not v_source.commercial_use_allowed or not v_source.derivative_use_allowed then
    raise exception 'source_not_approved' using errcode = '42501';
  end if;
  select * into v_run from public.import_runs where id = p_import_run_id and source_id = v_source.id and status = 'running';
  if not found then raise exception 'import_run_not_running' using errcode = '55000'; end if;
  select id into v_category_id from public.categories where slug = p_payload->>'categorySlug' and active;
  if v_category_id is null then raise exception 'unknown_category' using errcode = '22023'; end if;
  if nullif(p_payload->>'subcategorySlug', '') is not null then
    select id into v_subcategory_id from public.subcategories where slug = p_payload->>'subcategorySlug' and category_id = v_category_id and active;
    if v_subcategory_id is null then raise exception 'unknown_subcategory' using errcode = '22023'; end if;
  end if;
  if nullif(p_payload #>> '{address,neighborhoodSlug}', '') is not null then
    select id into v_neighborhood_id from public.neighborhoods where slug = p_payload #>> '{address,neighborhoodSlug}';
  end if;
  v_lat := nullif(p_payload #>> '{address,latitude}', '')::double precision;
  v_lng := nullif(p_payload #>> '{address,longitude}', '')::double precision;
  if v_lat is null or v_lng is null or v_lat not between 45.30 and 45.65 or v_lng not between 8.90 and 9.45 then
    raise exception 'invalid_milan_coordinates' using errcode = '22023';
  end if;
  v_fingerprint := encode(extensions.digest(
    private.normalize_identity(v_name) || '|' || private.normalize_identity(v_normalized_address), 'sha256'
  ), 'hex');
  v_checksum := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');

  select sr.venue_id into v_venue_id
  from public.source_records sr where sr.source_id = v_source.id and sr.external_id = p_external_id;
  if v_venue_id is null then
    select id into v_venue_id from public.venues where identity_fingerprint = v_fingerprint;
  end if;
  if v_venue_id is null then
    v_venue_id := gen_random_uuid();
    insert into public.venues(
      id, slug, official_name, display_name, description, short_description,
      category_id, subcategory_id, identity_fingerprint, semantic_text,
      lifecycle_status, verification_status, maturity, last_seen_at, stale_after
    ) values (
      v_venue_id,
      private.normalize_identity(v_display_name) || '-' || left(replace(v_venue_id::text, '-', ''), 8),
      v_name, v_display_name, nullif(p_payload->>'description', ''), nullif(p_payload->>'shortDescription', ''),
      v_category_id, v_subcategory_id, v_fingerprint, nullif(p_payload->>'semanticText', ''),
      'draft', 'unverified', 'bronze', now(), now() + interval '90 days'
    );
    insert into public.venue_addresses(
      venue_id, neighborhood_id, municipality_id, street_name, street_number, postal_code,
      formatted_address, normalized_address, latitude, longitude, location,
      geocoding_provider, geocoding_precision, geocoded_at
    ) values (
      v_venue_id, v_neighborhood_id, nullif(p_payload #>> '{address,municipality}', '')::smallint,
      p_payload #>> '{address,streetName}', nullif(p_payload #>> '{address,streetNumber}', ''),
      nullif(p_payload #>> '{address,postalCode}', ''), p_payload #>> '{address,formatted}',
      v_normalized_address, v_lat, v_lng,
      extensions.st_setsrid(extensions.st_makepoint(v_lng, v_lat), 4326)::extensions.geography,
      nullif(p_payload #>> '{address,geocodingProvider}', ''), nullif(p_payload #>> '{address,geocodingPrecision}', ''),
      nullif(p_payload #>> '{address,geocodedAt}', '')::timestamptz
    );
    v_created := true;
  else
    select verification_status into v_existing_status from public.venues where id = v_venue_id for update;
    update public.venues set
      last_seen_at = now(),
      description = case when v_existing_status in ('unverified', 'pending') then coalesce(nullif(p_payload->>'description', ''), description) else description end,
      short_description = case when v_existing_status in ('unverified', 'pending') then coalesce(nullif(p_payload->>'shortDescription', ''), short_description) else short_description end
    where id = v_venue_id;
  end if;

  insert into public.source_records(
    source_id, external_id, venue_id, source_url, payload_checksum, raw_payload,
    normalized_payload, fetched_at, expires_at, last_seen_at
  ) values (
    v_source.id, p_external_id, v_venue_id, nullif(p_payload->>'sourceUrl', ''), v_checksum,
    case when v_source.raw_payload_retention_days > 0 and coalesce((v_source.metadata->>'retainRaw')::boolean, false) then p_payload->'raw' else null end,
    p_payload - 'raw', coalesce(nullif(p_payload->>'fetchedAt', '')::timestamptz, now()),
    now() + v_source.refresh_interval, now()
  )
  on conflict (source_id, external_id) do update set
    venue_id = excluded.venue_id, source_url = excluded.source_url,
    payload_checksum = excluded.payload_checksum, raw_payload = excluded.raw_payload,
    normalized_payload = excluded.normalized_payload, fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at, last_seen_at = now(), deleted_at_source = false
  returning id into v_source_record_id;

  insert into public.venue_field_sources(venue_id, field_path, source_record_id, confidence, observed_at, valid_until, selected)
  values (v_venue_id, 'identity', v_source_record_id, v_source.reliability_score, now(), now() + v_source.refresh_interval, v_created)
  on conflict (venue_id, field_path, source_record_id) do update set
    confidence = excluded.confidence, observed_at = excluded.observed_at, valid_until = excluded.valid_until;

  if jsonb_typeof(p_payload->'contacts') = 'array' then
    insert into public.venue_contacts(venue_id, kind, value, normalized_value, is_official, verification_status)
    select v_venue_id, (x->>'kind')::public.contact_kind, trim(x->>'value'), lower(trim(coalesce(x->>'normalized', x->>'value'))),
      v_source.kind in ('official_website', 'official_social'), 'unverified'
    from jsonb_array_elements(p_payload->'contacts') x
    where x->>'kind' in ('phone', 'email', 'website', 'instagram', 'facebook', 'tiktok', 'other_social')
      and char_length(trim(coalesce(x->>'value', ''))) between 3 and 500
    on conflict (venue_id, kind, normalized_value) do update set updated_at = now();
  end if;

  if jsonb_typeof(p_payload->'services') = 'array' then
    insert into public.venue_services(venue_id, service_id, available, verification_status)
    select v_venue_id, s.id, true, 'unverified'
    from jsonb_array_elements_text(p_payload->'services') requested
    join public.services s on s.slug = requested and s.active
    on conflict (venue_id, service_id) do nothing;
  end if;

  if v_created and jsonb_typeof(p_payload->'price') = 'object' then
    insert into public.venue_prices(venue_id, price_level, average_spend_cents, minimum_spend_cents, maximum_spend_cents, pricing_note)
    values (
      v_venue_id, nullif(p_payload #>> '{price,level}', '')::smallint,
      nullif(p_payload #>> '{price,averageSpendCents}', '')::integer,
      nullif(p_payload #>> '{price,minimumSpendCents}', '')::integer,
      nullif(p_payload #>> '{price,maximumSpendCents}', '')::integer,
      nullif(p_payload #>> '{price,note}', '')
    ) on conflict (venue_id) do nothing;
  end if;

  insert into public.venue_update_history(venue_id, source_record_id, actor_type, change_type, new_values, reason)
  values (v_venue_id, v_source_record_id, 'pipeline', case when v_created then 'created_draft' else 'source_observed' end,
    jsonb_build_object('source', p_source_key, 'externalId', p_external_id, 'payloadChecksum', v_checksum),
    'Automated import; publication requires editorial verification');

  insert into public.duplicate_candidates(venue_id_a, venue_id_b, name_similarity, distance_meters, evidence)
  select least(v_venue_id, other.id), greatest(v_venue_id, other.id),
    extensions.similarity(v_display_name, other.display_name),
    extensions.st_distance(addr.location, other_addr.location),
    jsonb_build_object('reason', 'name_and_proximity', 'source', p_source_key)
  from public.venues other
  join public.venue_addresses other_addr on other_addr.venue_id = other.id and other_addr.is_primary and other_addr.valid_until is null
  join public.venue_addresses addr on addr.venue_id = v_venue_id and addr.is_primary and addr.valid_until is null
  where other.id <> v_venue_id
    and extensions.similarity(v_display_name, other.display_name) >= 0.72
    and extensions.st_dwithin(addr.location, other_addr.location, 100)
  on conflict (venue_id_a, venue_id_b) do update set
    name_similarity = greatest(public.duplicate_candidates.name_similarity, excluded.name_similarity),
    distance_meters = least(public.duplicate_candidates.distance_meters, excluded.distance_meters),
    evidence = public.duplicate_candidates.evidence || excluded.evidence;

  perform private.refresh_venue_quality(v_venue_id);
  update public.import_runs set
    records_seen = records_seen + 1,
    records_created = records_created + case when v_created then 1 else 0 end,
    records_updated = records_updated + case when v_created then 0 else 1 end
  where id = p_import_run_id;
  return jsonb_build_object(
    'status', case when v_created then 'draft_created' else 'source_linked' end,
    'venueId', v_venue_id,
    'sourceRecordId', v_source_record_id,
    'publicationEligible', false,
    'manualReviewRequired', true
  );
exception when others then
  if p_import_run_id is not null and exists (
    select 1 from public.import_runs where id = p_import_run_id and status = 'running'
  ) then
    insert into public.import_errors(import_run_id, external_id, error_code, message, retryable)
    values (p_import_run_id, left(p_external_id, 300), sqlstate, left(sqlerrm, 1000), sqlstate like '08%')
    ;
    update public.import_runs set records_seen = records_seen + 1, records_failed = records_failed + 1 where id = p_import_run_id;
    return jsonb_build_object('status', 'error', 'code', sqlstate, 'publicationEligible', false, 'manualReviewRequired', true);
  end if;
  raise;
end;
$$;

create or replace function public.ingest_source_observations_batch(
  p_source_key text,
  p_records jsonb,
  p_import_run_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_record jsonb;
  v_processed integer := 0;
  v_failed integer := 0;
begin
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 500 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  for v_record in select value from jsonb_array_elements(p_records) loop
    begin
      if nullif(v_record->>'externalId', '') is null or jsonb_typeof(v_record->'payload') <> 'object' then
        raise exception 'invalid_batch_record' using errcode = '22023';
      end if;
      perform public.ingest_source_observation(p_source_key, v_record->>'externalId', v_record->'payload', p_import_run_id);
      v_processed := v_processed + 1;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.import_errors(import_run_id, external_id, error_code, message, retryable)
      values (p_import_run_id, left(v_record->>'externalId', 300), sqlstate, left(sqlerrm, 1000), sqlstate like '08%');
      update public.import_runs set records_seen = records_seen + 1, records_failed = records_failed + 1 where id = p_import_run_id;
    end;
  end loop;
  return jsonb_build_object('processed', v_processed, 'failed', v_failed);
end;
$$;

create or replace function public.finish_import_run(
  p_import_run_id uuid,
  p_status public.import_run_status,
  p_error_summary text default null,
  p_metrics jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'partial', 'failed', 'cancelled') or jsonb_typeof(p_metrics) <> 'object' then
    raise exception 'invalid_finish_state' using errcode = '22023';
  end if;
  update public.import_runs set status = p_status, error_summary = left(p_error_summary, 2000), metrics = p_metrics, finished_at = now()
  where id = p_import_run_id and status = 'running';
  if not found then raise exception 'import_run_not_running' using errcode = '55000'; end if;
  update public.sources s set
    last_success_at = case when p_status in ('succeeded', 'partial') then now() else s.last_success_at end,
    next_refresh_at = case
      when p_status in ('succeeded', 'partial') then now() + s.refresh_interval
      else now() + least(s.refresh_interval, interval '24 hours')
    end,
    updated_at = now()
  from public.import_runs r where r.id = p_import_run_id and s.id = r.source_id;
end;
$$;

create or replace function public.catalog_maintenance()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_queued integer := 0;
  v_stale integer := 0;
  v_deleted_rate_limits integer := 0;
  v_deleted_claims integer := 0;
  v_deleted_reports integer := 0;
  v_quality_refreshed integer := 0;
  v_venue_id uuid;
begin
  insert into public.import_runs(source_id, status, trigger_kind, next_retry_at)
  select s.id, 'queued', 'scheduled', now()
  from public.sources s
  where s.enabled and s.api_url is not null and coalesce(s.next_refresh_at, now()) <= now()
    and not exists (
      select 1 from public.import_runs r where r.source_id = s.id and r.status in ('queued', 'running')
    );
  get diagnostics v_queued = row_count;

  update public.venues set verification_status = 'pending', recommendation_eligible = false, updated_at = now()
  where lifecycle_status in ('active', 'temporarily_closed') and stale_after <= now() and verification_status = 'verified';
  get diagnostics v_stale = row_count;

  -- `quality_score`, `confidence_score`, maturity and recommendation state are
  -- materialized. Invalidate selected evidence as soon as its validity or
  -- source approval expires, then recalculate every affected venue in the same
  -- scheduled transaction so stale trust cannot survive without a new ingest.
  for v_venue_id in
    with invalidated as (
      update public.venue_field_sources vfs set selected = false
      from public.source_records sr
      join public.sources src on src.id = sr.source_id
      where vfs.source_record_id = sr.id
        and vfs.selected
        and (
          (vfs.valid_until is not null and vfs.valid_until <= now())
          or vfs.observed_at > now()
          or sr.deleted_at_source
          or (sr.expires_at is not null and sr.expires_at <= now())
          or not src.enabled
          or not src.commercial_use_allowed
          or not src.derivative_use_allowed
        )
      returning vfs.venue_id
    )
    select distinct venue_id from invalidated
  loop
    perform private.refresh_venue_quality(v_venue_id);
    v_quality_refreshed := v_quality_refreshed + 1;
  end loop;

  delete from public.api_rate_limits where expires_at < now();
  get diagnostics v_deleted_rate_limits = row_count;
  delete from public.venue_claims where retention_until < now();
  get diagnostics v_deleted_claims = row_count;
  delete from public.user_reports where retention_until < now();
  get diagnostics v_deleted_reports = row_count;
  update public.source_records sr set raw_payload = null
  from public.sources s
  where sr.source_id = s.id and sr.raw_payload is not null
    and sr.fetched_at + make_interval(days => s.raw_payload_retention_days) < now();
  delete from public.import_queue where status = 'succeeded' and updated_at < now() - interval '30 days';

  return jsonb_build_object(
    'queuedImports', v_queued, 'venuesMarkedStale', v_stale,
    'expiredRateLimitsDeleted', v_deleted_rate_limits,
    'expiredClaimsDeleted', v_deleted_claims,
    'expiredReportsDeleted', v_deleted_reports,
    'venuesQualityRefreshed', v_quality_refreshed,
    'ranAt', now()
  );
end;
$$;

revoke all on function private.refresh_venue_quality(uuid) from public, anon, authenticated;
revoke all on function public.begin_import_run(text, text, text) from public, anon, authenticated;
revoke all on function public.ingest_source_observation(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.ingest_venue_record(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.ingest_source_observations_batch(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.finish_import_run(uuid, public.import_run_status, text, jsonb) from public, anon, authenticated;
revoke all on function public.catalog_maintenance() from public, anon, authenticated;

grant execute on function private.refresh_venue_quality(uuid) to service_role;
grant execute on function public.begin_import_run(text, text, text) to service_role;
grant execute on function public.ingest_source_observation(text, text, jsonb, uuid) to service_role;
grant execute on function public.ingest_venue_record(text, text, jsonb, uuid) to service_role;
grant execute on function public.ingest_source_observations_batch(text, jsonb, uuid) to service_role;
grant execute on function public.finish_import_run(uuid, public.import_run_status, text, jsonb) to service_role;
grant execute on function public.catalog_maintenance() to service_role;

comment on function public.ingest_source_observation is 'Stores licensed administrative/open-data evidence without falsely creating or opening a venue.';
comment on function public.ingest_venue_record is 'Conservative service-only upsert: creates draft records, tracks provenance, and queues ambiguous duplicates for review.';
comment on function public.catalog_maintenance is 'Idempotent scheduled maintenance: queues due sources, expires PII/rate limits, invalidates expired provenance and removes stale venues from recommendations.';

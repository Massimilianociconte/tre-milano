-- Le anagrafiche DS58/DS59 senza insegna usano come etichetta la
-- descrizione della licenza ("A - Ristorante, trattoria, ..."): non è un
-- nome commerciale e non giustifica una scheda pubblica. Bonifica dei
-- record già promossi e guardia permanente nella promozione.

update public.venues
set published_at = null,
    lifecycle_status = 'draft'
where maturity = 'bronze'
  and verification_status = 'unverified'
  and published_at is not null
  and display_name ~* '^[a-z]{1,3}\s*-\s';

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
      and trim(o.source_label) !~* '^[a-z]{1,3}\s*-\s'
      and lower(trim(o.source_label)) not in (
        'bar', 'caffe', 'caffè', 'caffetteria', 'ristorante', 'pizzeria', 'trattoria',
        'osteria', 'pasticceria', 'gelateria', 'enoteca', 'pub', 'birreria', 'tabacchi',
        'albergo', 'hotel', 'circolo', 'circolo privato', 'mensa', 'rosticceria',
        'macelleria', 'panificio', 'alimentari', 'tavola calda', 'tavola fredda',
        'bar tavola calda', 'bar tavola fredda', 'discoteca', 'sala giochi',
        'somministrazione', 'pubblico esercizio'
      )
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

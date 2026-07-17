-- Register the project's own category visuals as explicitly illustrative
-- editorial media. They are never described as photographs of the venue and
-- no third-party image is copied or hotlinked.

insert into public.sources(
  source_key,
  name,
  kind,
  base_url,
  terms_url,
  license_name,
  attribution_text,
  commercial_use_allowed,
  derivative_use_allowed,
  raw_payload_retention_days,
  reliability_score,
  priority,
  refresh_interval,
  enabled,
  requires_manual_review,
  metadata
) values (
  'tre_milano_editorial_assets',
  'TRE Milano — visual editoriali proprietari',
  'editorial',
  'https://tre-milano-preview-160726.netlify.app/',
  'https://tre-milano-preview-160726.netlify.app/termini/',
  'Proprietario TRE Milano',
  'Visual editoriale proprietario TRE Milano',
  true,
  true,
  0,
  1.000,
  5,
  interval '365 days',
  true,
  false,
  '{"mediaKind":"category_illustration","notVenuePhotography":true,"version":"v1"}'::jsonb
)
on conflict (source_key) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  terms_url = excluded.terms_url,
  license_name = excluded.license_name,
  attribution_text = excluded.attribution_text,
  commercial_use_allowed = excluded.commercial_use_allowed,
  derivative_use_allowed = excluded.derivative_use_allowed,
  reliability_score = excluded.reliability_score,
  priority = excluded.priority,
  enabled = excluded.enabled,
  requires_manual_review = excluded.requires_manual_review,
  metadata = excluded.metadata,
  updated_at = now();

with visuals(
  venue_slug,
  asset_path,
  asset_url,
  width,
  height,
  asset_checksum,
  category_label
) as (
  values
    ('camparino-in-galleria', '/images/venue-cocktail.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-cocktail.webp', 900, 1124, 'c3402fe52236f5da6b882007eb1c5864018e7e13fb16dec5a36666ef903df05e', 'cocktail bar'),
    ('nottingham-forest-milano', '/images/venue-cocktail.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-cocktail.webp', 900, 1124, 'c3402fe52236f5da6b882007eb1c5864018e7e13fb16dec5a36666ef903df05e', 'cocktail bar'),
    ('mandarin-garden', '/images/venue-cocktail.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-cocktail.webp', 900, 1124, 'c3402fe52236f5da6b882007eb1c5864018e7e13fb16dec5a36666ef903df05e', 'cocktail bar'),
    ('ceresio-7-pools-restaurant', '/images/hero-milano.webp', 'https://tre-milano-preview-160726.netlify.app/images/hero-milano.webp', 1672, 941, 'a971bca98bc3df3fd90b430b3210bb124d55bbf728079d7eb1346b3503a28838', 'rooftop'),
    ('armani-bamboo-bar', '/images/hero-milano.webp', 'https://tre-milano-preview-160726.netlify.app/images/hero-milano.webp', 1672, 941, 'a971bca98bc3df3fd90b430b3210bb124d55bbf728079d7eb1346b3503a28838', 'rooftop'),
    ('ristorante-cracco', '/images/venue-ristorante.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-ristorante.webp', 900, 1124, '19575e83f60f3065e2f752d589133c3a56b4aafa76304fd7f712103699a7cd08', 'ristorante')
)
insert into public.venue_images(
  venue_id,
  external_url,
  alt_text,
  caption,
  width,
  height,
  mime_type,
  rights_status,
  rights_holder,
  license_name,
  attribution_text,
  source_url,
  checksum_sha256,
  is_primary,
  display_order,
  approved_at
)
select
  venue.id,
  visual.asset_url,
  format(
    'Illustrazione editoriale TRE Milano per la categoria %s; non è una fotografia di %s',
    visual.category_label,
    venue.display_name
  ),
  'Visual di categoria; la composizione non documenta spazi o vista reale del locale.',
  visual.width,
  visual.height,
  'image/webp',
  'owned',
  'TRE Milano',
  'Proprietario TRE Milano',
  'Visual editoriale proprietario; non fotografia del locale.',
  visual.asset_url,
  visual.asset_checksum,
  true,
  1,
  now()
from visuals visual
join public.venues venue on venue.slug = visual.venue_slug
on conflict (venue_id) where is_primary do update set
  external_url = excluded.external_url,
  alt_text = excluded.alt_text,
  caption = excluded.caption,
  width = excluded.width,
  height = excluded.height,
  mime_type = excluded.mime_type,
  rights_status = excluded.rights_status,
  rights_holder = excluded.rights_holder,
  license_name = excluded.license_name,
  attribution_text = excluded.attribution_text,
  source_url = excluded.source_url,
  checksum_sha256 = excluded.checksum_sha256,
  display_order = excluded.display_order,
  approved_at = excluded.approved_at,
  expires_at = null;

with visuals(venue_slug, asset_path, asset_url, asset_checksum, category_label) as (
  values
    ('camparino-in-galleria', '/images/venue-cocktail.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-cocktail.webp', 'c3402fe52236f5da6b882007eb1c5864018e7e13fb16dec5a36666ef903df05e', 'cocktail bar'),
    ('nottingham-forest-milano', '/images/venue-cocktail.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-cocktail.webp', 'c3402fe52236f5da6b882007eb1c5864018e7e13fb16dec5a36666ef903df05e', 'cocktail bar'),
    ('mandarin-garden', '/images/venue-cocktail.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-cocktail.webp', 'c3402fe52236f5da6b882007eb1c5864018e7e13fb16dec5a36666ef903df05e', 'cocktail bar'),
    ('ceresio-7-pools-restaurant', '/images/hero-milano.webp', 'https://tre-milano-preview-160726.netlify.app/images/hero-milano.webp', 'a971bca98bc3df3fd90b430b3210bb124d55bbf728079d7eb1346b3503a28838', 'rooftop'),
    ('armani-bamboo-bar', '/images/hero-milano.webp', 'https://tre-milano-preview-160726.netlify.app/images/hero-milano.webp', 'a971bca98bc3df3fd90b430b3210bb124d55bbf728079d7eb1346b3503a28838', 'rooftop'),
    ('ristorante-cracco', '/images/venue-ristorante.webp', 'https://tre-milano-preview-160726.netlify.app/images/venue-ristorante.webp', '19575e83f60f3065e2f752d589133c3a56b4aafa76304fd7f712103699a7cd08', 'ristorante')
), payloads as (
  select
    venue.id as venue_id,
    venue.slug,
    visual.asset_url,
    jsonb_build_object(
      'assetPath', visual.asset_path,
      'assetUrl', visual.asset_url,
      'assetChecksumSha256', visual.asset_checksum,
      'mediaKind', 'category_illustration',
      'category', visual.category_label,
      'notVenuePhotography', true,
      'rightsHolder', 'TRE Milano'
    ) as payload
  from visuals visual
  join public.venues venue on venue.slug = visual.venue_slug
), source as (
  select id from public.sources where source_key = 'tre_milano_editorial_assets'
)
insert into public.source_records(
  source_id,
  external_id,
  venue_id,
  source_url,
  payload_checksum,
  normalized_payload,
  fetched_at,
  expires_at,
  last_seen_at
)
select
  source.id,
  'editorial-visual:' || payload.slug || ':v1',
  payload.venue_id,
  payload.asset_url,
  encode(extensions.digest(payload.payload::text, 'sha256'), 'hex'),
  payload.payload,
  now(),
  null,
  now()
from payloads payload
cross join source
on conflict (source_id, external_id) do update set
  venue_id = excluded.venue_id,
  source_url = excluded.source_url,
  payload_checksum = excluded.payload_checksum,
  normalized_payload = excluded.normalized_payload,
  fetched_at = excluded.fetched_at,
  expires_at = null,
  last_seen_at = now(),
  deleted_at_source = false;

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
  source_record.venue_id,
  'images.editorial_visual',
  source_record.id,
  1.000,
  source_record.fetched_at,
  null,
  true
from public.source_records source_record
join public.sources source on source.id = source_record.source_id
where source.source_key = 'tre_milano_editorial_assets'
  and source_record.external_id like 'editorial-visual:%:v1'
on conflict (venue_id, field_path, source_record_id) do update set
  confidence = excluded.confidence,
  observed_at = excluded.observed_at,
  valid_until = null,
  selected = true;

do $$
declare
  venue_id uuid;
  eligible_count integer;
begin
  for venue_id in
    select id from public.venues
    where slug in (
      'camparino-in-galleria',
      'nottingham-forest-milano',
      'ceresio-7-pools-restaurant',
      'ristorante-cracco',
      'mandarin-garden',
      'armani-bamboo-bar'
    )
  loop
    perform private.refresh_venue_quality(venue_id);
  end loop;

  select count(*) into eligible_count
  from public.venues
  where slug in (
      'camparino-in-galleria',
      'nottingham-forest-milano',
      'ceresio-7-pools-restaurant',
      'ristorante-cracco',
      'mandarin-garden',
      'armani-bamboo-bar'
    )
    and recommendation_eligible
    and maturity in ('gold', 'platinum');

  if eligible_count <> 6 then
    raise exception 'expected six recommendation-eligible venues, found %', eligible_count
      using errcode = '55000';
  end if;
end;
$$;

-- OpenStreetMap is approved here only as provenance for reviewed, one-off
-- geocoding records. Keeping api_url null prevents the scheduled maintenance
-- job from treating the shared Overpass service as an automatic crawl source.
update public.sources
set enabled = true,
    api_url = null,
    terms_url = 'https://operations.osmfoundation.org/policies/nominatim/',
    requires_manual_review = true,
    metadata = metadata || jsonb_build_object(
      'ingestionScope', 'reviewed_geocoding_only',
      'legalReviewStatus', 'approved_odbl_manual_lookup',
      'approvedAt', '2026-07-17',
      'automaticImportAllowed', false,
      'overpassEndpoint', 'https://overpass-api.de/api/interpreter',
      'nominatimPolicy', 'https://operations.osmfoundation.org/policies/nominatim/'
    ),
    next_refresh_at = null,
    updated_at = now()
where source_key = 'openstreetmap'
  and license_name = 'ODbL 1.0'
  and commercial_use_allowed
  and derivative_use_allowed;

do $$
begin
  if not exists (
    select 1
    from public.sources
    where source_key = 'openstreetmap'
      and enabled
      and api_url is null
      and metadata->>'ingestionScope' = 'reviewed_geocoding_only'
  ) then
    raise exception 'reviewed_osm_source_not_configured' using errcode = '55000';
  end if;
end;
$$;

-- Restore only current records that were already attached by the explicit
-- editorial review RPC. A newer selected source always wins.
with ranked_osm as (
  select
    vfs.venue_id,
    vfs.source_record_id,
    row_number() over (
      partition by vfs.venue_id, vfs.field_path
      order by sr.fetched_at desc, vfs.observed_at desc, vfs.source_record_id
    ) as evidence_rank
  from public.venue_field_sources vfs
  join public.source_records sr on sr.id = vfs.source_record_id
  join public.sources src on src.id = sr.source_id
  where src.source_key = 'openstreetmap'
    and vfs.field_path = 'address.geolocation'
    and not sr.deleted_at_source
    and (sr.expires_at is null or sr.expires_at > now())
    and (vfs.valid_until is null or vfs.valid_until > now())
    and vfs.observed_at <= now()
), candidates as (
  select ranked.venue_id, ranked.source_record_id
  from ranked_osm ranked
  where ranked.evidence_rank = 1
    and not exists (
      select 1
      from public.venue_field_sources current_evidence
      where current_evidence.venue_id = ranked.venue_id
        and current_evidence.field_path = 'address.geolocation'
        and current_evidence.selected
    )
)
update public.venue_field_sources vfs
set selected = true
from candidates candidate
where vfs.venue_id = candidate.venue_id
  and vfs.field_path = 'address.geolocation'
  and vfs.source_record_id = candidate.source_record_id;

do $$
declare
  affected_venue_id uuid;
begin
  for affected_venue_id in
    select distinct vfs.venue_id
    from public.venue_field_sources vfs
    join public.source_records sr on sr.id = vfs.source_record_id
    join public.sources src on src.id = sr.source_id
    where src.source_key = 'openstreetmap'
      and vfs.field_path = 'address.geolocation'
      and vfs.selected
  loop
    perform private.refresh_venue_quality(affected_venue_id);
  end loop;
end;
$$;

comment on column public.sources.enabled is
  'Approval gate for evidence use. Automatic scheduling additionally requires a non-null api_url; manual-only approved sources keep api_url null.';

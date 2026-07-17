-- Enable only the legally reviewed, CC BY 4.0 municipal adapters. Their RPC is
-- structurally limited to `source_observations`: these historical 2023 rows
-- can assist deduplication and manual verification but can never create or
-- publish a venue automatically.
update public.sources
set enabled = true,
    requires_manual_review = true,
    next_refresh_at = now() + interval '90 days',
    metadata = metadata || jsonb_build_object(
      'ingestionScope', 'private_observations_only',
      'legalReviewStatus', 'approved_cc_by_4_0',
      'approvedAt', '2026-07-17',
      'neverInferOpen', true
    ),
    updated_at = now()
where source_key in (
  'comune_milano_ds58',
  'comune_milano_ds59',
  'comune_milano_ds250'
)
  and license_name = 'CC BY 4.0'
  and commercial_use_allowed
  and derivative_use_allowed;

do $$
declare
  enabled_count integer;
begin
  select count(*) into enabled_count
  from public.sources
  where source_key in (
    'comune_milano_ds58',
    'comune_milano_ds59',
    'comune_milano_ds250'
  ) and enabled;

  if enabled_count <> 3 then
    raise exception 'expected three approved Milano observation sources, found %', enabled_count
      using errcode = '55000';
  end if;
end;
$$;

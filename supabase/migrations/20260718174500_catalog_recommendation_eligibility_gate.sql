-- Keep recommendation eligibility authoritative without widening the public
-- catalog surface. The backend resolves one bounded page in a single batch;
-- browser roles retain no direct table or RPC access.

create or replace function public.get_venue_recommendation_eligibility(
  p_venue_ids uuid[]
)
returns table (
  id uuid,
  recommendation_eligible boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(coalesce(p_venue_ids, '{}'::uuid[])) > 51 then
    raise exception 'too_many_venue_ids' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_venue_ids, '{}'::uuid[])) requested(id)
    where requested.id is null
  ) then
    raise exception 'invalid_venue_id' using errcode = '22023';
  end if;

  return query
  select v.id, v.recommendation_eligible
  from public.venues v
  where v.id = any(coalesce(p_venue_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.get_venue_recommendation_eligibility(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_venue_recommendation_eligibility(uuid[])
  to service_role;

comment on function public.get_venue_recommendation_eligibility(uuid[]) is
  'Service-only bounded batch lookup used to enforce the authoritative recommendation gate after catalog projection.';

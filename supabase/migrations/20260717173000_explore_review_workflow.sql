-- Revisione progressiva delle schede explore-only: bronze -> silver con
-- verifica umana dichiarata, oppure de-pubblicazione. Il passaggio a Gold e
-- l'idoneità alle raccomandazioni restano riservati al workflow editoriale
-- ufficiale già esistente (official_catalog_review_workflow).

create or replace function public.review_explore_venue(
  p_slug text,
  p_action text,
  p_reviewer text,
  p_display_name text default null,
  p_category_slug text default null,
  p_neighborhood_slug text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_venue public.venues%rowtype;
  v_previous jsonb;
  v_category_id uuid;
  v_neighborhood_id uuid;
begin
  if p_action not in ('verify-silver', 'unpublish') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  if p_reviewer is null or char_length(trim(p_reviewer)) < 3 then
    raise exception 'reviewer_required' using errcode = '22023';
  end if;

  select * into v_venue from public.venues where slug = p_slug for update;
  if not found then
    raise exception 'venue_not_found' using errcode = '22023';
  end if;
  if v_venue.maturity in ('gold', 'platinum') then
    raise exception 'not_an_explore_record' using errcode = '22023';
  end if;

  v_previous := jsonb_build_object(
    'displayName', v_venue.display_name,
    'verificationStatus', v_venue.verification_status,
    'maturity', v_venue.maturity,
    'lifecycleStatus', v_venue.lifecycle_status,
    'publishedAt', v_venue.published_at
  );

  if p_action = 'unpublish' then
    update public.venues
    set published_at = null,
        lifecycle_status = 'draft',
        updated_at = now()
    where id = v_venue.id;
  else
    if p_category_slug is not null then
      select id into v_category_id from public.categories where slug = p_category_slug and active;
      if v_category_id is null then
        raise exception 'invalid_category' using errcode = '22023';
      end if;
    end if;
    if p_neighborhood_slug is not null then
      select id into v_neighborhood_id from public.neighborhoods where slug = p_neighborhood_slug;
      if v_neighborhood_id is null then
        raise exception 'invalid_neighborhood' using errcode = '22023';
      end if;
      update public.venue_addresses
      set neighborhood_id = v_neighborhood_id, updated_at = now()
      where venue_id = v_venue.id and is_primary and valid_until is null;
    end if;

    update public.venues
    set display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
        official_name = coalesce(nullif(trim(p_display_name), ''), official_name),
        category_id = coalesce(v_category_id, category_id),
        verification_status = 'verified',
        maturity = 'silver',
        confidence_score = greatest(confidence_score, 0.55),
        quality_score = greatest(quality_score, 35),
        verified_at = now(),
        stale_after = now() + interval '180 days',
        lifecycle_status = 'active',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = v_venue.id;
  end if;

  insert into public.venue_update_history (venue_id, actor_type, change_type, previous_values, new_values, reason)
  values (
    v_venue.id,
    'editor',
    'explore_review:' || p_action,
    v_previous,
    (select jsonb_build_object(
      'displayName', v.display_name,
      'verificationStatus', v.verification_status,
      'maturity', v.maturity,
      'lifecycleStatus', v.lifecycle_status,
      'publishedAt', v.published_at
    ) from public.venues v where v.id = v_venue.id),
    left(coalesce(p_reason, '') || ' [reviewer: ' || trim(p_reviewer) || ']', 500)
  );

  return (select jsonb_build_object(
    'slug', v.slug,
    'action', p_action,
    'maturity', v.maturity,
    'verificationStatus', v.verification_status,
    'published', v.published_at is not null
  ) from public.venues v where v.id = v_venue.id);
end;
$$;

revoke all on function public.review_explore_venue(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.review_explore_venue(text, text, text, text, text, text, text) to service_role;
comment on function public.review_explore_venue is 'Human review step for explore-only records: verify-silver (with optional corrections) or unpublish. Gold promotion stays in the official editorial workflow. Every action is logged in venue_update_history with the declared reviewer.';

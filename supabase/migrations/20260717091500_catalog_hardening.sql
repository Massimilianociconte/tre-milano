-- Production hardening discovered during the first linked-project preflight.
-- This migration is intentionally safe on a clean project and on projects that
-- already contain the optional `public.rls_auto_enable` helper.

-- A helper created outside TRE migrations was found executable by public API
-- roles on the linked project. Revoke every overload without assuming its
-- signature or dropping a function that may be owned by project tooling.
do $$
declare
  function_signature text;
begin
  for function_signature in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)
    )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'rls_auto_enable'
      and procedure.prokind = 'f'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      function_signature
    );
  end loop;
end;
$$;

-- `unaccent` is installed in the non-exposed extensions schema. It is STABLE,
-- not IMMUTABLE, so the wrapper uses the honest volatility classification.
-- This preserves Italian accented letters during slug/fingerprint creation
-- before the final ASCII allow-list is applied.
do $$
declare
  installed_schema text;
begin
  select namespace.nspname
  into installed_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'unaccent';

  if installed_schema is not null and installed_schema <> 'extensions' then
    raise exception
      'unaccent is installed in schema %, expected extensions',
      installed_schema
      using errcode = '55000';
  end if;
end;
$$;

create extension if not exists unaccent with schema extensions;

create or replace function private.normalize_identity(value text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select trim(
    both '-'
    from regexp_replace(
      lower(extensions.unaccent(value)),
      '[^a-z0-9]+',
      '-',
      'g'
    )
  );
$$;

revoke execute on function private.normalize_identity(text) from public, anon, authenticated;
grant execute on function private.normalize_identity(text) to service_role;

-- A venue subcategory must belong to the venue category. The previous
-- single-column FK guaranteed that the subcategory existed but did not enforce
-- this cross-column relationship. Reference data is deactivated rather than
-- deleted, therefore RESTRICT is the safest deletion behaviour.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.subcategories'::regclass
      and conname = 'subcategories_id_category_id_key'
  ) then
    alter table public.subcategories
      add constraint subcategories_id_category_id_key unique (id, category_id);
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.venues'::regclass
      and conname = 'venues_subcategory_id_fkey'
  ) then
    alter table public.venues
      drop constraint venues_subcategory_id_fkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.venues'::regclass
      and conname = 'venues_subcategory_category_fkey'
  ) then
    alter table public.venues
      add constraint venues_subcategory_category_fkey
      foreign key (subcategory_id, category_id)
      references public.subcategories(id, category_id)
      on update restrict
      on delete restrict;
  end if;
end;
$$;

-- Complete FK coverage for cascade/restrict checks and the principal reverse
-- lookups. Existing PK/unique/operational indexes already cover the remaining
-- leading FK columns and are deliberately not duplicated here.
create index if not exists neighborhoods_municipality_fk_idx
  on public.neighborhoods (municipality_id)
  where municipality_id is not null;

create index if not exists venues_category_fk_idx
  on public.venues (category_id);

create index if not exists venues_subcategory_category_fk_idx
  on public.venues (subcategory_id, category_id)
  where subcategory_id is not null;

create index if not exists venue_addresses_venue_fk_idx
  on public.venue_addresses (venue_id);

create index if not exists venue_addresses_neighborhood_fk_idx
  on public.venue_addresses (neighborhood_id)
  where neighborhood_id is not null;

create index if not exists venue_addresses_municipality_fk_idx
  on public.venue_addresses (municipality_id)
  where municipality_id is not null;

create index if not exists venue_images_venue_fk_idx
  on public.venue_images (venue_id);

create index if not exists source_observations_municipality_fk_idx
  on public.source_observations (municipality_id)
  where municipality_id is not null;

create index if not exists source_observations_linked_venue_fk_idx
  on public.source_observations (linked_venue_id)
  where linked_venue_id is not null;

create index if not exists venue_field_sources_source_record_fk_idx
  on public.venue_field_sources (source_record_id);

create index if not exists review_aggregates_source_fk_idx
  on public.review_aggregates (source_id);

create index if not exists ranking_entries_venue_fk_idx
  on public.ranking_entries (venue_id);

create index if not exists podium_entries_venue_fk_idx
  on public.podium_entries (venue_id);

create index if not exists guide_venues_venue_fk_idx
  on public.guide_venues (venue_id);

create index if not exists user_reports_venue_fk_idx
  on public.user_reports (venue_id)
  where venue_id is not null;

create index if not exists venue_claims_venue_fk_idx
  on public.venue_claims (venue_id);

create index if not exists venue_claims_reviewed_by_fk_idx
  on public.venue_claims (reviewed_by)
  where reviewed_by is not null;

create index if not exists venue_update_history_source_record_fk_idx
  on public.venue_update_history (source_record_id)
  where source_record_id is not null;

create index if not exists duplicate_candidates_venue_b_fk_idx
  on public.duplicate_candidates (venue_id_b);

create index if not exists duplicate_candidates_reviewed_by_fk_idx
  on public.duplicate_candidates (reviewed_by)
  where reviewed_by is not null;

create index if not exists import_runs_source_fk_idx
  on public.import_runs (source_id, created_at desc);

create index if not exists import_errors_run_fk_idx
  on public.import_errors (import_run_id, occurred_at desc);

create index if not exists import_queue_run_fk_idx
  on public.import_queue (import_run_id, id);

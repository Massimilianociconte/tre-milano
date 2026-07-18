begin;
select plan(37);

select has_schema('private', 'private schema exists');
select ok(exists (select 1 from pg_extension where extname = 'postgis'), 'PostGIS is installed');
select ok(exists (select 1 from pg_extension where extname = 'pg_trgm'), 'pg_trgm is installed');
select has_table('public', 'venues', 'venues table exists');
select has_table('public', 'venue_addresses', 'spatial addresses exist');
select has_table('public', 'venue_field_sources', 'field provenance exists');
select has_table('public', 'source_observations', 'non-public administrative observations exist');
select has_table('public', 'import_runs', 'import audit log exists');
select has_table('public', 'venue_claims', 'owner claims exist');
select has_index('public', 'venue_addresses', 'venue_addresses_location_gist_idx', 'spatial GIST index exists');
select has_index('public', 'venues', 'venues_search_document_gin_idx', 'full-text GIN index exists');
select has_function('public', 'search_venues', 'catalog search RPC exists');
select has_function('public', 'get_venue_recommendation_eligibility', 'recommendation eligibility RPC exists');
select has_function('public', 'get_venue_detail', 'detail RPC exists');
select has_function('private', 'catalog_venue_source_attribution', 'observation attribution projection exists');
select has_function('public', 'consume_api_rate_limit', 'persistent rate limit RPC exists');
select has_function('public', 'ingest_venue_record', 'conservative venue ingest RPC exists');
select has_function('public', 'ingest_source_observation', 'observation ingest RPC exists');
select has_function('public', 'catalog_maintenance', 'maintenance RPC exists');

select ok((
  select bool_and(c.relrowsecurity and c.relforcerowsecurity)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('venues', 'venue_addresses', 'venue_claims', 'source_records', 'source_observations', 'import_runs', 'api_rate_limits')
), 'sensitive and catalog tables force RLS');

select ok(not has_table_privilege('anon', 'public.venues', 'SELECT'), 'anon cannot read catalog tables directly');
select ok(not has_table_privilege('authenticated', 'public.venue_claims', 'SELECT'), 'authenticated cannot read claims');
select ok(has_table_privilege('service_role', 'public.venues', 'SELECT'), 'service role can access catalog through backend');
select ok(not has_function_privilege('anon', 'public.get_venue_detail(text)', 'EXECUTE'), 'anon cannot call detail RPC directly');
select ok(has_function_privilege('service_role', 'public.get_venue_detail(text)', 'EXECUTE'), 'service role can call detail RPC');
select ok(not has_function_privilege('anon', 'public.get_venue_recommendation_eligibility(uuid[])', 'EXECUTE'), 'anon cannot call recommendation eligibility RPC');
select ok(has_function_privilege('service_role', 'public.get_venue_recommendation_eligibility(uuid[])', 'EXECUTE'), 'service role can resolve recommendation eligibility in a bounded batch');

select is_empty('select id from public.venues', 'seed contains no simulated venue records');
select ok((select bool_and(not enabled) from public.sources), 'all source adapters start disabled pending approval');

select ok((
  select position('octet_length(p_payload::text)' in pg_get_functiondef(p.oid)) > 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ingest_venue_record'
), 'venue ingest enforces a server-side payload size limit');

select ok((
  select position('stale_after = greatest' in pg_get_functiondef(p.oid)) = 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ingest_venue_record'
), 'unreviewed imports cannot renew public freshness');

select ok((
  select position('vp.verified_at is not null' in pg_get_functiondef(p.oid)) > 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_venues'
), 'catalog search exposes only verified current prices');

select ok((
  select position('p_open_now boolean default false' in lower(pg_get_functiondef(p.oid))) > 0
    and position('venue_hour_exceptions' in lower(pg_get_functiondef(p.oid))) > 0
    and position('europe/rome' in lower(pg_get_functiondef(p.oid))) > 0
    and position('not p_open_now or opening.is_open_now' in lower(pg_get_functiondef(p.oid))) > 0
    and position('v.verification_status' in lower(pg_get_functiondef(p.oid))) > 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_venues'
), 'catalog search filters verified open-now windows server-side and projects verification status');

select ok((
  select position('vp.verified_at is not null' in pg_get_functiondef(p.oid)) > 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_venue_detail'
), 'venue detail exposes only verified current prices');

select ok((
  select position('linked_venue_id' in pg_get_functiondef(p.oid)) > 0
    and position('observed_through' in pg_get_functiondef(p.oid)) > 0
    and position('normalized_payload' in pg_get_functiondef(p.oid)) = 0
    and position('external_id' in pg_get_functiondef(p.oid)) = 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'catalog_venue_source_attribution'
), 'linked observations expose attribution without internal payload or identifiers');

select ok((
  select position('src.enabled' in pg_get_functiondef(p.oid)) > 0
    and position('vfs.valid_until' in pg_get_functiondef(p.oid)) > 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'refresh_venue_quality'
), 'quality refresh excludes disabled and expired provenance');

select ok((
  select position('update public.venue_field_sources vfs set selected = false' in pg_get_functiondef(p.oid)) > 0
    and position('perform private.refresh_venue_quality(v_venue_id)' in pg_get_functiondef(p.oid)) > 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'catalog_maintenance'
), 'daily maintenance invalidates expired evidence and refreshes materialized quality');

select * from finish();
rollback;

-- Hosted publish/read regression. Run only after an operator has explicitly
-- configured and reviewed the disposable publication bucket as described in README.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before execution. Never use production.
begin;

-- The rerun fixture deliberately leaves a mismatched projection sentinel to
-- prove migrations preserve conflicts. Remove only its exact harness rows from
-- this transaction so it does not block unrelated lifecycle scenarios.
do $rerun_sentinel_preflight$
begin
  if exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-rerun-sentinel'
      and (status <> 'draft'
        or revision <> 7
        or draft_payload is distinct from '{"title":"CMS sentinel","visibility":false}'::jsonb
        or published_payload is not null)
  ) or exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects'
      and record_id = 'validation-rerun-sentinel'
      and published_payload is distinct from '{"title":"Projection sentinel - preserve exactly","visibility":true,"sentinel":731}'::jsonb
  ) then
    raise exception 'STOP: rerun sentinel differs from the validation fixture; inspect it before running lifecycle tests.';
  end if;
end;
$rerun_sentinel_preflight$;
delete from public.portfolio_cms_records
where content_type = 'projects' and record_id = 'validation-rerun-sentinel';
delete from public.portfolio_cms_public_records
where content_type = 'projects' and record_id = 'validation-rerun-sentinel';

do $preflight$
declare
  v_configured_ref constant text := 'ifakxmugmdcjyhytzpwx';
  v_reason text;
begin
  if v_configured_ref <> 'ifakxmugmdcjyhytzpwx'
     or not exists (
       select 1 from public.cms_validation_scope
       where scope_name = 'portfolio-cms-migration-test'
         and verified_project_ref = 'ifakxmugmdcjyhytzpwx'
     ) then
    raise exception 'STOP: disposable-project marker/ref mismatch.';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'portfolio-published' and public
  ) then
    raise exception 'NOT RUN: portfolio-published is private. Do not change visibility just for this test; run only after an operator has explicitly approved and configured publication in the disposable project.';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'portfolio-private' and not public
  ) then
    raise exception 'STOP: portfolio-private must exist and remain private.';
  end if;
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
    true
  );
  v_reason := public.cms_publication_block_reason();
  if v_reason <> '' then
    raise exception 'NOT RUN: trusted operator setup/audit is incomplete: %', v_reason;
  end if;
end;
$preflight$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select public.cms_save_record(
  'projects',
  'validation-public-lifecycle',
  '{"title":"Lifecycle public fixture","slug":"validation-public-lifecycle","visibility":true}'::jsonb,
  0
);
select public.cms_publish_record(
  'projects',
  'validation-public-lifecycle',
  1,
  '{"title":"Lifecycle public fixture","slug":"validation-public-lifecycle","visibility":true}'::jsonb
);
select public.cms_save_record(
  'projects',
  'validation-public-lifecycle-draft',
  '{"title":"Lifecycle private draft","slug":"validation-public-lifecycle-draft","visibility":true}'::jsonb,
  0
);

do $published_parity$
begin
  if not public.cms_public_content_audited() then
    raise exception 'FAIL: a normal publication did not leave current storage/projection parity valid.';
  end if;
end;
$published_parity$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $anonymous_after_publish$
declare
  v_count integer;
begin
  if not has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select') then
    raise notice 'SKIP: anon has no table-level SELECT grant; database read assertion is not executable for this role.';
    return;
  end if;
  execute $query$
    select count(*) from public.portfolio_cms_public_records
    where (content_type = 'projects' and record_id = 'validation-public-lifecycle')
       or (content_type = 'projects' and record_id = 'validation-legacy-published')
  $query$ into v_count;
  if v_count <> 2 then
    raise exception 'FAIL: anonymous reads did not return the new published project and unrelated existing published project.';
  end if;
  execute $query$
    select count(*) from public.portfolio_cms_public_records
    where record_id = 'validation-public-lifecycle-draft'
  $query$ into v_count;
  if v_count <> 0 then
    raise exception 'FAIL: a draft appeared in anonymous public reads.';
  end if;
end;
$anonymous_after_publish$;
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select public.cms_unpublish_record('projects', 'validation-public-lifecycle');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $anonymous_after_unpublish$
declare
  v_count integer;
begin
  if not has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select') then
    raise notice 'SKIP: anon has no table-level SELECT grant; database read assertion is not executable for this role.';
    return;
  end if;
  execute $query$
    select count(*) from public.portfolio_cms_public_records
    where record_id in ('validation-public-lifecycle', 'validation-legacy-published')
  $query$ into v_count;
  if v_count <> 1 then
    raise exception 'FAIL: unpublishing one project hid unrelated published content or left the unpublished projection visible.';
  end if;
end;
$anonymous_after_unpublish$;
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
select public.cms_save_record(
  'projects',
  'validation-public-delete',
  '{"title":"Lifecycle delete fixture","slug":"validation-public-delete","visibility":true}'::jsonb,
  0
);
select public.cms_publish_record(
  'projects',
  'validation-public-delete',
  1,
  '{"title":"Lifecycle delete fixture","slug":"validation-public-delete","visibility":true}'::jsonb
);
select public.cms_delete_record('projects', 'validation-public-delete');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $anonymous_after_delete$
declare
  v_count integer;
begin
  if not has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select') then
    raise notice 'SKIP: anon has no table-level SELECT grant; database read assertion is not executable for this role.';
    return;
  end if;
  execute $query$
    select count(*) from public.portfolio_cms_public_records
    where record_id in ('validation-public-delete', 'validation-legacy-published')
  $query$ into v_count;
  if v_count <> 1 then
    raise exception 'FAIL: deleting one project hid unrelated published content or retained the deleted projection.';
  end if;
end;
$anonymous_after_delete$;
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
update public.portfolio_cms_public_records
set published_payload = '{"title":"Stale projection","visibility":true}'::jsonb
where content_type = 'projects' and record_id = 'validation-legacy-published';
do $stale_projection$
begin
  if public.cms_public_content_audited() then
    raise exception 'FAIL: a stale public projection passed dynamic parity validation.';
  end if;
end;
$stale_projection$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $anonymous_stale_projection$
declare
  v_count integer;
begin
  if has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select') then
    execute 'select count(*) from public.portfolio_cms_public_records' into v_count;
    if v_count <> 0 then
      raise exception 'FAIL: anonymous reads exposed public records while projection parity was stale.';
    end if;
  else
    raise notice 'SKIP: anon has no table-level SELECT grant; stale-projection read assertion is not executable for this role.';
  end if;
end;
$anonymous_stale_projection$;
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
update public.portfolio_cms_public_records projection
set published_payload = source.published_payload
from public.portfolio_cms_records source
where source.content_type = projection.content_type
  and source.record_id = projection.record_id
  and projection.content_type = 'projects'
  and projection.record_id = 'validation-legacy-published';
do $restored_projection$
begin
  if not public.cms_public_content_audited() then
    raise exception 'FAIL: restoring exact source/projection parity did not restore public-read eligibility.';
  end if;
end;
$restored_projection$;

-- Simulate the resulting audit state after an expected managed asset copy or
-- cleanup; the storage-object trigger itself is checked in post-migration tests.
update public.portfolio_cms_storage_audit
set audited_at = null, projections_audited_at = null
where bucket_id = 'portfolio-published';
do $audit_invalidated_publish_gate$
declare
  v_reason text;
  v_blocked boolean := false;
begin
  v_reason := public.cms_publication_block_reason();
  if position('review the portfolio-published bucket contents' in v_reason) = 0 then
    raise exception 'FAIL: a Storage audit invalidation did not require a trusted review before the next publication: %', v_reason;
  end if;
  begin
    perform public.cms_publish_record(
      'projects',
      'validation-public-lifecycle-draft',
      1,
      '{"title":"Lifecycle private draft","slug":"validation-public-lifecycle-draft","visibility":true}'::jsonb
    );
  exception when sqlstate '55000' then
    v_blocked := position('review the portfolio-published bucket contents' in sqlerrm) > 0;
  end;
  if not v_blocked or not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-public-lifecycle-draft'
      and status = 'draft'
      and published_payload is null
  ) then
    raise exception 'FAIL: publication after Storage audit invalidation was not blocked cleanly.';
  end if;
end;
$audit_invalidated_publish_gate$;
do $audit_invalidated_read$
begin
  if not public.cms_public_content_audited() then
    raise exception 'FAIL: storage-content audit invalidation incorrectly disabled valid projection reads.';
  end if;
end;
$audit_invalidated_read$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $anonymous_after_audit_invalidation$
declare
  v_count integer;
begin
  if not has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select') then
    raise notice 'SKIP: anon has no table-level SELECT grant; database read assertion is not executable for this role.';
    return;
  end if;
  execute $query$
    select count(*) from public.portfolio_cms_public_records
    where record_id = 'validation-legacy-published'
  $query$ into v_count;
  if v_count <> 1 then
    raise exception 'FAIL: invalidating the Storage content-review timestamp hid an otherwise safe public projection.';
  end if;
end;
$anonymous_after_audit_invalidation$;
reset role;

rollback;

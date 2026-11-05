-- REVIEW ONLY: run this whole script in SQL Editor session A while starting
-- 09_publication_concurrency_session_b.sql in an independent session within
-- two seconds. Use only the verified disposable project.
begin;
select pg_backend_pid() as session_a_backend_pid;
set local statement_timeout = '45s';
set local lock_timeout = '30s';
do $scope_and_fixtures$
begin
  if not exists (
    select 1 from public.cms_validation_scope
    where scope_name = 'portfolio-cms-migration-test'
      and verified_project_ref = 'ifakxmugmdcjyhytzpwx'
  ) then
    raise exception 'STOP: this test is restricted to the verified disposable project.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-concurrency-a'
      and status = 'draft' and revision = 1
  ) then
    raise exception 'STOP: the expected session-A draft fixture is missing or changed.';
  end if;
end;
$scope_and_fixtures$;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select public.cms_publish_record(
  'projects',
  'validation-concurrency-a',
  1,
  '{"title":"Concurrency fixture A","slug":"validation-concurrency-a","visibility":true}'::jsonb
);
select pg_sleep(8);
set constraints all immediate;

do $first_publication_verified$
begin
  if not public.cms_publication_generation_is_verified()
    or not exists (
      select 1 from public.portfolio_cms_records
      where content_type = 'projects'
        and record_id = 'validation-concurrency-a'
        and published_payload ->> 'visibility' = 'true'
    )
  then
    raise exception 'FAIL: first concurrent publication did not finish in a verified state.';
  end if;
end;
$first_publication_verified$;
commit;

select pg_sleep(1);
begin;
set local statement_timeout = '45s';
set local lock_timeout = '30s';
update public.portfolio_cms_records
set published_payload = jsonb_set(
  published_payload,
  '{concurrencyProbe}',
  '"audit-owner"'::jsonb,
  true
)
where content_type = 'projects'
  and record_id = 'validation-concurrency-a';
select pg_sleep(8);
set constraints all immediate;

do $audit_serialized_before_invalidation$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
    or not exists (
      select 1 from public.portfolio_cms_records
      where content_type = 'projects'
        and record_id = 'validation-concurrency-a'
        and published_payload ->> 'concurrencyProbe' = 'audit-owner'
    )
    or exists (
      select 1 from public.portfolio_cms_records
      where content_type = 'projects'
        and record_id = 'validation-concurrency-b'
        and published_payload ->> 'concurrencyProbe' = 'concurrent-invalidator'
    )
  then
    raise exception 'FAIL: the audit did not verify its own committed view while the newer mutation was serialized behind the state lock.';
  end if;
end;
$audit_serialized_before_invalidation$;
commit;

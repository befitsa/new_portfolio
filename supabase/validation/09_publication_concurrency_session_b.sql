-- REVIEW ONLY: run this whole script in SQL Editor session B immediately after
-- starting 09_publication_concurrency_session_a.sql in session A.
-- It must block on the singleton generation row during both phases.
select pg_sleep(2);
begin;
select pg_backend_pid() as session_b_backend_pid;
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
      and record_id = 'validation-concurrency-b'
      and status = 'draft' and revision = 1
  ) then
    raise exception 'STOP: the expected session-B draft fixture is missing or changed.';
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
create temporary table concurrency_generation_before_publish (
  publication_generation bigint not null
) on commit drop;
insert into concurrency_generation_before_publish
select publication_generation
from public.portfolio_cms_publication_verification
where singleton;

select public.cms_publish_record(
  'projects',
  'validation-concurrency-b',
  1,
  '{"title":"Concurrency fixture B","slug":"validation-concurrency-b","visibility":true}'::jsonb
);
set constraints all immediate;

do $both_publications_verified$
declare
  v_generation bigint;
  v_previous_generation bigint;
begin
  select publication_generation
    into v_generation
  from public.portfolio_cms_publication_verification
  where singleton;
  select publication_generation
    into v_previous_generation
  from concurrency_generation_before_publish;
  if v_generation <= v_previous_generation
    or not public.cms_publication_generation_is_verified()
    or (
      select count(*) from public.portfolio_cms_public_records
      where content_type = 'projects'
        and record_id in ('validation-concurrency-a', 'validation-concurrency-b')
    ) <> 2
  then
    raise exception 'FAIL: both concurrent publications did not serialize to a verified generation.';
  end if;
end;
$both_publications_verified$;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $both_publications_visible$
begin
  if (
    select count(*) from public.portfolio_cms_public_records
    where content_type = 'projects'
      and record_id in ('validation-concurrency-a', 'validation-concurrency-b')
  ) <> 2
  then
    raise exception 'FAIL: anonymous reads did not expose both safe concurrent publications.';
  end if;
end;
$both_publications_visible$;
reset role;
commit;

select pg_sleep(2);
begin;
set local statement_timeout = '45s';
set local lock_timeout = '30s';
create temporary table concurrency_generation_before_invalidation (
  publication_generation bigint not null
) on commit drop;
insert into concurrency_generation_before_invalidation
select publication_generation
from public.portfolio_cms_publication_verification
where singleton;

update public.portfolio_cms_records
set published_payload = jsonb_set(
  published_payload,
  '{concurrencyProbe}',
  '"concurrent-invalidator"'::jsonb,
  true
)
where content_type = 'projects'
  and record_id = 'validation-concurrency-b';
set constraints all immediate;

do $invalidation_follows_audit$
declare
  v_generation bigint;
  v_previous_generation bigint;
begin
  select publication_generation
    into v_generation
  from public.portfolio_cms_publication_verification
  where singleton;
  select publication_generation
    into v_previous_generation
  from concurrency_generation_before_invalidation;
  if v_generation <= v_previous_generation
    or not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
    or not exists (
      select 1 from public.portfolio_cms_public_records
      where content_type = 'projects'
        and record_id = 'validation-concurrency-a'
        and published_payload ->> 'concurrencyProbe' = 'audit-owner'
    )
    or not exists (
      select 1 from public.portfolio_cms_public_records
      where content_type = 'projects'
        and record_id = 'validation-concurrency-b'
        and published_payload ->> 'concurrencyProbe' = 'concurrent-invalidator'
    )
  then
    raise exception 'FAIL: the later invalidation was overwritten by an older audit or failed to verify its own generation.';
  end if;
end;
$invalidation_follows_audit$;
commit;

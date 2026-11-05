-- REVIEW ONLY: run only in the verified disposable project.
-- This creates two committed draft fixtures for the paired two-session test.
-- Verify Dashboard project name portfolio-cms-test and ref
-- ifakxmugmdcjyhytzpwx. Run the paired scripts promptly after this setup.
begin;

do $scope$
begin
  if not exists (
    select 1 from public.cms_validation_scope
    where scope_name = 'portfolio-cms-migration-test'
      and verified_project_ref = 'ifakxmugmdcjyhytzpwx'
  ) then
    raise exception 'STOP: this test is restricted to the verified disposable project.';
  end if;
  if not public.cms_publication_generation_is_verified()
    or public.cms_publication_block_reason() <> ''
  then
    raise exception 'NOT RUN: verify publication readiness before creating concurrency fixtures.';
  end if;
  if exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id in ('validation-concurrency-a', 'validation-concurrency-b')
  ) then
    raise exception 'STOP: a concurrency fixture already exists; inspect it before continuing.';
  end if;
end;
$scope$;

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

select public.cms_save_record(
  'projects',
  'validation-concurrency-a',
  '{"title":"Concurrency fixture A","slug":"validation-concurrency-a","visibility":true}'::jsonb,
  0
);
select public.cms_save_record(
  'projects',
  'validation-concurrency-b',
  '{"title":"Concurrency fixture B","slug":"validation-concurrency-b","visibility":true}'::jsonb,
  0
);

commit;

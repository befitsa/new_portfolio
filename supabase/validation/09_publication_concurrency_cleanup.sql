-- REVIEW ONLY: run after both concurrency sessions finish, in the verified
-- disposable project. Removes only the two exact test records.
begin;
do $scope$
begin
  if not exists (
    select 1 from public.cms_validation_scope
    where scope_name = 'portfolio-cms-migration-test'
      and verified_project_ref = 'ifakxmugmdcjyhytzpwx'
  ) then
    raise exception 'STOP: this cleanup is restricted to the verified disposable project.';
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

do $cleanup_exact_fixtures$
begin
  if exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-concurrency-a'
  ) then
    perform public.cms_delete_record('projects', 'validation-concurrency-a');
  end if;
  if exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-concurrency-b'
  ) then
    perform public.cms_delete_record('projects', 'validation-concurrency-b');
  end if;
end;
$cleanup_exact_fixtures$;
set constraints all immediate;
do $cleanup_verified$
begin
  if not public.cms_publication_generation_is_verified()
    or exists (
      select 1 from public.portfolio_cms_public_records
      where record_id in ('validation-concurrency-a', 'validation-concurrency-b')
    )
  then
    raise exception 'FAIL: concurrency fixtures were not safely removed and reverified.';
  end if;
end;
$cleanup_verified$;
commit;

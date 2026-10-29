-- REVIEW ONLY: run only after applying both portfolio CMS migrations in the
-- verified disposable project. This script records an audit only in a
-- transaction that ends with ROLLBACK.
-- WARNING: SQL cannot independently prove the active Dashboard project.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx.
begin;

do $scope$
declare
  v_configured_ref constant text := 'ifakxmugmdcjyhytzpwx';
begin
  if v_configured_ref <> 'ifakxmugmdcjyhytzpwx'
     or not exists (
       select 1 from public.cms_validation_scope
       where scope_name = 'portfolio-cms-migration-test'
         and verified_project_ref = 'ifakxmugmdcjyhytzpwx'
     ) then
    raise exception 'STOP: disposable-project marker/ref mismatch.';
  end if;
end;
$scope$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
do $non_admin_denied$
declare
  v_denied boolean := false;
begin
  begin
    perform public.cms_get_public_storage_audit_snapshot();
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: a non-admin authenticated user could inspect public Storage inventory.';
  end if;
  v_denied := false;
  begin
    perform public.cms_record_public_storage_audit('{}'::jsonb);
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: a non-admin authenticated user could record a Storage audit.';
  end if;
end;
$non_admin_denied$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $anonymous_denied$
declare
  v_denied boolean := false;
begin
  begin
    perform public.cms_get_public_storage_audit_snapshot();
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: an unauthenticated caller could inspect public Storage inventory.';
  end if;
  v_denied := false;
  begin
    perform public.cms_record_public_storage_audit('{}'::jsonb);
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: an unauthenticated caller could record a Storage audit.';
  end if;
end;
$anonymous_denied$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

do $trusted_admin_workflow$
declare
  v_snapshot jsonb;
  v_stale_snapshot jsonb;
  v_before_audited_at timestamptz;
  v_rejected boolean := false;
begin
  if not public.cms_is_admin() then
    raise exception 'FAIL: registered disposable test administrator was not recognized.';
  end if;

  select audited_at into v_before_audited_at
  from public.portfolio_cms_storage_audit
  where bucket_id = 'portfolio-published';

  v_snapshot := public.cms_get_public_storage_audit_snapshot();
  if v_snapshot -> 'bucket' ->> 'id' <> 'portfolio-published'
     or jsonb_typeof(v_snapshot -> 'objects') <> 'array' then
    raise exception 'FAIL: trusted administrator received an invalid public Storage inventory.';
  end if;

  v_stale_snapshot := jsonb_set(
    v_snapshot,
    '{bucket,name}',
    '"stale-name"'::jsonb
  );
  begin
    perform public.cms_record_public_storage_audit(v_stale_snapshot);
  exception when sqlstate '40001' then
    v_rejected := position('Storage changed after review' in sqlerrm) > 0;
  end;
  if not v_rejected then
    raise exception 'FAIL: audit RPC accepted a snapshot that does not match the live bucket configuration.';
  end if;
  if (select audited_at from public.portfolio_cms_storage_audit
      where bucket_id = 'portfolio-published') is distinct from v_before_audited_at then
    raise exception 'FAIL: rejected stale snapshot changed the existing audit state.';
  end if;

  perform public.cms_record_public_storage_audit(v_snapshot);
  if not exists (
    select 1
    from public.portfolio_cms_storage_audit
    where bucket_id = 'portfolio-published'
      and audited_at is not null
      and visibility_verified_at is not null
      and audited_by = auth.uid()
  ) then
    raise exception 'FAIL: successful review did not record the authenticated admin identity server-side.';
  end if;
end;
$trusted_admin_workflow$;

rollback;

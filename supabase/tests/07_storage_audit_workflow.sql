-- REVIEW ONLY: run after both portfolio CMS migrations in the verified
-- disposable project. All test writes are rolled back.
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

do $shared_helper_contract$
declare
  v_path constant text := 'portfolio-published/published/test/logo.png';
begin
  if public.cms_jsonb_uses_storage_path(to_jsonb(v_path), v_path) then
    raise exception 'FAIL: a plain JSON string was misidentified as a storagePath reference.';
  end if;
  if public.cms_jsonb_uses_storage_path(
    jsonb_build_object('url', v_path),
    v_path
  ) then
    raise exception 'FAIL: an ordinary URL property was misidentified as a storagePath reference.';
  end if;
  if not public.cms_jsonb_uses_storage_path(
    jsonb_build_object('storagePath', v_path),
    v_path
  ) then
    raise exception 'FAIL: the shared helper did not recognize an actual storagePath property.';
  end if;
  if not public.cms_jsonb_uses_storage_path(
    jsonb_build_object('gallery', jsonb_build_array(jsonb_build_object('storagePath', v_path))),
    v_path
  ) then
    raise exception 'FAIL: the shared helper did not recurse to a nested storagePath property.';
  end if;
end;
$shared_helper_contract$;

-- These tests exercise database EXECUTE grants under the real SQL roles.
-- The non-admin claim is only a negative authorization simulation; a genuine
-- admin sign-in and successful workflow are covered by the PostgREST test.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $anonymous_denied$
declare
  v_denied boolean;
begin
  if has_function_privilege(
    'anon',
    'public.cms_get_public_storage_audit_snapshot()',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.cms_record_public_storage_audit(jsonb)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: anon has EXECUTE privilege on a trusted Storage audit RPC.';
  end if;

  v_denied := false;
  begin
    perform public.cms_get_public_storage_audit_snapshot();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: anon executed the Storage inventory RPC.';
  end if;

  v_denied := false;
  begin
    perform public.cms_record_public_storage_audit('{}'::jsonb);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: anon executed the Storage audit RPC.';
  end if;

  if has_table_privilege('anon', 'public.portfolio_cms_storage_audit', 'SELECT')
     or has_table_privilege('anon', 'public.portfolio_cms_storage_audit', 'INSERT')
     or has_table_privilege('anon', 'public.portfolio_cms_storage_audit', 'UPDATE')
     or has_table_privilege('anon', 'public.portfolio_cms_storage_audit', 'DELETE') then
    raise exception 'FAIL: anon has table-level read or write privileges on audit state.';
  end if;

  v_denied := false;
  begin
    perform 1 from public.portfolio_cms_storage_audit limit 1;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: anon read the audit table.';
  end if;

  v_denied := false;
  begin
    update public.portfolio_cms_storage_audit
    set audited_at = null where bucket_id = 'portfolio-published';
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: anon wrote to the audit table.';
  end if;
end;
$anonymous_denied$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;
do $authenticated_non_admin_denied$
declare
  v_denied boolean;
begin
  if not has_function_privilege(
    'authenticated',
    'public.cms_get_public_storage_audit_snapshot()',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.cms_record_public_storage_audit(jsonb)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated role is missing the intended RPC EXECUTE grants.';
  end if;

  if public.cms_is_admin() then
    raise exception 'FAIL: non-admin validation subject is registered as an administrator.';
  end if;

  v_denied := false;
  begin
    perform public.cms_get_public_storage_audit_snapshot();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated non-admin obtained the Storage inventory.';
  end if;

  v_denied := false;
  begin
    perform public.cms_record_public_storage_audit('{}'::jsonb);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated non-admin recorded a Storage audit.';
  end if;

  if has_table_privilege('authenticated', 'public.portfolio_cms_storage_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.portfolio_cms_storage_audit', 'INSERT')
     or has_table_privilege('authenticated', 'public.portfolio_cms_storage_audit', 'UPDATE')
     or has_table_privilege('authenticated', 'public.portfolio_cms_storage_audit', 'DELETE') then
    raise exception 'FAIL: authenticated role has table-level read or write privileges on audit state.';
  end if;

  v_denied := false;
  begin
    perform 1 from public.portfolio_cms_storage_audit limit 1;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated non-admin read the audit table.';
  end if;

  v_denied := false;
  begin
    update public.portfolio_cms_storage_audit
    set audited_at = null where bucket_id = 'portfolio-published';
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: authenticated non-admin wrote to the audit table.';
  end if;
end;
$authenticated_non_admin_denied$;
reset role;

rollback;

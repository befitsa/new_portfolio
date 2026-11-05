-- REVIEW ONLY: run after the portfolio CMS and public storage audit migrations
-- in the verified disposable project. This test is read-only and transactional.
-- WARNING: SQL cannot independently prove the active Dashboard project.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx.
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
end;
$scope$;

do $combined_audit_equivalence$
declare
  v_payload jsonb;
  v_expected boolean;
  v_actual boolean;
  v_cases jsonb[] := array[
    '{}'::jsonb,
    'null'::jsonb,
    '{"storagePath":"portfolio-published/projects/cover.png"}'::jsonb,
    '{"gallery":[{"storagePath":"portfolio-published/projects/gallery.png"}]}'::jsonb,
    '{"storagePath":"portfolio-private/drafts/cover.png"}'::jsonb,
    '"portfolio-private/drafts/cover.png"'::jsonb,
    '{"links":["https://example.test/portfolio-private/drafts/file.png"]}'::jsonb,
    '{"storagePath":"portfolio_media/projects/cover.png"}'::jsonb,
    '"https://example.test/portfolio_media/projects/cover.png"'::jsonb,
    '{"storagePath":"portfolio-media/projects/cover.png"}'::jsonb,
    '"https://example.test/portfolio-media/projects/cover.png"'::jsonb,
    '{"storagePath":"portfolio-media./projects/cover.png"}'::jsonb,
    '"https://example.test/portfolio-media./projects/cover.png"'::jsonb,
    '{"storagePath":"portfolio-unknown/projects/cover.png"}'::jsonb,
    '{"storagePath":4}'::jsonb,
    '{"storagePath":null}'::jsonb,
    '{"storagePath":""}'::jsonb,
    '"portfolio-unknown/projects/cover.png"'::jsonb,
    '{"nested":[{"storagePath":"portfolio-published"}]}'::jsonb,
    '{"nested":[{"url":"https://example.test/image.png"}]}'::jsonb
  ];
begin
  foreach v_payload in array v_cases
  loop
    v_expected :=
      public.cms_jsonb_has_unknown_storage_bucket(v_payload)
      or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio-private')
      or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio_media')
      or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio-media')
      or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio-media.');
    v_actual := public.cms_jsonb_has_unsafe_public_storage_reference(v_payload);
    if v_actual is distinct from v_expected then
      raise exception
        'FAIL: consolidated safety check differs for payload % (expected %, got %).',
        v_payload, v_expected, v_actual;
    end if;
  end loop;
end;
$combined_audit_equivalence$;

do $public_policy_contract$
declare
  v_records_enabled boolean;
  v_settings_enabled boolean;
  v_records_policy text;
  v_settings_policy text;
begin
  select relrowsecurity into v_records_enabled
  from pg_class where oid = 'public.portfolio_cms_public_records'::regclass;
  select relrowsecurity into v_settings_enabled
  from pg_class where oid = 'public.portfolio_cms_public_settings'::regclass;
  if not coalesce(v_records_enabled, false) or not coalesce(v_settings_enabled, false) then
    raise exception 'FAIL: public projection RLS must remain enabled.';
  end if;
  if not has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select')
    or not has_table_privilege('anon', 'public.portfolio_cms_public_settings', 'select')
  then
    raise exception 'FAIL: anonymous public projection SELECT grants changed.';
  end if;
  if has_function_privilege(
    'anon',
    'public.cms_jsonb_has_unsafe_public_storage_reference(jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_jsonb_has_unsafe_public_storage_reference(jsonb)',
    'execute'
  ) then
    raise exception 'FAIL: the internal storage validation helper must not be directly executable by client roles.';
  end if;

  select pg_get_expr(polqual, polrelid) into v_records_policy
  from pg_policy
  where polname = 'portfolio_cms_public_projection_read'
    and polrelid = 'public.portfolio_cms_public_records'::regclass;
  select pg_get_expr(polqual, polrelid) into v_settings_policy
  from pg_policy
  where polname = 'portfolio_cms_public_settings_projection_read'
    and polrelid = 'public.portfolio_cms_public_settings'::regclass;
  if v_records_policy is null
    or v_records_policy !~* 'published_payload.*visibility'
    or v_records_policy !~* 'cms_public_content_audited'
    or v_settings_policy is null
    or v_settings_policy !~* 'published_payload.*visibility'
    or v_settings_policy !~* 'cms_public_content_audited'
  then
    raise exception 'FAIL: public RLS policies must retain visibility and audit gates.';
  end if;
end;
$public_policy_contract$;

rollback;

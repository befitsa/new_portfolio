-- REVIEW ONLY: run after the CMS, consolidated audit, and generation migrations
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
  v_verification_enabled boolean;
  v_verification_forced boolean;
  v_missing_triggers text;
  v_unsafe_definers text;
begin
  select relrowsecurity into v_records_enabled
  from pg_class where oid = 'public.portfolio_cms_public_records'::regclass;
  select relrowsecurity into v_settings_enabled
  from pg_class where oid = 'public.portfolio_cms_public_settings'::regclass;
  if not coalesce(v_records_enabled, false) or not coalesce(v_settings_enabled, false) then
    raise exception 'FAIL: public projection RLS must remain enabled.';
  end if;
  select relrowsecurity into v_verification_enabled
    from pg_class where oid = 'public.portfolio_cms_publication_verification'::regclass;
  select relforcerowsecurity into v_verification_forced
    from pg_class where oid = 'public.portfolio_cms_publication_verification'::regclass;
  if not coalesce(v_verification_enabled, false) or coalesce(v_verification_forced, false) then
    raise exception 'FAIL: publication verification state RLS must remain enabled.';
  end if;
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.portfolio_cms_publication_verification'::regclass
  ) then
    raise exception 'FAIL: private publication verification state must not have client-facing RLS policies.';
  end if;
  if not has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select')
    or not has_table_privilege('anon', 'public.portfolio_cms_public_settings', 'select')
  then
    raise exception 'FAIL: anonymous public projection SELECT grants changed.';
  end if;
  if has_table_privilege('anon', 'public.portfolio_cms_publication_verification', 'select')
    or has_table_privilege('authenticated', 'public.portfolio_cms_publication_verification', 'select')
    or has_table_privilege('anon', 'public.portfolio_cms_publication_verification', 'insert')
    or has_table_privilege('authenticated', 'public.portfolio_cms_publication_verification', 'insert')
    or has_table_privilege('anon', 'public.portfolio_cms_publication_verification', 'update')
    or has_table_privilege('authenticated', 'public.portfolio_cms_publication_verification', 'update')
    or has_table_privilege('anon', 'public.portfolio_cms_publication_verification', 'delete')
    or has_table_privilege('authenticated', 'public.portfolio_cms_publication_verification', 'delete')
  then
    raise exception 'FAIL: client roles must not read or modify publication verification state.';
  end if;
  if has_function_privilege(
    'anon',
    'public.cms_jsonb_has_unsafe_public_storage_reference(jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_jsonb_has_unsafe_public_storage_reference(jsonb)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_public_content_audited()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_public_content_audited()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_reverify_publication_generation()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_reverify_publication_generation()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_invalidate_publication_verification()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_invalidate_publication_verification()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_verify_publication_after_mutation()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_verify_publication_after_mutation()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_legacy_bucket_safe(text, boolean)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_legacy_bucket_safe(text, boolean)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_require_portfolio_admin()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_require_portfolio_admin()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cms_publication_block_reason()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.cms_publication_block_reason()',
    'execute'
  ) then
    raise exception 'FAIL: internal audit and verification functions must not be directly executable by client roles.';
  end if;
  if not has_function_privilege(
    'anon',
    'public.cms_publication_generation_is_verified()',
    'execute'
  ) or not has_function_privilege(
    'authenticated',
    'public.cms_publication_generation_is_verified()',
    'execute'
  ) then
    raise exception 'FAIL: public RLS must be able to check the trusted generation.';
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
    or v_records_policy !~* 'cms_publication_generation_is_verified'
    or v_records_policy ~* 'cms_public_content_audited'
    or v_settings_policy is null
    or v_settings_policy !~* 'published_payload.*visibility'
    or v_settings_policy !~* 'cms_publication_generation_is_verified'
    or v_settings_policy ~* 'cms_public_content_audited'
  then
    raise exception 'FAIL: public RLS must use visibility and the indexed trusted verification state, not the global audit.';
  end if;

  select string_agg(expected.name, ', ')
    into v_missing_triggers
  from unnest(array[
    'portfolio_cms_publication_verification_records',
    'portfolio_cms_publication_verification_projection',
    'portfolio_cms_publication_verification_settings',
    'portfolio_cms_publication_verification_public_settings',
    'portfolio_cms_publication_verification_buckets',
    'portfolio_cms_publication_verification_records_truncate',
    'portfolio_cms_publication_verification_projection_truncate',
    'portfolio_cms_publication_verification_settings_truncate',
    'portfolio_cms_publication_verification_public_settings_truncate',
    'portfolio_cms_publication_verification_buckets_truncate',
    'portfolio_cms_publication_verify_records_insert',
    'portfolio_cms_publication_verify_records_update',
    'portfolio_cms_publication_verify_records_delete',
    'portfolio_cms_publication_verify_projection_insert',
    'portfolio_cms_publication_verify_projection_update',
    'portfolio_cms_publication_verify_projection_delete',
    'portfolio_cms_publication_verify_settings_insert',
    'portfolio_cms_publication_verify_settings_update',
    'portfolio_cms_publication_verify_settings_delete',
    'portfolio_cms_publication_verify_public_settings_insert',
    'portfolio_cms_publication_verify_public_settings_update',
    'portfolio_cms_publication_verify_public_settings_delete',
    'portfolio_cms_publication_verify_buckets_insert',
    'portfolio_cms_publication_verify_buckets_update',
    'portfolio_cms_publication_verify_buckets_delete'
  ]) as expected(name)
  where not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgname = expected.name
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
  );
  if v_missing_triggers is not null then
    raise exception 'FAIL: publication invalidation/verification triggers are missing or disabled: %.', v_missing_triggers;
  end if;

  select string_agg(expected.name, ', ')
    into v_missing_triggers
  from unnest(array[
    'portfolio_cms_publication_verify_records_insert',
    'portfolio_cms_publication_verify_records_update',
    'portfolio_cms_publication_verify_records_delete',
    'portfolio_cms_publication_verify_projection_insert',
    'portfolio_cms_publication_verify_projection_update',
    'portfolio_cms_publication_verify_projection_delete',
    'portfolio_cms_publication_verify_settings_insert',
    'portfolio_cms_publication_verify_settings_update',
    'portfolio_cms_publication_verify_settings_delete',
    'portfolio_cms_publication_verify_public_settings_insert',
    'portfolio_cms_publication_verify_public_settings_update',
    'portfolio_cms_publication_verify_public_settings_delete',
    'portfolio_cms_publication_verify_buckets_insert',
    'portfolio_cms_publication_verify_buckets_update',
    'portfolio_cms_publication_verify_buckets_delete'
  ]) as expected(name)
  where not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgname = expected.name
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled <> 'D'
      and trigger_row.tgdeferrable
      and trigger_row.tginitdeferred
  );
  if v_missing_triggers is not null then
    raise exception 'FAIL: deferred verification triggers are missing or not initially deferred: %.', v_missing_triggers;
  end if;

  select string_agg(p.proname, ', ')
    into v_unsafe_definers
  from pg_proc p
  where p.oid in (
    'public.cms_publication_generation_is_verified()'::regprocedure,
    'public.cms_reverify_publication_generation()'::regprocedure,
    'public.cms_invalidate_publication_verification()'::regprocedure,
    'public.cms_verify_publication_after_mutation()'::regprocedure,
    'public.cms_publication_block_reason()'::regprocedure,
    'public.cms_health()'::regprocedure,
    'public.cms_public_content_audited()'::regprocedure,
    'public.cms_legacy_bucket_safe(text, boolean)'::regprocedure,
    'public.cms_require_portfolio_admin()'::regprocedure
  )
    and (
      not p.prosecdef
      or p.proowner in (
        select role_row.oid from pg_roles role_row
        where role_row.rolname in ('anon', 'authenticated')
      )
      or not (
        coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
      )
      or not has_table_privilege(
        p.proowner,
        'public.portfolio_cms_publication_verification',
        'select'
      )
    );
  if v_unsafe_definers is not null then
    raise exception 'FAIL: SECURITY DEFINER ownership/search_path contract failed for: %.', v_unsafe_definers;
  end if;
end;
$public_policy_contract$;

rollback;

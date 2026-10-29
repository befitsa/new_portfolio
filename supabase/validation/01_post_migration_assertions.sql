-- Run only after the disposable-copy migration succeeds in the verified test project.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.
do $assertions$
declare
  v_ref text := 'ifakxmugmdcjyhytzpwx';
  v_definition text;
  v_admin_check text;
  v_admin_wrapper text;
  v_ready_reason text;
  v_health jsonb;
begin
  if v_ref <> 'ifakxmugmdcjyhytzpwx'
     or not exists (
       select 1 from public.cms_validation_scope
       where scope_name = 'portfolio-cms-migration-test'
         and verified_project_ref = 'ifakxmugmdcjyhytzpwx'
     ) then
    raise exception 'STOP: disposable-project marker does not match the Dashboard project ref.';
  end if;

  if to_regclass('public.portfolio_cms_records') is null
     or to_regclass('public.portfolio_cms_settings') is null
     or to_regclass('public.portfolio_cms_public_records') is null
     or to_regclass('public.portfolio_cms_public_settings') is null
     or to_regclass('public.portfolio_cms_storage_audit') is null then
    raise exception 'FAIL: migration CMS tables are missing.';
  end if;
  if to_regprocedure('public.cms_list_records(text,text)') is null
     or to_regprocedure('public.cms_get_record(text,text,text)') is null
     or to_regprocedure('public.cms_save_record(text,text,jsonb,integer)') is null
     or to_regprocedure('public.cms_publish_record(text,text,integer,jsonb)') is null
     or to_regprocedure('public.cms_unpublish_record(text,text)') is null
     or to_regprocedure('public.cms_delete_record(text,text)') is null
     or to_regprocedure('public.cms_reorder_records(text,jsonb)') is null
     or to_regprocedure('public.cms_get_settings(text)') is null
     or to_regprocedure('public.cms_save_settings(jsonb,integer)') is null
     or to_regprocedure('public.cms_publish_settings(integer)') is null
     or to_regprocedure('public.cms_unpublish_settings()') is null
     or to_regprocedure('public.cms_health()') is null
     or to_regprocedure('public.cms_is_admin()') is null
     or to_regprocedure('public.cms_public_content_audited()') is null
     or to_regprocedure('public.cms_jsonb_has_unknown_storage_bucket(jsonb)') is null
     or to_regprocedure('public.cms_legacy_bucket_safe(text,boolean)') is null then
    raise exception 'FAIL: expected CMS functions are missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_cms_records'
      and column_name = 'content_type'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_cms_records'
      and column_name = 'record_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_cms_records'
      and column_name = 'draft_payload'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_cms_records'
      and column_name = 'published_payload'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_cms_settings'
      and column_name = 'draft_payload'
  ) then
    raise exception 'FAIL: CMS table columns do not match the frontend draft/published data model.';
  end if;

  select pg_get_functiondef('public.is_portfolio_admin()'::regprocedure)
    into v_admin_check;
  if position('auth.uid()' in lower(v_admin_check)) = 0
     or position('security definer' in lower(v_admin_check)) = 0
     or position('search_path' in lower(v_admin_check)) = 0
     or position('cms_' in lower(v_admin_check)) > 0 then
    raise exception 'FAIL: test admin registry is not a non-recursive, locked-down check of auth.uid().';
  end if;
  select pg_get_functiondef('public.cms_require_portfolio_admin()'::regprocedure)
    into v_definition;
  select pg_get_functiondef('public.cms_is_admin()'::regprocedure)
    into v_admin_wrapper;
  if position('public.is_portfolio_admin()' in v_definition) = 0
     or position('public.is_portfolio_admin()' in v_admin_wrapper) = 0
     or position('350db73c-d045-4b51-88bf-36ee9b2d07db' in v_definition || v_admin_wrapper) > 0 then
    raise exception 'FAIL: CMS authorization does not delegate to the trusted administrator registry.';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'portfolio-private' and public = false
  ) then
    raise exception 'FAIL: missing portfolio-private bucket was not created privately.';
  end if;
  if not exists (
    select 1 from storage.buckets where id = 'portfolio-published' and public = false
  ) then
    raise exception 'FAIL: missing portfolio-published bucket was not created privately.';
  end if;
  if exists (
    select 1
    from public.cms_validation_bucket_baseline baseline
    join storage.buckets bucket on bucket.id = baseline.bucket_id
    where bucket.public is distinct from baseline.was_public
  ) then
    raise exception 'FAIL: migration changed visibility of a legacy test bucket.';
  end if;
  if exists (
    select 1 from public.cms_validation_bucket_baseline baseline
    where not exists (select 1 from storage.buckets b where b.id = baseline.bucket_id)
  ) then
    raise exception 'FAIL: migration removed a legacy test bucket.';
  end if;
  if exists (
    select 1
    from public.cms_validation_bucket_baseline baseline
    where (select count(*) from storage.objects object
           where object.bucket_id = baseline.bucket_id) <> baseline.object_count
  ) then
    raise exception 'FAIL: migration changed the object count in a legacy test bucket.';
  end if;

  if not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects' and record_id = 'validation-legacy-draft'
      and status = 'draft' and published_payload is null
  ) then
    raise exception 'FAIL: explicit legacy draft was not conservatively backfilled.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects' and record_id = 'validation-legacy-published'
      and status = 'published' and published_payload ->> 'visibility' = 'true'
      and published_payload -> 'techStack' = '["React","PostgreSQL","Vite"]'::jsonb
      and draft_payload -> 'techStack' = '["React","PostgreSQL","Vite"]'::jsonb
  ) then
    raise exception 'FAIL: explicitly published legacy fixture or comma-separated technology values were not backfilled correctly.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects' and record_id = 'validation-legacy-ambiguous'
      and status = 'draft' and published_payload is null
  ) or exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects' and record_id = 'validation-legacy-ambiguous'
  ) then
    raise exception 'FAIL: ambiguous legacy publication status was exposed instead of treated as draft.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects' and record_id = 'validation-legacy-published'
  ) then
    raise exception 'FAIL: expected public projection bootstrap row is missing.';
  end if;
  if public.cms_public_content_audited() then
    raise exception 'FAIL: public projections are considered audited without attestations.';
  end if;

  if public.cms_legacy_bucket_safe('portfolio-media.', false) is distinct from true
     or public.cms_legacy_bucket_safe('portfolio-media', false) is distinct from true
     or public.cms_legacy_bucket_safe('portfolio_media', true) is distinct from true then
    raise exception 'FAIL: expected distinct, empty legacy bucket fixtures are not recognized.';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'portfolio-media.') <> 0 then
    raise exception 'FAIL: dotted legacy bucket is not empty before its object test.';
  end if;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
    false
  );
  if not public.is_portfolio_admin() then
    raise exception 'FAIL: fake disposable admin identity was not recognized.';
  end if;
  if not public.cms_is_admin() then
    raise exception 'FAIL: cms_is_admin() did not recognize the registered test administrator.';
  end if;
  v_health := public.cms_health();
  if v_health #>> '{storage,ready}' <> 'false'
     or position(
       'portfolio-published bucket must be explicitly configured as public'
       in coalesce(v_health #>> '{storage,message}', '')
     ) = 0 then
    raise exception 'FAIL: health check did not block the unaudited private publication destination.';
  end if;
  v_ready_reason := public.cms_publication_block_reason();
  if position('portfolio-published bucket must be explicitly configured as public' in v_ready_reason) = 0 then
    raise exception 'FAIL: private unpublished destination did not block publication.';
  end if;
end;
$assertions$;

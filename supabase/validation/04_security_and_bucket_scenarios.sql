-- REVIEW ONLY: run only in the specifically approved disposable test project.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.
-- This transaction changes only disposable CMS test rows and rolls them back.
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
    raise exception 'STOP: configured marker must exactly equal the approved disposable project ref.';
  end if;
end;
$scope$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into public.portfolio_cms_records (
  content_type, record_id, status, draft_payload, revision,
  published_revision, base_published_revision
) values (
  'projects', 'validation-security-draft', 'draft',
  '{"title":"Direct RPC test","slug":"validation-security-draft","visibility":false}'::jsonb,
  1, 0, 0
)
on conflict (content_type, record_id) do nothing;

insert into public.portfolio_cms_settings (
  id, status, draft_payload, revision, published_revision, base_published_revision
) values (
  'main', 'draft', '{"visibility":false,"siteName":"Test"}'::jsonb, 1, 0, 0
)
on conflict (id) do nothing;

do $admin_readiness$
declare
  v_reason text;
  v_blocked boolean;
begin
  if exists (
    select 1 from storage.buckets
    where id in ('portfolio-private', 'portfolio-published')
      and public
  ) then
    raise exception 'STOP: destination bucket unexpectedly public; do not alter visibility in this test.';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'portfolio-private' and not public
  ) then
    raise exception 'FAIL: portfolio-private is missing or not private.';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'portfolio-published' and not public
  ) then
    raise exception 'FAIL: portfolio-published is missing or not private in the post-migration baseline.';
  end if;
  update public.portfolio_cms_storage_audit
  set visibility_verified_at = now(),
      audited_at = now(),
      projections_audited_at = now()
  where bucket_id = 'portfolio-published';
  if public.cms_public_content_audited() then
    raise exception 'FAIL: audit marker timestamps bypassed the private published-bucket or projection-integrity checks.';
  end if;
  update public.portfolio_cms_storage_audit
  set visibility_verified_at = null,
      audited_at = null,
      projections_audited_at = null
  where bucket_id = 'portfolio-published';

  if not public.cms_legacy_bucket_safe('portfolio-media.', false)
     or not public.cms_legacy_bucket_safe('portfolio-media', false)
     or not public.cms_legacy_bucket_safe('portfolio_media', true) then
    raise exception 'FAIL: expected three distinct, empty legacy bucket fixtures were not recognized.';
  end if;

  if not public.cms_jsonb_uses_storage_bucket(
       '{"storagePath":"portfolio-media./draft/file.png"}'::jsonb,
       'portfolio-media.'
     )
     or not public.cms_jsonb_uses_storage_bucket(
       '{"storagePath":"portfolio-media/draft/file.png"}'::jsonb,
       'portfolio-media'
     )
     or not public.cms_jsonb_uses_storage_bucket(
       '{"storagePath":"portfolio_media/draft/file.png"}'::jsonb,
       'portfolio_media'
     ) then
    raise exception 'FAIL: storage path parser did not distinguish the exact bucket IDs.';
  end if;
  if public.cms_jsonb_uses_storage_bucket(
       '{"storagePath":"portfolio-media./draft/file.png"}'::jsonb,
       'portfolio-media'
     )
     or public.cms_jsonb_uses_storage_bucket(
       '{"storagePath":"portfolio-media/draft/file.png"}'::jsonb,
       'portfolio-media.'
     ) then
    raise exception 'FAIL: storage path parser conflated dotted and hyphenated bucket IDs.';
  end if;
  if not public.cms_jsonb_has_unknown_storage_bucket(
       '{"storagePath":"portfolio-unknown/draft/file.png"}'::jsonb
     )
     or public.cms_jsonb_has_unknown_storage_bucket(
       '{"storagePath":"portfolio-media./draft/file.png"}'::jsonb
     ) then
    raise exception 'FAIL: unknown bucket IDs were not rejected distinctly from the exact dotted legacy bucket.';
  end if;

  v_reason := public.cms_publication_block_reason();
  if position(
       'portfolio-published bucket must be explicitly configured as public'
       in v_reason
     ) = 0 then
    raise exception 'FAIL: private portfolio-published destination did not block publication: %', v_reason;
  end if;

  v_blocked := false;
  begin
    perform public.cms_publish_record(
      'projects', 'validation-security-draft', 1,
      '{"title":"Direct RPC test","slug":"validation-security-draft","visibility":true}'::jsonb
    );
  exception when sqlstate '55000' then
    v_blocked := position(
      'portfolio-published bucket must be explicitly configured as public'
      in sqlerrm
    ) > 0;
  end;
  if not v_blocked then
    raise exception 'FAIL: direct cms_publish_record() bypassed publication readiness.';
  end if;

  v_blocked := false;
  begin
    perform public.cms_publish_settings(1);
  exception when sqlstate '55000' then
    v_blocked := position(
      'portfolio-published bucket must be explicitly configured as public'
      in sqlerrm
    ) > 0;
  end;
  if not v_blocked then
    raise exception 'FAIL: direct cms_publish_settings() bypassed publication readiness.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-security-draft'
      and status = 'draft'
      and published_payload is null
  ) then
    raise exception 'FAIL: failed publication left the test record marked published.';
  end if;
  if exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects' and record_id = 'validation-security-draft'
  ) then
    raise exception 'FAIL: a draft record appeared in the public projection.';
  end if;

  update public.portfolio_cms_records
  set status = 'published',
      published_payload = '{"title":"Temporary live item","visibility":true}'::jsonb
  where content_type = 'projects' and record_id = 'validation-security-draft';
  if not exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects'
      and record_id = 'validation-security-draft'
      and published_payload ->> 'title' = 'Temporary live item'
  ) then
    raise exception 'FAIL: publishing a visible record did not synchronize the public projection.';
  end if;
  perform public.cms_unpublish_record('projects', 'validation-security-draft');
  if exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects' and record_id = 'validation-security-draft'
  ) then
    raise exception 'FAIL: unpublishing a record did not remove its public projection.';
  end if;

  update public.portfolio_cms_records
  set status = 'published',
      published_payload = '{"title":"Temporary live item","visibility":true}'::jsonb
  where content_type = 'projects' and record_id = 'validation-security-draft';
  perform public.cms_delete_record('projects', 'validation-security-draft');
  if exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects' and record_id = 'validation-security-draft'
  ) then
    raise exception 'FAIL: deleting a record did not remove its public projection.';
  end if;

  update public.portfolio_cms_settings
  set status = 'published',
      published_payload = '{"name":"Temporary setting","visibility":true}'::jsonb
  where id = 'main';
  perform public.cms_unpublish_settings();
  if exists (
    select 1 from public.portfolio_cms_public_settings where id = 'main'
  ) then
    raise exception 'FAIL: unpublishing settings did not remove the public projection.';
  end if;
end;
$admin_readiness$;

-- A non-admin cannot publish records/settings or alter audit attestations.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;
do $non_admin$
declare
  v_denied boolean := false;
begin
  begin
    perform public.cms_save_record(
      'projects', 'validation-security-draft',
      '{"title":"Unauthorized","slug":"unauthorized","visibility":false}'::jsonb, 1
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct record save was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_publish_record(
      'projects', 'validation-security-draft', 1,
      '{"title":"Unauthorized","visibility":true}'::jsonb
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct record publish was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_publish_settings(1);
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct settings publish was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_unpublish_record('projects', 'validation-security-draft');
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct record unpublish was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_delete_record('projects', 'validation-security-draft');
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct record delete was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_reorder_records(
      'projects', '[{"id":"validation-security-draft","order":1}]'::jsonb
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct record reorder was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_save_settings('{"name":"Unauthorized"}'::jsonb, 1);
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct settings save was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_unpublish_settings();
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: non-admin direct settings unpublish was not denied.'; end if;

  v_denied := false;
  begin
    update public.portfolio_cms_storage_audit set audited_at = now()
    where bucket_id = 'portfolio-published';
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: authenticated user altered audit attestation.'; end if;
end;
$non_admin$;
reset role;

-- Anon cannot read draft-bearing CMS records or unaudited public projections.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $public_privacy$
begin
  if has_table_privilege('anon', 'public.portfolio_cms_records', 'select')
     or has_table_privilege('anon', 'public.portfolio_cms_settings', 'select') then
    raise exception 'FAIL: anon has table-level SELECT on draft-bearing CMS tables.';
  end if;
  if has_table_privilege('anon', 'public.portfolio_cms_public_records', 'select')
     and exists (
    select 1 from public.portfolio_cms_public_records
    where record_id in ('validation-security-draft', 'validation-legacy-draft')
  ) then
    raise exception 'FAIL: anon read a draft from the public projection.';
  end if;
  if has_table_privilege('anon', 'public.portfolio_cms_public_settings', 'select')
     and exists (
       select 1 from public.portfolio_cms_public_settings
       where id = 'main'
     ) then
    raise exception 'FAIL: anon read settings while the public content audit is invalid.';
  end if;
end;
$public_privacy$;
reset role;

-- An unauthenticated caller cannot invoke any authenticated CMS mutation.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $unauthenticated$
declare
  v_denied boolean := false;
begin
  begin
    perform public.cms_save_record(
      'projects', 'validation-security-draft',
      '{"title":"Anonymous","slug":"anonymous","visibility":false}'::jsonb, 1
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: unauthenticated direct record save was not denied.'; end if;

  v_denied := false;
  begin
    perform public.cms_publish_record(
      'projects', 'validation-security-draft', 1,
      '{"title":"Anonymous","slug":"anonymous","visibility":true}'::jsonb
    );
  exception when sqlstate '42501' then
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: unauthenticated direct record publish was not denied.'; end if;
end;
$unauthenticated$;
reset role;

rollback;

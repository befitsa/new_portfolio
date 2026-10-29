-- Run after running the disposable-copy migration a second time.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.
do $assertions$
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
  if not exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-rerun-sentinel'
      and status = 'draft'
      and revision = 7
      and draft_payload = '{"title":"CMS sentinel","visibility":false}'::jsonb
      and published_payload is null
  ) then
    raise exception 'FAIL: migration rerun changed or deleted the CMS sentinel.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects'
      and record_id = 'validation-rerun-sentinel'
      and published_payload = '{"title":"Projection sentinel - preserve exactly","visibility":true,"sentinel":731}'::jsonb
  ) then
    raise exception 'FAIL: migration rerun changed or deleted the existing public projection sentinel.';
  end if;
  if exists (
    select 1 from public.cms_validation_bucket_baseline baseline
    join storage.buckets b on b.id = baseline.bucket_id
    where b.public is distinct from baseline.was_public
  ) then
    raise exception 'FAIL: migration rerun changed legacy bucket visibility.';
  end if;
  if exists (
    select 1 from public.cms_validation_destination_baseline baseline
    join storage.buckets b on b.id = baseline.bucket_id
    where b.name is distinct from baseline.name
       or b.public is distinct from baseline.was_public
       or b.file_size_limit is distinct from baseline.file_size_limit
       or b.allowed_mime_types is distinct from baseline.allowed_mime_types
  ) then
    raise exception 'FAIL: migration rerun changed CMS destination bucket metadata.';
  end if;
  if exists (
    select 1 from public.cms_validation_destination_baseline baseline
    where not exists (select 1 from storage.buckets b where b.id = baseline.bucket_id)
       or (select count(*) from storage.objects o
           where o.bucket_id = baseline.bucket_id) <> baseline.object_count
  ) then
    raise exception 'FAIL: migration rerun removed a CMS destination bucket or changed its object count.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_storage_audit
    where bucket_id = 'portfolio-published'
      and projections_audited_at is null
  ) then
    raise exception 'FAIL: migration rerun did not retain the audit row or invalidate the projection audit.';
  end if;
  if exists (
    select 1 from public.portfolio_cms_storage_audit
    where bucket_id = 'portfolio-published'
      and projections_audited_at is not null
  ) then
    raise exception 'FAIL: migration rerun did not invalidate the projection audit; re-audit projections before publishing.';
  end if;
end;
$assertions$;

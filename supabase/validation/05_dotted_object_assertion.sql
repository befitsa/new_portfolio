-- Run only after uploading one harmless test file via Storage Dashboard
-- to the disposable bucket whose exact ID is "portfolio-media." (period included).
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.
do $assertion$
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
  if (select count(*) from storage.objects where bucket_id = 'portfolio-media.') <> 1 then
    raise exception 'NOT RUN: expected exactly one harmless test object in portfolio-media.; upload one object or remove extras and retry.';
  end if;
  if public.cms_legacy_bucket_safe('portfolio-media.', false) then
    raise exception 'FAIL: exact dotted public legacy bucket was considered safe while an object exists.';
  end if;
  if not public.cms_legacy_bucket_safe('portfolio-media', false) then
    raise exception 'FAIL: dotted bucket object incorrectly affected distinct portfolio-media bucket.';
  end if;
end;
$assertion$;

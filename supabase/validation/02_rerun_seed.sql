-- Run after 01_post_migration_assertions.sql and before re-running the migration.
-- This creates intentional sentinel rows only in the disposable test database.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.
begin;

do $seed$
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
  if exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-rerun-sentinel'
      and (status <> 'draft'
        or revision <> 7
        or draft_payload is distinct from '{"title":"CMS sentinel","visibility":false}'::jsonb
        or published_payload is not null)
  ) then
    raise exception 'STOP: rerun CMS sentinel exists with unexpected values; inspect before retrying.';
  end if;
  if exists (
    select 1 from public.portfolio_cms_public_records
    where content_type = 'projects'
      and record_id = 'validation-rerun-sentinel'
      and published_payload is distinct from '{"title":"Projection sentinel - preserve exactly","visibility":true,"sentinel":731}'::jsonb
  ) then
    raise exception 'STOP: rerun projection sentinel exists with unexpected values; inspect before retrying.';
  end if;
end;
$seed$;

create table if not exists public.cms_validation_destination_baseline (
  bucket_id text primary key,
  name text not null,
  was_public boolean not null,
  file_size_limit bigint,
  allowed_mime_types text[],
  object_count bigint not null
);
insert into public.cms_validation_destination_baseline (
  bucket_id, name, was_public, file_size_limit, allowed_mime_types, object_count
)
select b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types,
       (select count(*) from storage.objects o where o.bucket_id = b.id)
from storage.buckets b
where b.id in ('portfolio-private', 'portfolio-published')
on conflict (bucket_id) do nothing;

create table if not exists public.cms_validation_legacy_baseline (
  content_type text not null,
  record_id text not null,
  status text not null,
  draft_payload jsonb not null,
  published_payload jsonb not null,
  primary key (content_type, record_id)
);
insert into public.cms_validation_legacy_baseline (
  content_type, record_id, status, draft_payload, published_payload
)
select content_type, record_id, status, draft_payload, published_payload
from public.portfolio_cms_records
where content_type = 'projects'
  and record_id = 'validation-legacy-published'
  and status = 'published'
  and published_payload is not null
on conflict (content_type, record_id) do nothing;

do $empty_destinations$
begin
  if (select count(*) from public.cms_validation_destination_baseline) <> 2
     or exists (
       select 1 from storage.objects
       where bucket_id in ('portfolio-private', 'portfolio-published')
     ) then
    raise exception 'STOP: expected both empty CMS test buckets; use a fresh disposable project.';
  end if;
  if exists (
    select 1 from public.cms_validation_destination_baseline
    where bucket_id in ('portfolio-private', 'portfolio-published')
      and was_public
  ) then
    raise exception 'STOP: both CMS destination buckets must already be private for this rerun test; do not change their visibility here.';
  end if;
  if (select count(*) from public.cms_validation_legacy_baseline) <> 1 then
    raise exception 'STOP: expected exactly one migrated published legacy fixture before saving the rerun baseline.';
  end if;
end;
$empty_destinations$;

insert into public.portfolio_cms_records (
  content_type, record_id, status, draft_payload,
  revision, published_revision, base_published_revision
) values (
  'projects', 'validation-rerun-sentinel', 'draft',
  '{"title":"CMS sentinel","visibility":false}'::jsonb,
  7, 7, 7
)
on conflict (content_type, record_id) do nothing;

-- Deliberately differs from the CMS row: the migration must preserve it via
-- ON CONFLICT DO NOTHING rather than refresh/overwrite the existing projection.
insert into public.portfolio_cms_public_records (
  content_type, record_id, published_payload
) values (
  'projects', 'validation-rerun-sentinel',
  '{"title":"Projection sentinel - preserve exactly","visibility":true,"sentinel":731}'::jsonb
)
on conflict (content_type, record_id) do nothing;

commit;

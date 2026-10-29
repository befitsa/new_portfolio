-- REVIEW ONLY. Run in SQL Editor for a newly-created disposable project.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.
begin;

do $preflight$
declare
  v_test_ref text := 'ifakxmugmdcjyhytzpwx';
begin
  if v_test_ref <> 'ifakxmugmdcjyhytzpwx' then
    raise exception 'STOP: configured project ref must exactly equal ifakxmugmdcjyhytzpwx.';
  end if;
  if to_regclass('auth.users') is null
     or to_regprocedure('auth.uid()') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'STOP: this is not a Supabase project with hosted Auth and Storage prerequisites.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'STOP: required Supabase API roles are absent.';
  end if;
  if to_regclass('public.cms_validation_scope') is not null
     or to_regclass('public.portfolio_cms_records') is not null
     or to_regclass('public.portfolio_cms_settings') is not null
     or to_regclass('public.portfolio_cms_public_records') is not null
     or to_regclass('public.portfolio_cms_public_settings') is not null
     or to_regclass('public.portfolio_cms_storage_audit') is not null then
    raise exception 'STOP: validation marker or CMS tables already exist; use a fresh disposable project.';
  end if;
  if to_regclass('public.portfolio_admins') is not null
     or to_regprocedure('public.is_portfolio_admin()') is not null
     or to_regclass('public.projects') is not null
     or to_regclass('public.experiences') is not null
     or to_regclass('public.education') is not null
     or to_regclass('public.site_settings') is not null then
    raise exception 'STOP: a prerequisite/legacy object already exists; inspect it rather than overwriting it.';
  end if;
  if exists (
    select 1 from storage.buckets
    where id in (
      'portfolio-media.', 'portfolio-media', 'portfolio_media',
      'portfolio-private', 'portfolio-published'
    )
  ) then
    raise exception 'STOP: a named test bucket already exists; use a fresh disposable project.';
  end if;
end;
$preflight$;

create table public.cms_validation_scope (
  scope_name text primary key check (scope_name = 'portfolio-cms-migration-test'),
  verified_project_ref text not null,
  created_at timestamptz not null default now()
);
insert into public.cms_validation_scope (scope_name, verified_project_ref)
values ('portfolio-cms-migration-test', 'ifakxmugmdcjyhytzpwx');

create table public.portfolio_admins (
  user_id uuid primary key
);
insert into public.portfolio_admins (user_id)
values ('11111111-1111-4111-8111-111111111111');
alter table public.portfolio_admins enable row level security;
revoke all on public.portfolio_admins from public, anon, authenticated;

create function public.is_portfolio_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.portfolio_admins
    where user_id = auth.uid()
  )
$function$;
revoke all on function public.is_portfolio_admin() from public, anon, authenticated;
grant execute on function public.is_portfolio_admin() to authenticated;

create table public.projects (
  id text primary key,
  status text,
  revision integer,
  draft_payload jsonb,
  published_payload jsonb
);
create table public.experiences (
  id text primary key,
  status text,
  revision integer,
  draft_payload jsonb,
  published_payload jsonb
);
create table public.education (
  id text primary key,
  status text,
  revision integer,
  draft_payload jsonb,
  published_payload jsonb
);
create table public.site_settings (
  id text primary key,
  status text,
  revision integer,
  draft_payload jsonb,
  published_payload jsonb
);

insert into public.projects (id, status, revision, draft_payload, published_payload) values
  ('validation-legacy-draft', 'draft', 2,
   '{"title":"Disposable draft","slug":"validation-legacy-draft","visibility":false}'::jsonb,
   null),
  ('validation-legacy-published', 'published', 3,
   '{"title":"Disposable published project","slug":"validation-legacy-published","visibility":true,"techStack":"React, PostgreSQL, Vite"}'::jsonb,
   '{"title":"Disposable published project","slug":"validation-legacy-published","visibility":true,"techStack":"React, PostgreSQL, Vite"}'::jsonb),
  ('validation-legacy-ambiguous', null, 4,
   '{"title":"Ambiguous legacy project","slug":"validation-legacy-ambiguous","visibility":true}'::jsonb,
   '{"title":"Do not publish without an explicit status","slug":"validation-legacy-ambiguous","visibility":true}'::jsonb);
insert into public.experiences (id, status, revision, draft_payload, published_payload)
values ('validation-experience', 'draft', 1,
  '{"role":"Disposable role","visibility":false}'::jsonb, null);
insert into public.education (id, status, revision, draft_payload, published_payload)
values ('validation-education', 'draft', 1,
  '{"degree":"Disposable credential","visibility":false}'::jsonb, null);
insert into public.site_settings (id, status, revision, draft_payload, published_payload)
values ('main', 'draft', 1,
  '{"visibility":false,"siteName":"Disposable test"}'::jsonb, null);

-- Only create buckets unique to this fresh disposable project.
-- These are test fixtures; the migration must preserve their visibility.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('portfolio_media', 'portfolio_media', false, null, null),
  ('portfolio-media', 'portfolio-media', true, null, null),
  ('portfolio-media.', 'portfolio-media.', true, null, null);

create table public.cms_validation_bucket_baseline (
  bucket_id text primary key,
  was_public boolean not null,
  object_count bigint not null
);
insert into public.cms_validation_bucket_baseline (bucket_id, was_public, object_count)
select b.id, b.public,
       (select count(*) from storage.objects o where o.bucket_id = b.id)
from storage.buckets b
where b.id in ('portfolio_media', 'portfolio-media', 'portfolio-media.');

commit;

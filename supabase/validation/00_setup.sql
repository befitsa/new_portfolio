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
  published boolean,
  title text not null,
  slug text not null,
  description text,
  category text,
  cover_image text,
  images jsonb,
  technologies jsonb,
  visibility boolean,
  featured boolean,
  "order" integer
);
create table public.experiences (
  id text primary key,
  status text,
  role text not null,
  company text not null,
  logoInitials text,
  startDate text,
  endDate text,
  isCurrent boolean,
  location text,
  employmentType text,
  description text,
  skills jsonb,
  visibility boolean,
  "order" integer
);
create table public.education (
  id text primary key,
  status text,
  degree text not null,
  institution text not null,
  startYear integer,
  endYear integer,
  notes text,
  credentialUrl text,
  visibility boolean,
  "order" integer
);
create table public.site_settings (
  id text primary key,
  status text,
  name text,
  title text,
  bio text,
  about text,
  location text,
  socialLinks jsonb,
  featuredProjectIds jsonb,
  seo jsonb,
  visibility boolean
);

insert into public.projects (
  id, status, published, title, slug, description, category, cover_image,
  images, technologies, visibility, featured, "order"
) values
  ('validation-legacy-draft', 'draft', false, 'Disposable draft',
   'validation-legacy-draft', 'Draft description', 'Web',
   'portfolio_media/projects/draft-cover.png',
   '["portfolio_media/projects/draft-gallery.png"]'::jsonb,
   '["DraftTech","SharedTech"]'::jsonb, false, false, 1),
  ('validation-legacy-published', 'published', true, 'Disposable published project',
   'validation-legacy-published', 'Published description', 'Web',
   'https://assets.example.test/published-cover.png',
   '["https://assets.example.test/published-1.png","https://assets.example.test/published-2.png"]'::jsonb,
   '["React","PostgreSQL","Vite"]'::jsonb, true, true, 2),
  ('validation-legacy-comma-tech', 'published', true, 'Comma technology fixture',
   'validation-legacy-comma-tech', 'Comma technology description', 'Mobile App',
   'https://assets.example.test/comma-cover.png',
   '[]'::jsonb, '"React, Vite"'::jsonb, true, false, 3),
  ('validation-legacy-ambiguous', null, null, 'Ambiguous legacy project',
   'validation-legacy-ambiguous', 'Must remain private', 'Web',
   'https://assets.example.test/ambiguous-cover.png',
   '[]'::jsonb, '["ShouldNotPublish"]'::jsonb, true, false, 4);
insert into public.experiences (
  id, status, role, company, logoInitials, startDate, endDate, isCurrent,
  location, employmentType, description, skills, visibility, "order"
) values (
  'validation-experience', 'published', 'Disposable role', 'Example Co',
  'EC', '2020-01-01', '', true, 'Remote', 'Full-time',
  'Experience fixture', '["SQL","React"]'::jsonb, true, 1
);
insert into public.education (
  id, status, degree, institution, startYear, endYear, notes,
  credentialUrl, visibility, "order"
) values (
  'validation-education', 'draft', 'Disposable credential', 'Example University',
  2020, null, 'Education fixture', 'https://example.test/credential',
  false, 1
);
insert into public.site_settings (
  id, status, name, title, bio, about, location,
  socialLinks, featuredProjectIds, seo, visibility
) values (
  'main', 'published', 'Disposable Test Admin', 'Developer', 'Test bio',
  'Test about', 'Test location', '{"github":"https://github.com/example"}'::jsonb,
  '["validation-legacy-published"]'::jsonb,
  '{"metaTitle":"Disposable"}'::jsonb, true
);

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

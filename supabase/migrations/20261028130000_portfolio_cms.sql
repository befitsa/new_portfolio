begin;

create table if not exists public.portfolio_cms_records (
  content_type text not null check (content_type in ('projects', 'experiences', 'education', 'resumes', 'media')),
  record_id text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished', 'deleted')),
  draft_payload jsonb,
  published_payload jsonb,
  revision integer not null default 0 check (revision >= 0),
  published_revision integer not null default 0 check (published_revision >= 0),
  base_published_revision integer not null default 0 check (base_published_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  primary key (content_type, record_id)
);

create table if not exists public.portfolio_cms_settings (
  id text primary key default 'main' check (id = 'main'),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  draft_payload jsonb,
  published_payload jsonb,
  revision integer not null default 0 check (revision >= 0),
  published_revision integer not null default 0 check (published_revision >= 0),
  base_published_revision integer not null default 0 check (base_published_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  updated_by uuid
);

create table if not exists public.portfolio_cms_public_records (
  content_type text not null check (content_type in ('projects', 'experiences', 'education', 'resumes', 'media')),
  record_id text not null,
  published_payload jsonb not null,
  primary key (content_type, record_id)
);

create table if not exists public.portfolio_cms_public_settings (
  id text primary key default 'main' check (id = 'main'),
  published_payload jsonb not null
);

create index if not exists portfolio_cms_records_public_type_idx
  on public.portfolio_cms_records (content_type)
  where published_payload is not null;

alter table public.portfolio_cms_records enable row level security;
alter table public.portfolio_cms_settings enable row level security;
alter table public.portfolio_cms_public_records enable row level security;
alter table public.portfolio_cms_public_settings enable row level security;

revoke all on public.portfolio_cms_records from public, anon, authenticated;
revoke all on public.portfolio_cms_settings from public, anon, authenticated;
revoke all on public.portfolio_cms_public_records from public, anon, authenticated;
revoke all on public.portfolio_cms_public_settings from public, anon, authenticated;
grant select on public.portfolio_cms_public_records to anon, authenticated;
grant select on public.portfolio_cms_public_settings to anon, authenticated;

drop policy if exists portfolio_cms_public_records_read on public.portfolio_cms_records;

drop policy if exists portfolio_cms_admin_records_read on public.portfolio_cms_records;
create policy portfolio_cms_admin_records_read
  on public.portfolio_cms_records for select to authenticated
  using (public.is_portfolio_admin());

drop policy if exists portfolio_cms_public_settings_read on public.portfolio_cms_settings;

drop policy if exists portfolio_cms_admin_settings_read on public.portfolio_cms_settings;
create policy portfolio_cms_admin_settings_read
  on public.portfolio_cms_settings for select to authenticated
  using (public.is_portfolio_admin());

drop policy if exists portfolio_cms_public_projection_read on public.portfolio_cms_public_records;
create policy portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records for select to anon, authenticated
  using (
    case
      when published_payload ->> 'visibility' in ('true', 'false')
        then (published_payload ->> 'visibility')::boolean
      else true
    end
  );

drop policy if exists portfolio_cms_public_settings_projection_read on public.portfolio_cms_public_settings;
create policy portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings for select to anon, authenticated
  using (
    case
      when published_payload ->> 'visibility' in ('true', 'false')
        then (published_payload ->> 'visibility')::boolean
      else true
    end
  );

create or replace function public.cms_sync_public_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.published_payload is not distinct from new.published_payload then
    return new;
  end if;
  if new.published_payload is not null
    and case
      when new.published_payload ->> 'visibility' in ('true', 'false')
        then (new.published_payload ->> 'visibility')::boolean
      else true
    end
  then
    insert into public.portfolio_cms_public_records (content_type, record_id, published_payload)
    values (new.content_type, new.record_id, new.published_payload)
    on conflict (content_type, record_id) do update
      set published_payload = excluded.published_payload;
  else
    delete from public.portfolio_cms_public_records
      where content_type = new.content_type and record_id = new.record_id;
  end if;
  return new;
end;
$function$;

create or replace function public.cms_sync_public_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.published_payload is not distinct from new.published_payload then
    return new;
  end if;
  if new.published_payload is not null
    and case
      when new.published_payload ->> 'visibility' in ('true', 'false')
        then (new.published_payload ->> 'visibility')::boolean
      else true
    end
  then
    insert into public.portfolio_cms_public_settings (id, published_payload)
    values (new.id, new.published_payload)
    on conflict (id) do update
      set published_payload = excluded.published_payload;
  else
    delete from public.portfolio_cms_public_settings where id = new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists portfolio_cms_public_record_sync on public.portfolio_cms_records;
create trigger portfolio_cms_public_record_sync
  after insert or update on public.portfolio_cms_records
  for each row execute function public.cms_sync_public_record();

drop trigger if exists portfolio_cms_public_settings_sync on public.portfolio_cms_settings;
create trigger portfolio_cms_public_settings_sync
  after insert or update on public.portfolio_cms_settings
  for each row execute function public.cms_sync_public_settings();

create or replace function public.cms_jsonb_uses_storage_path(p_value jsonb, p_path text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    if p_value ->> 'storagePath' = p_path then
      return true;
    end if;
    for v_child in select value from jsonb_each(p_value)
    loop
      if public.cms_jsonb_uses_storage_path(v_child, p_path) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.cms_jsonb_uses_storage_path(v_child, p_path) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$function$;

create or replace function public.cms_require_portfolio_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
    or v_uid <> '350db73c-d045-4b51-88bf-36ee9b2d07db'::uuid
    or not coalesce(public.is_portfolio_admin(), false)
  then
    raise exception using errcode = '42501', message = 'This account is not authorized to manage portfolio content.';
  end if;
  return v_uid;
end;
$function$;

create or replace function public.cms_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() = '350db73c-d045-4b51-88bf-36ee9b2d07db'::uuid
    and coalesce(public.is_portfolio_admin(), false)
$function$;

create or replace function public.cms_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_media_public boolean;
  v_private_ready boolean;
begin
  perform public.cms_require_portfolio_admin();
  select coalesce(bool_or(b.public), false) into v_media_public
    from storage.buckets b where b.id = 'portfolio-media';
  select coalesce(bool_and(not b.public), false) into v_private_ready
    from storage.buckets b where b.id = 'portfolio-private';
  return jsonb_build_object(
    'ok', true,
    'database', jsonb_build_object('ready', true),
    'storage', jsonb_build_object(
      'ready', v_media_public and v_private_ready,
      'publicBucketReady', v_media_public,
      'privateBucketReady', v_private_ready,
      'message', case
        when not v_media_public then 'The portfolio-media bucket must be public for stable published asset URLs. Verify it contains only assets intended for public viewing before enabling public access.'
        when not v_private_ready then 'The portfolio-private bucket must exist and remain private for unpublished uploads.'
        else ''
      end
    ),
    'admin', true
  );
end;
$function$;

create or replace function public.cms_record_json(
  p_type text,
  p_id text,
  p_view text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    case when p_view = 'published' then r.published_payload else r.draft_payload end,
    case when p_view = 'drafts' then r.published_payload else null end,
    '{}'::jsonb
  ) || jsonb_build_object(
    'id', r.record_id,
    'status', case when p_view = 'published' then 'published' else r.status end,
    'revision', r.revision,
    'publishedRevision', r.published_revision,
    'basePublishedRevision', r.base_published_revision,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at,
    'publishedAt', r.published_at,
    'publishedBy', r.published_by,
    'updatedBy', r.updated_by,
    'deletedAt', r.deleted_at
  )
  from public.portfolio_cms_records r
  where r.content_type = p_type and r.record_id = p_id
    and (p_view <> 'published' or r.published_payload is not null)
$function$;

create or replace function public.cms_list_records(p_type text, p_view text default 'drafts')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_records jsonb;
begin
  perform public.cms_require_portfolio_admin();
  if p_type is null
    or p_type not in ('projects', 'experiences', 'education', 'resumes', 'media')
    or p_view is null
    or p_view not in ('drafts', 'published')
  then
    raise exception using errcode = '22023', message = 'Unsupported portfolio collection or view.';
  end if;
  select coalesce(jsonb_agg(public.cms_record_json(r.content_type, r.record_id, p_view) order by
      case when coalesce(
        case when p_view = 'published' then r.published_payload else r.draft_payload end,
        case when p_view = 'drafts' then r.published_payload else null end
      ) ->> 'order' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (coalesce(
          case when p_view = 'published' then r.published_payload else r.draft_payload end,
          case when p_view = 'drafts' then r.published_payload else null end
        ) ->> 'order')::numeric
        else 0
      end, r.created_at), '[]'::jsonb)
    into v_records
    from public.portfolio_cms_records r
    where r.content_type = p_type
      and (p_view = 'drafts' or r.published_payload is not null);
  return v_records;
end;
$function$;

create or replace function public.cms_get_record(p_type text, p_id text, p_view text default 'drafts')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.cms_require_portfolio_admin();
  if p_type is null
    or p_type not in ('projects', 'experiences', 'education', 'resumes', 'media')
    or p_view is null
    or p_view not in ('drafts', 'published')
  then
    raise exception using errcode = '22023', message = 'Unsupported portfolio collection or view.';
  end if;
  return public.cms_record_json(p_type, p_id, p_view);
end;
$function$;

create or replace function public.cms_save_record(
  p_type text,
  p_id text,
  p_payload jsonb,
  p_expected_revision integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.cms_require_portfolio_admin();
  v_id text := coalesce(nullif(p_id, ''), gen_random_uuid()::text);
  v_current public.portfolio_cms_records%rowtype;
  v_revision integer;
  v_now timestamptz := now();
  v_payload jsonb;
begin
  if p_type is null
    or p_type not in ('projects', 'experiences', 'education', 'resumes', 'media')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_expected_revision is null
    or p_expected_revision < 0
  then
    raise exception using errcode = '22023', message = 'Invalid portfolio record or revision.';
  end if;
  v_payload := p_payload - array[
    'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
    'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy', 'deletedAt'
  ];
  if p_type = 'projects' and exists (
    select 1 from public.portfolio_cms_records other
    where other.content_type = 'projects' and other.record_id <> v_id
      and other.status <> 'deleted'
      and (other.draft_payload ->> 'slug' = v_payload ->> 'slug'
        or other.published_payload ->> 'slug' = v_payload ->> 'slug')
  ) then
    raise exception using errcode = '23505', message = 'This project slug is already in use.';
  end if;
  select * into v_current
    from public.portfolio_cms_records
    where content_type = p_type and record_id = v_id
    for update;
  if not found then
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'This item changed in another session. Reload before saving.';
    end if;
    v_revision := 1;
    insert into public.portfolio_cms_records (
      content_type, record_id, status, draft_payload, revision,
      published_revision, base_published_revision, created_at, updated_at, updated_by
    ) values (
      p_type, v_id, 'draft', v_payload, v_revision, 0, 0, v_now, v_now, v_uid
    );
  else
    if v_current.status = 'deleted' then
      raise exception using errcode = 'P0002', message = 'Deleted content cannot be edited.';
    end if;
    if p_expected_revision <> v_current.revision then
      raise exception using errcode = '40001', message = 'This item changed in another session. Reload before saving.';
    end if;
    v_revision := v_current.revision + 1;
    update public.portfolio_cms_records set
      status = 'draft',
      draft_payload = v_payload,
      revision = v_revision,
      base_published_revision = v_current.published_revision,
      created_at = v_current.created_at,
      updated_at = v_now,
      updated_by = v_uid,
      deleted_at = null
    where content_type = p_type and record_id = v_id;
  end if;
  return public.cms_record_json(p_type, v_id, 'draft');
end;
$function$;

create or replace function public.cms_publish_record(
  p_type text,
  p_id text,
  p_expected_revision integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.cms_require_portfolio_admin();
  v_current public.portfolio_cms_records%rowtype;
  v_payload jsonb;
  v_now timestamptz := now();
begin
  if p_type is null
    or p_type not in ('projects', 'experiences', 'education', 'resumes', 'media')
    or p_expected_revision is null
    or p_expected_revision < 0
  then
    raise exception using errcode = '22023', message = 'Unsupported portfolio collection.';
  end if;
  select * into v_current from public.portfolio_cms_records
    where content_type = p_type and record_id = p_id for update;
  if not found or v_current.draft_payload is null then
    raise exception using errcode = 'P0002', message = 'Draft was not found.';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'The published content is invalid.';
  end if;
  if v_current.status = 'deleted' then
    raise exception using errcode = 'P0002', message = 'Deleted content cannot be published.';
  end if;
  if v_current.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'This item changed in another session. Reload before publishing.';
  end if;
  if v_current.base_published_revision <> v_current.published_revision then
    raise exception using errcode = '40001', message = 'The published version changed after this draft was started. Reload before publishing.';
  end if;
  v_payload := p_payload - array[
    'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
    'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy', 'deletedAt'
  ];
  if p_type = 'projects' and exists (
    select 1 from public.portfolio_cms_records other
    where other.content_type = 'projects' and other.record_id <> p_id
      and other.published_payload is not null
      and other.published_payload ->> 'slug' = v_payload ->> 'slug'
  ) then
    raise exception using errcode = '23505', message = 'This project slug is already in use by published content.';
  end if;
  if p_type = 'resumes' then
    v_payload := jsonb_set(v_payload, '{isActive}', 'true'::jsonb, true);
    update public.portfolio_cms_records set
      draft_payload = jsonb_set(
        jsonb_set(draft_payload, '{isActive}', 'false'::jsonb, true),
        '{visibility}', 'false'::jsonb, true
      ),
      published_payload = null,
      status = 'unpublished',
      revision = revision + 1,
      updated_at = v_now
    where content_type = 'resumes' and record_id <> p_id and published_payload is not null;
  end if;
  update public.portfolio_cms_records set
    status = 'published',
    published_payload = v_payload,
    published_revision = v_current.revision,
    base_published_revision = v_current.revision,
    revision = v_current.revision,
    published_at = v_now,
    published_by = v_uid,
    updated_at = v_now,
    updated_by = v_uid
  where content_type = p_type and record_id = p_id;
  return public.cms_record_json(p_type, p_id, 'published');
end;
$function$;

create or replace function public.cms_unpublish_record(p_type text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
begin
  perform public.cms_require_portfolio_admin();
  update public.portfolio_cms_records set
    status = 'unpublished',
    draft_payload = case when draft_payload is null then null else
      jsonb_set(jsonb_set(draft_payload, '{visibility}', 'false'::jsonb, true), '{isActive}', 'false'::jsonb, true)
    end,
    published_payload = null,
    updated_at = now()
  where content_type = p_type and record_id = p_id
    and status <> 'deleted'
  returning coalesce(draft_payload, '{}'::jsonb) into v_payload;
  if not found then
    raise exception using errcode = 'P0002', message = 'Content item was not found.';
  end if;
  return v_payload || jsonb_build_object('id', p_id, 'status', 'unpublished');
end;
$function$;

create or replace function public.cms_delete_record(p_type text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.portfolio_cms_records%rowtype;
begin
  perform public.cms_require_portfolio_admin();
  if p_type = 'media' then
    if not exists (
      select 1 from public.portfolio_cms_records
      where content_type = 'media' and record_id = p_id
    ) then
      raise exception using errcode = 'P0002', message = 'Media item was not found.';
    end if;
    if exists (
      select 1 from public.portfolio_cms_records r
      join public.portfolio_cms_records m
        on m.content_type = 'media' and m.record_id = p_id
      cross join lateral (values
        (m.draft_payload ->> 'storagePath'),
        (m.published_payload ->> 'storagePath')
      ) as asset(path)
      where r.content_type in ('projects', 'resumes')
        and asset.path is not null
        and (
          public.cms_jsonb_uses_storage_path(r.draft_payload, asset.path)
          or public.cms_jsonb_uses_storage_path(r.published_payload, asset.path)
        )
    ) then
      raise exception using errcode = '23503', message = 'This media file is still used by portfolio content.';
    end if;
  end if;
  select * into v_row from public.portfolio_cms_records
    where content_type = p_type and record_id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Content item was not found.';
  end if;
  update public.portfolio_cms_records set
    status = 'deleted',
    draft_payload = case when draft_payload is null then null else
      jsonb_set(jsonb_set(draft_payload, '{visibility}', 'false'::jsonb, true), '{isActive}', 'false'::jsonb, true)
    end,
    published_payload = null,
    deleted_at = now(),
    updated_at = now()
  where content_type = p_type and record_id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'deleted');
end;
$function$;

create or replace function public.cms_reorder_records(p_type text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_record public.portfolio_cms_records%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_uid uuid := public.cms_require_portfolio_admin();
  v_revision integer;
begin
  if p_type is null
    or p_type not in ('projects', 'experiences', 'education', 'resumes', 'media')
    or jsonb_typeof(p_items) is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'Provide a supported collection and ordered items.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item ->> 'id', '') = ''
      or coalesce(v_item ->> 'expectedRevision', '') !~ '^[0-9]+$'
      or coalesce(v_item ->> 'order', '') !~ '^[0-9]+$'
    then
      raise exception using errcode = '22023', message = 'Each ordered item requires an id, expected revision, and non-negative order.';
    end if;
    select * into v_record from public.portfolio_cms_records
      where content_type = p_type and record_id = v_item ->> 'id'
      for update;
    if not found or v_record.revision <> (v_item ->> 'expectedRevision')::integer then
      raise exception using errcode = '40001', message = 'A record changed in another session. Refresh before reordering.';
    end if;
    v_revision := v_record.revision + 1;
    update public.portfolio_cms_records set
      draft_payload = jsonb_set(coalesce(draft_payload, published_payload), '{order}', to_jsonb((v_item ->> 'order')::integer), true),
      revision = v_revision,
      status = case when published_payload is null then status else 'draft' end,
      base_published_revision = published_revision,
      updated_at = now(),
      updated_by = v_uid
    where content_type = p_type and record_id = v_record.record_id;
    v_results := v_results || jsonb_build_array(public.cms_record_json(p_type, v_record.record_id, 'draft'));
  end loop;
  return v_results;
end;
$function$;

create or replace function public.cms_get_settings(p_view text default 'drafts')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings public.portfolio_cms_settings%rowtype;
begin
  perform public.cms_require_portfolio_admin();
  if p_view is null or p_view not in ('drafts', 'published') then
    raise exception using errcode = '22023', message = 'Unsupported site settings view.';
  end if;
  select * into v_settings from public.portfolio_cms_settings where id = 'main';
  if not found then return null; end if;
  if p_view = 'published' and v_settings.published_payload is null then return null; end if;
  return coalesce(
    case when p_view = 'published' then v_settings.published_payload else v_settings.draft_payload end,
    case when p_view = 'drafts' then v_settings.published_payload else null end,
    '{}'::jsonb
  ) || jsonb_build_object(
    'id', 'settings',
    'status', case when p_view = 'published' then 'published' else v_settings.status end,
    'revision', v_settings.revision,
    'publishedRevision', v_settings.published_revision,
    'basePublishedRevision', v_settings.base_published_revision,
    'createdAt', v_settings.created_at,
    'updatedAt', v_settings.updated_at,
    'publishedAt', v_settings.published_at,
    'publishedBy', v_settings.published_by,
    'updatedBy', v_settings.updated_by
  );
end;
$function$;

create or replace function public.cms_save_settings(p_payload jsonb, p_expected_revision integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.cms_require_portfolio_admin();
  v_current public.portfolio_cms_settings%rowtype;
  v_revision integer;
  v_now timestamptz := now();
  v_payload jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_expected_revision is null
    or p_expected_revision < 0
  then
    raise exception using errcode = '22023', message = 'Invalid site settings or revision.';
  end if;
  v_payload := p_payload - array[
    'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
    'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy'
  ];
  select * into v_current from public.portfolio_cms_settings where id = 'main' for update;
  if not found then
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'Portfolio settings changed in another session. Reload before saving.';
    end if;
    v_revision := 1;
    insert into public.portfolio_cms_settings (
      id, status, draft_payload, revision, created_at, updated_at, updated_by
    ) values ('main', 'draft', v_payload, v_revision, v_now, v_now, v_uid);
  else
    if v_current.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'Portfolio settings changed in another session. Reload before saving.';
    end if;
    v_revision := v_current.revision + 1;
    update public.portfolio_cms_settings set
      status = 'draft',
      draft_payload = v_payload,
      revision = v_revision,
      base_published_revision = published_revision,
      updated_at = v_now,
      updated_by = v_uid
    where id = 'main';
  end if;
  return public.cms_get_settings('drafts');
end;
$function$;

create or replace function public.cms_publish_settings(p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.cms_require_portfolio_admin();
  v_current public.portfolio_cms_settings%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'Provide a valid expected revision before publishing settings.';
  end if;
  select * into v_current from public.portfolio_cms_settings where id = 'main' for update;
  if not found or v_current.draft_payload is null then
    raise exception using errcode = 'P0002', message = 'Save the portfolio settings draft before publishing.';
  end if;
  if v_current.revision <> p_expected_revision
    or v_current.base_published_revision <> v_current.published_revision
  then
    raise exception using errcode = '40001', message = 'Portfolio settings changed after this draft was started. Reload before publishing.';
  end if;
  update public.portfolio_cms_settings set
    status = 'published',
    published_payload = draft_payload,
    published_revision = revision,
    base_published_revision = revision,
    published_at = now(),
    published_by = v_uid,
    updated_at = now(),
    updated_by = v_uid
  where id = 'main';
  return public.cms_get_settings('published');
end;
$function$;

create or replace function public.cms_unpublish_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.cms_require_portfolio_admin();
  update public.portfolio_cms_settings set
    status = 'unpublished',
    published_payload = null,
    updated_at = now()
  where id = 'main';
  return jsonb_build_object('status', 'unpublished');
end;
$function$;

do $migration$
declare
  v_type text;
  v_table text;
  v_row jsonb;
  v_draft_payload jsonb;
  v_published_payload jsonb;
  v_id text;
  v_state text;
  v_revision integer;
  v_published_revision integer;
begin
  for v_type, v_table in
    select * from (values
      ('projects', 'projects'),
      ('experiences', 'experiences'),
      ('education', 'education')
    ) as legacy(content_type, table_name)
  loop
    if to_regclass(format('public.%I', v_table)) is null then continue; end if;
    for v_row in execute format('select to_jsonb(source_row) from public.%I source_row', v_table)
    loop
      v_draft_payload := coalesce(
        nullif(v_row -> 'draft_payload', 'null'::jsonb),
        case when jsonb_typeof(v_row -> 'draft') = 'object' then v_row -> 'draft' end,
        nullif(v_row -> 'payload', 'null'::jsonb),
        nullif(v_row -> 'content', 'null'::jsonb),
        nullif(v_row -> 'data', 'null'::jsonb),
        v_row
      );
      if jsonb_typeof(v_draft_payload) is distinct from 'object' then continue; end if;
      v_state := lower(coalesce(
        v_row ->> 'status',
        v_draft_payload ->> 'status',
        case when lower(coalesce(v_row ->> 'published', 'true')) = 'false' then 'draft' else 'published' end
      ));
      if v_state not in ('draft', 'published', 'unpublished', 'deleted') then
        v_state := case when coalesce(v_row ->> 'published', 'true') = 'false' then 'draft' else 'published' end;
      end if;
      v_published_payload := coalesce(
        nullif(v_row -> 'published_payload', 'null'::jsonb),
        case when jsonb_typeof(v_row -> 'published') = 'object' then v_row -> 'published' end,
        case when v_state = 'published' then v_draft_payload end
      );
      if jsonb_typeof(v_published_payload) is distinct from 'object'
        or v_state in ('unpublished', 'deleted')
      then
        v_published_payload := null;
      end if;
      v_id := coalesce(
        nullif(v_row ->> 'id', ''),
        nullif(v_draft_payload ->> 'id', ''),
        nullif(v_draft_payload ->> 'slug', ''),
        gen_random_uuid()::text
      );
      v_revision := greatest(1, coalesce(
        case when v_row ->> 'revision' ~ '^[0-9]+$' then (v_row ->> 'revision')::integer end,
        case when v_draft_payload ->> 'revision' ~ '^[0-9]+$' then (v_draft_payload ->> 'revision')::integer end,
        1
      ));
      v_published_revision := greatest(0, coalesce(
        case when v_row ->> 'published_revision' ~ '^[0-9]+$' then (v_row ->> 'published_revision')::integer end,
        case when v_row ->> 'publishedRevision' ~ '^[0-9]+$' then (v_row ->> 'publishedRevision')::integer end,
        case when v_published_payload ->> 'revision' ~ '^[0-9]+$' then (v_published_payload ->> 'revision')::integer end,
        v_revision
      ));
      v_draft_payload := v_draft_payload - array[
        'id', 'status', 'revision', 'publishedRevision', 'published_revision',
        'basePublishedRevision', 'base_published_revision', 'createdAt', 'created_at',
        'updatedAt', 'updated_at', 'publishedAt', 'published_at', 'publishedBy',
        'published_by', 'updatedBy', 'updated_by', 'deletedAt', 'deleted_at',
        'draft', 'draft_payload', 'published', 'published_payload'
      ];
      if not (v_draft_payload ? 'visibility')
        or v_draft_payload ->> 'visibility' not in ('true', 'false')
      then
        v_draft_payload := v_draft_payload || '{"visibility":true}'::jsonb;
      end if;
      if v_published_payload is not null then
        v_published_payload := v_published_payload - array[
          'id', 'status', 'revision', 'publishedRevision', 'published_revision',
          'basePublishedRevision', 'base_published_revision', 'createdAt', 'created_at',
          'updatedAt', 'updated_at', 'publishedAt', 'published_at', 'publishedBy',
          'published_by', 'updatedBy', 'updated_by', 'deletedAt', 'deleted_at',
          'draft', 'draft_payload', 'published', 'published_payload'
        ];
        if not (v_published_payload ? 'visibility')
          or v_published_payload ->> 'visibility' not in ('true', 'false')
        then
          v_published_payload := v_published_payload || '{"visibility":true}'::jsonb;
        end if;
      end if;
      insert into public.portfolio_cms_records (
        content_type, record_id, status, draft_payload, published_payload, revision,
        published_revision, base_published_revision
      ) values (
        v_type, v_id, v_state,
        v_draft_payload,
        v_published_payload,
        v_revision,
        case when v_published_payload is not null then v_published_revision else 0 end,
        case when v_published_payload is not null then v_published_revision else 0 end
      ) on conflict (content_type, record_id) do nothing;
    end loop;
  end loop;

  if to_regclass('public.site_settings') is not null then
    for v_row in execute 'select to_jsonb(source_row) from public.site_settings source_row'
    loop
      v_draft_payload := coalesce(
        nullif(v_row -> 'draft_payload', 'null'::jsonb),
        case when jsonb_typeof(v_row -> 'draft') = 'object' then v_row -> 'draft' end,
        nullif(v_row -> 'payload', 'null'::jsonb),
        nullif(v_row -> 'content', 'null'::jsonb),
        nullif(v_row -> 'settings', 'null'::jsonb),
        v_row
      );
      if jsonb_typeof(v_draft_payload) is distinct from 'object' then continue; end if;
      v_state := lower(coalesce(v_row ->> 'status', v_draft_payload ->> 'status', 'published'));
      if v_state not in ('draft', 'published', 'unpublished') then v_state := 'published'; end if;
      v_published_payload := coalesce(
        nullif(v_row -> 'published_payload', 'null'::jsonb),
        case when jsonb_typeof(v_row -> 'published') = 'object' then v_row -> 'published' end,
        case when v_state = 'published' then v_draft_payload end
      );
      if jsonb_typeof(v_published_payload) is distinct from 'object'
        or v_state = 'unpublished'
      then
        v_published_payload := null;
      end if;
      v_revision := greatest(1, coalesce(
        case when v_row ->> 'revision' ~ '^[0-9]+$' then (v_row ->> 'revision')::integer end,
        case when v_draft_payload ->> 'revision' ~ '^[0-9]+$' then (v_draft_payload ->> 'revision')::integer end,
        1
      ));
      v_draft_payload := v_draft_payload - array[
        'id', 'status', 'revision', 'publishedRevision', 'published_revision',
        'basePublishedRevision', 'base_published_revision', 'createdAt', 'created_at',
        'updatedAt', 'updated_at', 'publishedAt', 'published_at', 'publishedBy',
        'published_by', 'updatedBy', 'updated_by', 'draft', 'draft_payload',
        'published', 'published_payload'
      ];
      if v_published_payload is not null then
        v_published_payload := v_published_payload - array[
          'id', 'status', 'revision', 'publishedRevision', 'published_revision',
          'basePublishedRevision', 'base_published_revision', 'createdAt', 'created_at',
          'updatedAt', 'updated_at', 'publishedAt', 'published_at', 'publishedBy',
          'published_by', 'updatedBy', 'updated_by', 'draft', 'draft_payload',
          'published', 'published_payload'
        ];
      end if;
      insert into public.portfolio_cms_settings (
        id, status, draft_payload, published_payload, revision, published_revision,
        base_published_revision
      ) values (
        'main', v_state, v_draft_payload, v_published_payload,
        v_revision,
        case when v_published_payload is not null then v_revision else 0 end,
        case when v_published_payload is not null then v_revision else 0 end
      ) on conflict (id) do nothing;
    end loop;
  end if;
end;
$migration$;

insert into public.portfolio_cms_public_records (content_type, record_id, published_payload)
select content_type, record_id, published_payload
from public.portfolio_cms_records
where published_payload is not null
  and case
    when published_payload ->> 'visibility' in ('true', 'false')
      then (published_payload ->> 'visibility')::boolean
    else true
  end
on conflict (content_type, record_id) do update
  set published_payload = excluded.published_payload;

delete from public.portfolio_cms_public_records public_record
where not exists (
  select 1 from public.portfolio_cms_records source
  where source.content_type = public_record.content_type
    and source.record_id = public_record.record_id
    and source.published_payload is not null
    and case
      when source.published_payload ->> 'visibility' in ('true', 'false')
        then (source.published_payload ->> 'visibility')::boolean
      else true
    end
);

insert into public.portfolio_cms_public_settings (id, published_payload)
select id, published_payload
from public.portfolio_cms_settings
where id = 'main' and published_payload is not null
  and case
    when published_payload ->> 'visibility' in ('true', 'false')
      then (published_payload ->> 'visibility')::boolean
    else true
  end
on conflict (id) do update
  set published_payload = excluded.published_payload;

delete from public.portfolio_cms_public_settings public_setting
where not exists (
  select 1 from public.portfolio_cms_settings source
  where source.id = public_setting.id and source.published_payload is not null
    and case
      when source.published_payload ->> 'visibility' in ('true', 'false')
        then (source.published_payload ->> 'visibility')::boolean
      else true
    end
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio-private', 'portfolio-private', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = 12582912,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio-media', 'portfolio-media', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists portfolio_private_admin_select on storage.objects;
create policy portfolio_private_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'portfolio-private' and public.cms_is_admin());
drop policy if exists portfolio_private_admin_insert on storage.objects;
create policy portfolio_private_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'portfolio-private' and public.cms_is_admin());
drop policy if exists portfolio_private_admin_update on storage.objects;
create policy portfolio_private_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'portfolio-private' and public.cms_is_admin())
  with check (bucket_id = 'portfolio-private' and public.cms_is_admin());
drop policy if exists portfolio_private_admin_delete on storage.objects;
create policy portfolio_private_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'portfolio-private' and public.cms_is_admin());

drop policy if exists portfolio_media_admin_select on storage.objects;
create policy portfolio_media_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'portfolio-media' and public.cms_is_admin());

drop policy if exists portfolio_media_admin_insert on storage.objects;
create policy portfolio_media_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'portfolio-media' and public.cms_is_admin());
drop policy if exists portfolio_media_admin_update on storage.objects;
create policy portfolio_media_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'portfolio-media' and public.cms_is_admin())
  with check (bucket_id = 'portfolio-media' and public.cms_is_admin());
drop policy if exists portfolio_media_admin_delete on storage.objects;
create policy portfolio_media_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'portfolio-media' and public.cms_is_admin());

drop policy if exists portfolio_private_anon_block on storage.objects;
create policy portfolio_private_anon_block on storage.objects
  as restrictive for all to anon
  using (bucket_id <> 'portfolio-private')
  with check (bucket_id <> 'portfolio-private');

drop policy if exists portfolio_private_authenticated_guard on storage.objects;
create policy portfolio_private_authenticated_guard on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'portfolio-private' or public.cms_is_admin())
  with check (bucket_id <> 'portfolio-private' or public.cms_is_admin());

drop policy if exists portfolio_media_anon_guard on storage.objects;
create policy portfolio_media_anon_guard on storage.objects
  as restrictive for all to anon
  using (bucket_id <> 'portfolio-media')
  with check (bucket_id <> 'portfolio-media');

drop policy if exists portfolio_media_authenticated_guard on storage.objects;
create policy portfolio_media_authenticated_guard on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'portfolio-media' or public.cms_is_admin())
  with check (bucket_id <> 'portfolio-media' or public.cms_is_admin());

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portfolio_cms_public_records'
    ) then
      alter publication supabase_realtime add table public.portfolio_cms_public_records;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portfolio_cms_public_settings'
    ) then
      alter publication supabase_realtime add table public.portfolio_cms_public_settings;
    end if;
  end if;
end;
$realtime$;

revoke all on function public.cms_jsonb_uses_storage_path(jsonb, text) from public, anon, authenticated;
revoke all on function public.cms_require_portfolio_admin() from public, anon, authenticated;
revoke all on function public.cms_record_json(text, text, text) from public, anon, authenticated;
revoke all on function public.cms_sync_public_record() from public, anon, authenticated;
revoke all on function public.cms_sync_public_settings() from public, anon, authenticated;
revoke all on function public.cms_list_records(text, text) from public, anon;
revoke all on function public.cms_get_record(text, text, text) from public, anon;
revoke all on function public.cms_save_record(text, text, jsonb, integer) from public, anon;
revoke all on function public.cms_publish_record(text, text, integer, jsonb) from public, anon;
revoke all on function public.cms_unpublish_record(text, text) from public, anon;
revoke all on function public.cms_delete_record(text, text) from public, anon;
revoke all on function public.cms_reorder_records(text, jsonb) from public, anon;
revoke all on function public.cms_get_settings(text) from public, anon;
revoke all on function public.cms_save_settings(jsonb, integer) from public, anon;
revoke all on function public.cms_publish_settings(integer) from public, anon;
revoke all on function public.cms_unpublish_settings() from public, anon;
revoke all on function public.cms_is_admin() from public, anon;
revoke all on function public.cms_health() from public, anon;

grant execute on function public.cms_list_records(text, text) to authenticated;
grant execute on function public.cms_get_record(text, text, text) to authenticated;
grant execute on function public.cms_save_record(text, text, jsonb, integer) to authenticated;
grant execute on function public.cms_publish_record(text, text, integer, jsonb) to authenticated;
grant execute on function public.cms_unpublish_record(text, text) to authenticated;
grant execute on function public.cms_delete_record(text, text) to authenticated;
grant execute on function public.cms_reorder_records(text, jsonb) to authenticated;
grant execute on function public.cms_get_settings(text) to authenticated;
grant execute on function public.cms_save_settings(jsonb, integer) to authenticated;
grant execute on function public.cms_publish_settings(integer) to authenticated;
grant execute on function public.cms_unpublish_settings() to authenticated;
grant execute on function public.cms_is_admin() to authenticated;
grant execute on function public.cms_health() to authenticated;

commit;

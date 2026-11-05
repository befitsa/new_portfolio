begin;

do $preflight$
begin
  if to_regclass('public.portfolio_cms_records') is null
    or to_regclass('public.portfolio_cms_public_records') is null
    or to_regclass('public.portfolio_cms_settings') is null
    or to_regclass('public.portfolio_cms_public_settings') is null
    or to_regprocedure('public.cms_public_content_audited()') is null
    or to_regprocedure('public.cms_jsonb_has_unsafe_public_storage_reference(jsonb)') is null
    or to_regprocedure('public.cms_require_portfolio_admin()') is null
  then
    raise exception 'Apply the portfolio CMS and public storage audit migrations before this migration.';
  end if;
end;
$preflight$;

create table if not exists public.portfolio_cms_publication_verification (
  singleton boolean primary key default true check (singleton),
  publication_generation bigint not null check (publication_generation > 0),
  checked_generation bigint,
  verified_generation bigint,
  verified_at timestamptz,
  check (
    (checked_generation is null or checked_generation = publication_generation)
    and (
      (verified_generation is null and verified_at is null)
      or (
        checked_generation = publication_generation
        and verified_generation = publication_generation
        and verified_at is not null
      )
    )
  )
);

do $verification_schema_contract$
declare
  v_table oid := 'public.portfolio_cms_publication_verification'::regclass::oid;
  v_primary_key smallint[];
  v_expected_primary_key smallint[];
  v_check_definitions text;
  v_check_count integer;
begin
  if (
    select count(*)
    from pg_attribute
    where attrelid = v_table
      and attnum > 0
      and not attisdropped
  ) <> 5
    or not exists (
      select 1 from pg_attribute
      where attrelid = v_table and attname = 'singleton'
        and atttypid = 'boolean'::regtype and attnotnull
        and attnum > 0 and not attisdropped
    )
    or not exists (
      select 1 from pg_attribute
      where attrelid = v_table and attname = 'publication_generation'
        and atttypid = 'bigint'::regtype and attnotnull
        and attnum > 0 and not attisdropped
    )
    or not exists (
      select 1 from pg_attribute
      where attrelid = v_table and attname = 'checked_generation'
        and atttypid = 'bigint'::regtype and not attnotnull
        and attnum > 0 and not attisdropped
    )
    or not exists (
      select 1 from pg_attribute
      where attrelid = v_table and attname = 'verified_generation'
        and atttypid = 'bigint'::regtype and not attnotnull
        and attnum > 0 and not attisdropped
    )
    or not exists (
      select 1 from pg_attribute
      where attrelid = v_table and attname = 'verified_at'
        and atttypid = 'timestamp with time zone'::regtype and not attnotnull
        and attnum > 0 and not attisdropped
    )
  then
    raise exception 'Existing publication verification table has an incompatible column layout; inspect it before applying this migration.';
  end if;

  select array(select attnum::smallint from pg_attribute
    where attrelid = v_table and attname = 'singleton')
    into v_expected_primary_key;
  select conkey into v_primary_key
  from pg_constraint
  where conrelid = v_table and contype = 'p';
  if v_primary_key is distinct from v_expected_primary_key
    or (select count(*) from pg_constraint
        where conrelid = v_table and contype = 'p') <> 1
  then
    raise exception 'Existing publication verification table must have singleton as its only primary key.';
  end if;

  select count(*), string_agg(lower(pg_get_constraintdef(oid)), ' ')
    into v_check_count, v_check_definitions
  from pg_constraint
  where conrelid = v_table and contype = 'c';
  if v_check_count <> 3
    or v_check_definitions not like '%singleton%'
    or v_check_definitions not like '%publication_generation > 0%'
    or v_check_definitions not like '%checked_generation is null%'
    or v_check_definitions not like '%checked_generation = publication_generation%'
    or v_check_definitions not like '%verified_generation = publication_generation%'
    or v_check_definitions not like '%verified_at is not null%'
    or v_check_definitions not like '%verified_generation is null%'
    or v_check_definitions not like '%verified_at is null%'
    or exists (
      select 1 from pg_constraint
      where conrelid = v_table and contype = 'c' and not convalidated
    )
  then
    raise exception 'Existing publication verification table has incompatible singleton or generation-consistency constraints.';
  end if;
end;
$verification_schema_contract$;

comment on table public.portfolio_cms_publication_verification is
  'Private fail-closed publication eligibility state. Only trusted database functions can advance the verified generation; public roles cannot read or modify this table.';

insert into public.portfolio_cms_publication_verification (
  singleton, publication_generation, checked_generation, verified_generation, verified_at
)
values (true, 1, null, null, null)
on conflict (singleton) do nothing;

alter table public.portfolio_cms_publication_verification enable row level security;
revoke all on public.portfolio_cms_publication_verification
  from public, anon, authenticated;

create or replace function public.cms_publication_generation_is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.portfolio_cms_publication_verification verification
    where verification.singleton
      and verification.verified_generation = verification.publication_generation
      and verification.verified_at is not null
  )
$function$;

create or replace function public.cms_reverify_publication_generation()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_generation bigint;
  v_checked_generation bigint;
  v_verified_generation bigint;
  v_verified_at timestamptz;
begin
  select publication_generation, checked_generation, verified_generation, verified_at
    into v_generation, v_checked_generation, v_verified_generation, v_verified_at
  from public.portfolio_cms_publication_verification
  where singleton
  for update;

  if not found then
    raise exception 'Public CMS verification state is not initialized.';
  end if;

  if v_verified_generation = v_generation and v_verified_at is not null then
    return true;
  end if;

  if v_checked_generation = v_generation then
    return false;
  end if;

  if not public.cms_public_content_audited() then
    update public.portfolio_cms_publication_verification
    set checked_generation = v_generation,
        verified_generation = null,
        verified_at = null
    where singleton
      and publication_generation = v_generation;
    return false;
  end if;

  update public.portfolio_cms_publication_verification
  set checked_generation = v_generation,
      verified_generation = v_generation,
      verified_at = clock_timestamp()
  where singleton
    and publication_generation = v_generation;

  return found;
end;
$function$;

create or replace function public.cms_invalidate_publication_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_relevant_change boolean := true;
begin
  if tg_op = 'TRUNCATE' then
    v_relevant_change := true;
  elsif tg_table_schema = 'public'
    and tg_table_name = 'portfolio_cms_records'
  then
    if tg_op = 'INSERT' then
      v_relevant_change := new.published_payload is not null;
    elsif tg_op = 'UPDATE' then
      v_relevant_change :=
        old.content_type is distinct from new.content_type
        or old.record_id is distinct from new.record_id
        or old.published_payload is distinct from new.published_payload;
    else
      v_relevant_change := old.published_payload is not null;
    end if;
  elsif tg_table_schema = 'public'
    and tg_table_name = 'portfolio_cms_settings'
  then
    if tg_op = 'INSERT' then
      v_relevant_change := new.published_payload is not null;
    elsif tg_op = 'UPDATE' then
      v_relevant_change :=
        old.id is distinct from new.id
        or old.published_payload is distinct from new.published_payload;
    else
      v_relevant_change := old.published_payload is not null;
    end if;
  elsif tg_table_schema = 'storage'
    and tg_table_name = 'buckets'
  then
    if tg_op = 'INSERT' then
      v_relevant_change := new.id in ('portfolio-published', 'portfolio-private');
    elsif tg_op = 'UPDATE' then
      v_relevant_change :=
        (
          old.id in ('portfolio-published', 'portfolio-private')
          or new.id in ('portfolio-published', 'portfolio-private')
        )
        and (
          old.id is distinct from new.id
          or old.public is distinct from new.public
        );
    else
      v_relevant_change := old.id in ('portfolio-published', 'portfolio-private');
    end if;
  end if;

  if v_relevant_change then
    update public.portfolio_cms_publication_verification
    set publication_generation = publication_generation + 1,
        checked_generation = null,
        verified_generation = null,
        verified_at = null
    where singleton;

    if not found then
      raise exception 'Public CMS verification state is not initialized.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'TRUNCATE' then return null; end if;
  return new;
end;
$function$;

create or replace function public.cms_verify_publication_after_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.cms_reverify_publication_generation();
  return null;
end;
$function$;

revoke all on function public.cms_publication_generation_is_verified()
  from public, anon, authenticated;
grant execute on function public.cms_publication_generation_is_verified()
  to anon, authenticated;
revoke all on function public.cms_reverify_publication_generation()
  from public, anon, authenticated;
revoke all on function public.cms_invalidate_publication_verification()
  from public, anon, authenticated;
revoke all on function public.cms_verify_publication_after_mutation()
  from public, anon, authenticated;
revoke all on function public.cms_public_content_audited()
  from public, anon, authenticated;

drop policy if exists portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records;
create policy portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records for select to anon, authenticated
  using (
    published_payload ->> 'visibility' = 'true'
    and (select public.cms_publication_generation_is_verified())
  );

drop policy if exists portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings;
create policy portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings for select to anon, authenticated
  using (
    published_payload ->> 'visibility' = 'true'
    and (select public.cms_publication_generation_is_verified())
  );

drop trigger if exists portfolio_cms_publication_verification_records
  on public.portfolio_cms_records;
create trigger portfolio_cms_publication_verification_records
  after insert or update or delete on public.portfolio_cms_records
  for each row execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verify_records
  on public.portfolio_cms_records;
drop trigger if exists portfolio_cms_publication_verify_records_insert
  on public.portfolio_cms_records;
create constraint trigger portfolio_cms_publication_verify_records_insert
  after insert on public.portfolio_cms_records
  deferrable initially deferred
  for each row
  when (new.published_payload is not null)
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_records_update
  on public.portfolio_cms_records;
create constraint trigger portfolio_cms_publication_verify_records_update
  after update on public.portfolio_cms_records
  deferrable initially deferred
  for each row
  when (
    old.content_type is distinct from new.content_type
    or old.record_id is distinct from new.record_id
    or old.published_payload is distinct from new.published_payload
  )
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_records_delete
  on public.portfolio_cms_records;
create constraint trigger portfolio_cms_publication_verify_records_delete
  after delete on public.portfolio_cms_records
  deferrable initially deferred
  for each row
  when (old.published_payload is not null)
  execute function public.cms_verify_publication_after_mutation();

drop trigger if exists portfolio_cms_publication_verification_projection
  on public.portfolio_cms_public_records;
create trigger portfolio_cms_publication_verification_projection
  after insert or update or delete on public.portfolio_cms_public_records
  for each row execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verify_projection
  on public.portfolio_cms_public_records;
drop trigger if exists portfolio_cms_publication_verify_projection_insert
  on public.portfolio_cms_public_records;
create constraint trigger portfolio_cms_publication_verify_projection_insert
  after insert on public.portfolio_cms_public_records
  deferrable initially deferred
  for each row execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_projection_update
  on public.portfolio_cms_public_records;
create constraint trigger portfolio_cms_publication_verify_projection_update
  after update on public.portfolio_cms_public_records
  deferrable initially deferred
  for each row
  when (
    old.content_type is distinct from new.content_type
    or old.record_id is distinct from new.record_id
    or old.published_payload is distinct from new.published_payload
  )
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_projection_delete
  on public.portfolio_cms_public_records;
create constraint trigger portfolio_cms_publication_verify_projection_delete
  after delete on public.portfolio_cms_public_records
  deferrable initially deferred
  for each row execute function public.cms_verify_publication_after_mutation();

drop trigger if exists portfolio_cms_publication_verification_settings
  on public.portfolio_cms_settings;
create trigger portfolio_cms_publication_verification_settings
  after insert or update or delete on public.portfolio_cms_settings
  for each row execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verify_settings
  on public.portfolio_cms_settings;
drop trigger if exists portfolio_cms_publication_verify_settings_insert
  on public.portfolio_cms_settings;
create constraint trigger portfolio_cms_publication_verify_settings_insert
  after insert on public.portfolio_cms_settings
  deferrable initially deferred
  for each row
  when (new.published_payload is not null)
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_settings_update
  on public.portfolio_cms_settings;
create constraint trigger portfolio_cms_publication_verify_settings_update
  after update on public.portfolio_cms_settings
  deferrable initially deferred
  for each row
  when (
    old.id is distinct from new.id
    or old.published_payload is distinct from new.published_payload
  )
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_settings_delete
  on public.portfolio_cms_settings;
create constraint trigger portfolio_cms_publication_verify_settings_delete
  after delete on public.portfolio_cms_settings
  deferrable initially deferred
  for each row
  when (old.published_payload is not null)
  execute function public.cms_verify_publication_after_mutation();

drop trigger if exists portfolio_cms_publication_verification_public_settings
  on public.portfolio_cms_public_settings;
create trigger portfolio_cms_publication_verification_public_settings
  after insert or update or delete on public.portfolio_cms_public_settings
  for each row execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verify_public_settings
  on public.portfolio_cms_public_settings;
drop trigger if exists portfolio_cms_publication_verify_public_settings_insert
  on public.portfolio_cms_public_settings;
create constraint trigger portfolio_cms_publication_verify_public_settings_insert
  after insert on public.portfolio_cms_public_settings
  deferrable initially deferred
  for each row execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_public_settings_update
  on public.portfolio_cms_public_settings;
create constraint trigger portfolio_cms_publication_verify_public_settings_update
  after update on public.portfolio_cms_public_settings
  deferrable initially deferred
  for each row
  when (
    old.id is distinct from new.id
    or old.published_payload is distinct from new.published_payload
  )
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_public_settings_delete
  on public.portfolio_cms_public_settings;
create constraint trigger portfolio_cms_publication_verify_public_settings_delete
  after delete on public.portfolio_cms_public_settings
  deferrable initially deferred
  for each row execute function public.cms_verify_publication_after_mutation();

drop trigger if exists portfolio_cms_publication_verification_buckets
  on storage.buckets;
create trigger portfolio_cms_publication_verification_buckets
  after insert or update or delete on storage.buckets
  for each row execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verify_buckets
  on storage.buckets;
drop trigger if exists portfolio_cms_publication_verify_buckets_insert
  on storage.buckets;
create constraint trigger portfolio_cms_publication_verify_buckets_insert
  after insert on storage.buckets
  deferrable initially deferred
  for each row
  when (new.id in ('portfolio-published', 'portfolio-private'))
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_buckets_update
  on storage.buckets;
create constraint trigger portfolio_cms_publication_verify_buckets_update
  after update on storage.buckets
  deferrable initially deferred
  for each row
  when (
    (
      old.id in ('portfolio-published', 'portfolio-private')
      or new.id in ('portfolio-published', 'portfolio-private')
    )
    and (
      old.id is distinct from new.id
      or old.public is distinct from new.public
    )
  )
  execute function public.cms_verify_publication_after_mutation();
drop trigger if exists portfolio_cms_publication_verify_buckets_delete
  on storage.buckets;
create constraint trigger portfolio_cms_publication_verify_buckets_delete
  after delete on storage.buckets
  deferrable initially deferred
  for each row
  when (old.id in ('portfolio-published', 'portfolio-private'))
  execute function public.cms_verify_publication_after_mutation();

drop trigger if exists portfolio_cms_publication_verification_records_truncate
  on public.portfolio_cms_records;
create trigger portfolio_cms_publication_verification_records_truncate
  after truncate on public.portfolio_cms_records
  for each statement execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verification_projection_truncate
  on public.portfolio_cms_public_records;
create trigger portfolio_cms_publication_verification_projection_truncate
  after truncate on public.portfolio_cms_public_records
  for each statement execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verification_settings_truncate
  on public.portfolio_cms_settings;
create trigger portfolio_cms_publication_verification_settings_truncate
  after truncate on public.portfolio_cms_settings
  for each statement execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verification_public_settings_truncate
  on public.portfolio_cms_public_settings;
create trigger portfolio_cms_publication_verification_public_settings_truncate
  after truncate on public.portfolio_cms_public_settings
  for each statement execute function public.cms_invalidate_publication_verification();

drop trigger if exists portfolio_cms_publication_verification_buckets_truncate
  on storage.buckets;
create trigger portfolio_cms_publication_verification_buckets_truncate
  after truncate on storage.buckets
  for each statement execute function public.cms_invalidate_publication_verification();

create or replace function public.cms_publication_block_reason()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_public_bucket boolean;
  v_visibility_verified boolean;
  v_content_audited boolean;
begin
  perform public.cms_require_portfolio_admin();

  if not exists (
    select 1 from storage.buckets b
    where b.id = 'portfolio-private' and not b.public
  ) then
    return 'The portfolio-private bucket must exist and remain private for unpublished uploads.';
  end if;
  if not public.cms_legacy_bucket_safe('portfolio_media', true) then
    return 'The legacy portfolio_media bucket is missing or public; restore this exact private bucket for existing asset paths. The distinct hyphenated legacy buckets are not substitutes.';
  end if;
  if not public.cms_legacy_bucket_safe('portfolio-media', false) then
    return 'The legacy portfolio-media bucket is public and contains objects or CMS references; review it before publishing.';
  end if;
  if not public.cms_legacy_bucket_safe('portfolio-media.', false) then
    return 'The exact legacy portfolio-media. bucket is public and contains objects or CMS references; review it before publishing.';
  end if;

  select coalesce(bool_or(b.public), false)
    into v_public_bucket
    from storage.buckets b where b.id = 'portfolio-published';
  select coalesce(bool_or(a.visibility_verified_at is not null), false),
         coalesce(bool_or(a.audited_at is not null), false)
    into v_visibility_verified, v_content_audited
    from public.portfolio_cms_storage_audit a where a.bucket_id = 'portfolio-published';

  if not v_public_bucket then
    return 'The portfolio-published bucket must be explicitly configured as public by an operator before publishing.';
  end if;
  if not v_visibility_verified then
    return 'A trusted operator must verify and record the portfolio-published bucket visibility before publishing.';
  end if;
  if not v_content_audited then
    return 'A trusted operator must review the portfolio-published bucket contents and record the audit before publishing.';
  end if;
  if not public.cms_publication_generation_is_verified() then
    return 'The public CMS publication generation is not verified; reconcile published records and projections before publishing.';
  end if;
  return '';
end;
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
  v_visibility_verified boolean;
  v_media_audited boolean;
  v_projections_audited boolean;
  v_private_ready boolean;
  v_message text;
begin
  perform public.cms_require_portfolio_admin();
  select coalesce(bool_or(b.public), false) into v_media_public
    from storage.buckets b where b.id = 'portfolio-published';
  select coalesce(bool_or(a.visibility_verified_at is not null), false),
         coalesce(bool_or(a.audited_at is not null), false),
         coalesce(bool_or(a.projections_audited_at is not null), false)
    into v_visibility_verified, v_media_audited, v_projections_audited
    from public.portfolio_cms_storage_audit a where a.bucket_id = 'portfolio-published';
  select coalesce(bool_and(not b.public), false) into v_private_ready
    from storage.buckets b where b.id = 'portfolio-private';
  v_message := public.cms_publication_block_reason();
  return jsonb_build_object(
    'ok', true,
    'database', jsonb_build_object('ready', true),
    'storage', jsonb_build_object(
      'ready', v_media_public and v_media_audited and v_private_ready
        and v_visibility_verified and v_message = '',
      'publicBucketReady', v_media_public,
      'privateBucketReady', v_private_ready,
      'publicBucketVisibilityVerified', v_visibility_verified,
      'publicBucketAudited', v_media_audited,
      'publicContentAudited', v_media_audited,
      'publicStorageContentAuditRecorded', v_media_audited,
      'publicProjectionEligible', public.cms_publication_generation_is_verified(),
      'publicProjectionAuditRecorded', v_projections_audited,
      'message', v_message
    ),
    'admin', true
  );
end;
$function$;

update public.portfolio_cms_publication_verification
set publication_generation = publication_generation + 1,
    checked_generation = null,
    verified_generation = null,
    verified_at = null
where singleton;

commit;

notify pgrst, 'reload schema';

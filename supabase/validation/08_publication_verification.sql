-- Hosted regression for versioned, fail-closed public CMS verification.
-- Run only in the verified disposable project; all fixture changes roll back.
-- Verify Dashboard project name portfolio-cms-test and ref
-- ifakxmugmdcjyhytzpwx before execution. Never use production.
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
  if not exists (
    select 1 from storage.buckets
    where id = 'portfolio-published' and public
  ) then
    raise exception 'NOT RUN: portfolio-published must already be configured as public in the disposable project.';
  end if;
  if not exists (
    select 1 from public.portfolio_cms_public_settings
    where id = 'main' and published_payload ->> 'visibility' = 'true'
  ) then
    raise exception 'NOT RUN: publish the disposable project main settings before this regression test.';
  end if;
end;
$scope$;

do $fixture_preflight$
begin
  if exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'projects'
      and record_id = 'validation-public-verification'
  ) or exists (
    select 1 from public.portfolio_cms_records
    where content_type = 'media'
      and record_id = 'validation-private-media-draft'
  ) then
    raise exception 'STOP: verification fixture already exists; inspect it before running this test.';
  end if;
  if not public.cms_publication_generation_is_verified() then
    raise exception 'NOT RUN: verify the disposable project generation before this regression test.';
  end if;
  if has_table_privilege(
    'anon',
    'public.portfolio_cms_publication_verification',
    'select'
  ) then
    raise exception 'FAIL: anonymous users can read the private verification table.';
  end if;
end;
$fixture_preflight$;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

create temporary table verification_fixture_snapshot (
  published_payload jsonb not null
) on commit drop;
create temporary table verification_generation_snapshot (
  publication_generation bigint not null
) on commit drop;
create temporary table verification_rollback_snapshot (
  publication_generation bigint not null
) on commit drop;
create temporary table verification_settings_snapshot (
  published_payload jsonb not null
) on commit drop;

insert into verification_generation_snapshot (publication_generation)
select publication_generation
from public.portfolio_cms_publication_verification
where singleton;

select public.cms_save_record(
  'projects',
  'validation-public-verification',
  '{"title":"Verification fixture","slug":"validation-public-verification","visibility":true}'::jsonb,
  0
);
select public.cms_save_record(
  'media',
  'validation-private-media-draft',
  '{"title":"Private draft media","visibility":true,"storagePath":"portfolio-private/drafts/private.png"}'::jsonb,
  0
);
insert into verification_settings_snapshot (published_payload)
select published_payload
from public.portfolio_cms_public_settings
where id = 'main';
set constraints all immediate;

do $draft_remains_private$
declare
  v_generation bigint;
  v_previous_generation bigint;
begin
  select publication_generation
    into v_generation
  from public.portfolio_cms_publication_verification
  where singleton;
  select publication_generation
    into v_previous_generation
  from verification_generation_snapshot;
  if not public.cms_publication_generation_is_verified() then
    raise exception 'FAIL: saving a draft left the existing public generation unverified.';
  end if;
  if v_generation is distinct from v_previous_generation then
    raise exception 'FAIL: saving a draft changed the published generation.';
  end if;
end;
$draft_remains_private$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $draft_is_not_visible$
begin
  if exists (
    select 1 from public.portfolio_cms_public_records
    where record_id in (
      'validation-public-verification',
      'validation-private-media-draft'
    )
  ) then
    raise exception 'FAIL: an unpublished project or private media draft is visible to anon.';
  end if;
end;
$draft_is_not_visible$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

select public.cms_publish_record(
  'projects',
  'validation-public-verification',
  1,
  '{"title":"Verification fixture","slug":"validation-public-verification","visibility":true}'::jsonb
);

do $publish_is_verified$
declare
  v_current bigint;
  v_verified bigint;
  v_previous_generation bigint;
begin
  select publication_generation, verified_generation
    into v_current, v_verified
  from public.portfolio_cms_publication_verification
  where singleton;
  select publication_generation
    into v_previous_generation
  from verification_generation_snapshot;
  if v_current <= v_previous_generation or v_verified is distinct from v_current
    or not public.cms_publication_generation_is_verified()
  then
    raise exception 'FAIL: publication did not verify the new generation before commit.';
  end if;
  insert into verification_fixture_snapshot (published_payload)
  select published_payload
  from public.portfolio_cms_records
  where content_type = 'projects'
    and record_id = 'validation-public-verification';
  if not found then
    raise exception 'FAIL: published fixture source row was not found.';
  end if;
end;
$publish_is_verified$;
insert into verification_rollback_snapshot (publication_generation)
select publication_generation
from public.portfolio_cms_publication_verification
where singleton;

do $rolled_back_mutation_is_atomic$
declare
  v_generation bigint;
  v_previous_generation bigint;
begin
  select publication_generation
    into v_previous_generation
  from verification_rollback_snapshot;
  begin
    update public.portfolio_cms_records
    set published_payload = jsonb_set(
      published_payload,
      '{verificationProbe}',
      '"rolled-back-mutation"'::jsonb,
      true
    )
    where content_type = 'projects'
      and record_id = 'validation-public-verification';
    raise exception 'expected savepoint rollback';
  exception when others then
    if sqlerrm <> 'expected savepoint rollback' then
      raise;
    end if;
  end;
  select publication_generation
    into v_generation
  from public.portfolio_cms_publication_verification
  where singleton;
  if v_generation is distinct from v_previous_generation
    or not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: rolled-back published data or generation changes escaped the savepoint.';
  end if;
end;
$rolled_back_mutation_is_atomic$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $public_read_and_privileges$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.portfolio_cms_public_records
  where content_type = 'projects'
    and record_id = 'validation-public-verification';
  if v_count <> 1 then
    raise exception 'FAIL: anon could not read the verified published fixture.';
  end if;
  if has_table_privilege(
    'anon',
    'public.portfolio_cms_publication_verification',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'public.portfolio_cms_publication_verification',
    'update'
  ) then
    raise exception 'FAIL: a client role can read or modify private verification state.';
  end if;
end;
$public_read_and_privileges$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

update public.portfolio_cms_records
set published_payload = jsonb_set(
  published_payload,
  '{verificationProbe}',
  '"portfolio-private/validation-must-not-be-public.png"'::jsonb,
  true
)
where content_type = 'projects'
  and record_id = 'validation-public-verification';

do $unsafe_content_fails_closed$
begin
  if public.cms_public_content_audited()
    or public.cms_publication_generation_is_verified()
    or not exists (
      select 1
      from public.portfolio_cms_publication_verification
      where singleton
        and checked_generation = publication_generation
        and verified_generation is null
        and verified_at is null
    )
  then
    raise exception 'FAIL: an unsafe storage reference did not leave the current generation checked and unverified.';
  end if;
end;
$unsafe_content_fails_closed$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $unsafe_content_not_visible$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.portfolio_cms_public_records
  where record_id = 'validation-public-verification';
  if v_count <> 0 then
    raise exception 'FAIL: anon read a projection while its verification generation was stale.';
  end if;
end;
$unsafe_content_not_visible$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

update public.portfolio_cms_records
set published_payload = (
  select published_payload from verification_fixture_snapshot
)
where content_type = 'projects'
  and record_id = 'validation-public-verification';

do $safe_content_reverified$
begin
  if not public.cms_public_content_audited()
    or not public.cms_publication_generation_is_verified()
  then
    raise exception 'FAIL: restoring safe source/projection parity did not verify the generation.';
  end if;
end;
$safe_content_reverified$;

update public.portfolio_cms_settings
set published_payload = jsonb_set(
  published_payload,
  '{verificationProbe}',
  '"portfolio-private/settings-validation.png"'::jsonb,
  true
)
where id = 'main';
do $source_settings_mismatch_fails_closed$
begin
  if public.cms_publication_generation_is_verified()
    or public.cms_public_content_audited()
  then
    raise exception 'FAIL: a direct published-settings source update did not invalidate verification.';
  end if;
end;
$source_settings_mismatch_fails_closed$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $settings_are_hidden_when_stale$
begin
  if exists (select 1 from public.portfolio_cms_public_settings where id = 'main') then
    raise exception 'FAIL: anonymous settings reads remained available while verification was stale.';
  end if;
end;
$settings_are_hidden_when_stale$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
update public.portfolio_cms_settings
set published_payload = (
  select published_payload from verification_settings_snapshot
)
where id = 'main';
do $source_settings_recovered$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: correcting published settings did not restore verified visibility.';
  end if;
end;
$source_settings_recovered$;

update public.portfolio_cms_public_settings
set published_payload = published_payload || '{"verificationProbe":"direct-projection-update"}'::jsonb
where id = 'main';
do $direct_settings_projection_update_fails_closed$
begin
  if public.cms_publication_generation_is_verified()
    or public.cms_public_content_audited()
  then
    raise exception 'FAIL: a direct public-settings projection update did not invalidate verification.';
  end if;
end;
$direct_settings_projection_update_fails_closed$;
update public.portfolio_cms_public_settings
set published_payload = (
  select published_payload from verification_settings_snapshot
)
where id = 'main';
do $direct_settings_projection_update_recovers$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: restoring public-settings projection parity did not recover verification.';
  end if;
end;
$direct_settings_projection_update_recovers$;

delete from public.portfolio_cms_public_settings where id = 'main';
do $direct_settings_projection_delete_fails_closed$
begin
  if public.cms_publication_generation_is_verified()
    or public.cms_public_content_audited()
  then
    raise exception 'FAIL: deleting the public-settings projection did not invalidate verification.';
  end if;
end;
$direct_settings_projection_delete_fails_closed$;
insert into public.portfolio_cms_public_settings (id, published_payload)
select 'main', published_payload from verification_settings_snapshot;
do $direct_settings_projection_delete_recovers$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: restoring a deleted public-settings projection did not recover verification.';
  end if;
end;
$direct_settings_projection_delete_recovers$;

update public.portfolio_cms_public_records
set published_payload = published_payload || '{"verificationProbe":"direct-projection-update"}'::jsonb
where content_type = 'projects'
  and record_id = 'validation-public-verification';
do $direct_record_projection_update_fails_closed$
begin
  if public.cms_publication_generation_is_verified()
    or public.cms_public_content_audited()
  then
    raise exception 'FAIL: a direct public-record projection update did not invalidate verification.';
  end if;
end;
$direct_record_projection_update_fails_closed$;
update public.portfolio_cms_public_records projection
set published_payload = source.published_payload
from public.portfolio_cms_records source
where source.content_type = projection.content_type
  and source.record_id = projection.record_id
  and projection.content_type = 'projects'
  and projection.record_id = 'validation-public-verification';
do $direct_record_projection_update_recovers$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: restoring a public-record projection did not recover verification.';
  end if;
end;
$direct_record_projection_update_recovers$;

delete from public.portfolio_cms_public_records
where content_type = 'projects'
  and record_id = 'validation-public-verification';
do $direct_record_projection_delete_fails_closed$
begin
  if public.cms_publication_generation_is_verified()
    or public.cms_public_content_audited()
  then
    raise exception 'FAIL: deleting a public-record projection did not invalidate verification.';
  end if;
end;
$direct_record_projection_delete_fails_closed$;
insert into public.portfolio_cms_public_records (
  content_type, record_id, published_payload
)
select content_type, record_id, published_payload
from public.portfolio_cms_records
where content_type = 'projects'
  and record_id = 'validation-public-verification';
do $direct_record_projection_delete_recovers$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: restoring a deleted public-record projection did not recover verification.';
  end if;
end;
$direct_record_projection_delete_recovers$;

set constraints all deferred;
update public.portfolio_cms_public_records
set published_payload = published_payload || '{"verificationProbe":"transaction-first-change"}'::jsonb
where content_type = 'projects'
  and record_id = 'validation-public-verification';
update public.portfolio_cms_public_records projection
set published_payload = source.published_payload
from public.portfolio_cms_records source
where source.content_type = projection.content_type
  and source.record_id = projection.record_id
  and projection.content_type = 'projects'
  and projection.record_id = 'validation-public-verification';
do $deferred_checks_wait_for_final_state$
begin
  if public.cms_publication_generation_is_verified() then
    raise exception 'FAIL: deferred verification ran before final transaction state was audited.';
  end if;
end;
$deferred_checks_wait_for_final_state$;
set constraints all immediate;
do $multiple_mutations_share_final_verification$
declare
  v_generation bigint;
  v_checked bigint;
  v_verified bigint;
begin
  select publication_generation, checked_generation, verified_generation
    into v_generation, v_checked, v_verified
  from public.portfolio_cms_publication_verification
  where singleton;
  if v_checked is distinct from v_generation
    or v_verified is distinct from v_generation
    or not public.cms_publication_generation_is_verified()
  then
    raise exception 'FAIL: multiple deferred mutations did not converge on one verified final generation.';
  end if;
end;
$multiple_mutations_share_final_verification$;

update storage.buckets
set public = false
where id = 'portfolio-published';
do $bucket_change_fails_closed$
begin
  if public.cms_publication_generation_is_verified() then
    raise exception 'FAIL: changing the publication bucket visibility left the generation verified.';
  end if;
end;
$bucket_change_fails_closed$;

update storage.buckets
set public = true
where id = 'portfolio-published';
do $bucket_restore_reverified$
begin
  if not public.cms_publication_generation_is_verified() then
    raise exception 'FAIL: restoring the reviewed bucket visibility did not reverify safe content.';
  end if;
end;
$bucket_restore_reverified$;

update storage.buckets
set public = true
where id = 'portfolio-private';
do $private_bucket_change_fails_closed$
begin
  if public.cms_publication_generation_is_verified()
    or public.cms_public_content_audited()
  then
    raise exception 'FAIL: making the required private bucket public left the generation verified.';
  end if;
end;
$private_bucket_change_fails_closed$;
update storage.buckets
set public = false
where id = 'portfolio-private';
do $private_bucket_restore_reverified$
begin
  if not public.cms_publication_generation_is_verified()
    or not public.cms_public_content_audited()
  then
    raise exception 'FAIL: restoring portfolio-private to private did not reverify safe content.';
  end if;
end;
$private_bucket_restore_reverified$;

create temporary table verification_truncate_snapshot (
  publication_generation bigint not null
) on commit drop;
insert into verification_truncate_snapshot (publication_generation)
select publication_generation
from public.portfolio_cms_publication_verification
where singleton;
truncate table
  public.portfolio_cms_records,
  public.portfolio_cms_public_records,
  public.portfolio_cms_settings,
  public.portfolio_cms_public_settings;
do $truncate_invalidates_and_stays_closed$
declare
  v_generation bigint;
  v_previous_generation bigint;
begin
  select publication_generation
    into v_generation
  from public.portfolio_cms_publication_verification
  where singleton;
  select publication_generation
    into v_previous_generation
  from verification_truncate_snapshot;
  if v_generation <= v_previous_generation
    or public.cms_publication_generation_is_verified()
    or exists (
      select 1
      from public.portfolio_cms_publication_verification
      where singleton and checked_generation = publication_generation
    )
  then
    raise exception 'FAIL: relevant TRUNCATE operations did not invalidate and remain unchecked until trusted re-verification.';
  end if;
end;
$truncate_invalidates_and_stays_closed$;

rollback;

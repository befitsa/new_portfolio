begin;

do $migration$
declare
  v_argument_names text[];
begin
  select p.proargnames into v_argument_names
  from pg_proc p
  where p.oid = to_regprocedure('public.cms_publish_settings_with_assets(integer,jsonb)');

  if v_argument_names is not null
    and (
      v_argument_names[1] is distinct from 'p_expected_revision'
      or v_argument_names[2] is distinct from 'p_payload'
    )
  then
    execute 'drop function public.cms_publish_settings_with_assets(integer, jsonb)';
  end if;
end;
$migration$;

create or replace function public.cms_publish_settings_with_assets(
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
  v_current public.portfolio_cms_settings%rowtype;
  v_payload jsonb;
  v_block_reason text;
begin
  if p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'Provide valid portfolio settings and a revision before publishing.';
  end if;

  v_block_reason := public.cms_publication_block_reason();
  if v_block_reason <> '' then
    raise exception using errcode = '55000', message = v_block_reason;
  end if;

  select * into v_current
  from public.portfolio_cms_settings
  where id = 'main'
  for update;

  if not found or v_current.draft_payload is null then
    raise exception using
      errcode = 'P0002',
      message = 'Save the portfolio settings draft before publishing.';
  end if;

  if v_current.revision <> p_expected_revision
    or v_current.base_published_revision <> v_current.published_revision
  then
    raise exception using
      errcode = '40001',
      message = 'Portfolio settings changed after this draft was started. Reload before publishing.';
  end if;

  v_payload := jsonb_set(
    p_payload - array[
      'id', 'status', 'revision', 'publishedRevision', 'basePublishedRevision',
      'createdAt', 'updatedAt', 'publishedAt', 'publishedBy', 'updatedBy'
    ],
    '{visibility}',
    'true'::jsonb,
    true
  );

  if public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio-private')
    or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio_media')
    or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio-media')
    or public.cms_jsonb_uses_storage_bucket(v_payload, 'portfolio-media.')
  then
    raise exception using
      errcode = '55000',
      message = 'Private or legacy asset paths must be promoted to portfolio-published before publishing settings.';
  end if;

  if public.cms_jsonb_has_unknown_storage_bucket(v_payload) then
    raise exception using
      errcode = '55000',
      message = 'A storage path uses an unsupported bucket ID; verify the exact bucket ID and promote the asset to portfolio-published.';
  end if;

  update public.portfolio_cms_settings set
    status = 'published',
    published_payload = v_payload,
    published_revision = v_current.revision,
    base_published_revision = v_current.revision,
    published_at = now(),
    published_by = v_uid,
    updated_at = now(),
    updated_by = v_uid
  where id = 'main';

  return public.cms_get_settings('published');
end;
$function$;

revoke all on function public.cms_publish_settings_with_assets(integer, jsonb) from public, anon, authenticated;
grant execute on function public.cms_publish_settings_with_assets(integer, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';

begin;

create or replace function public.cms_public_storage_audit_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_bucket jsonb;
  v_objects jsonb;
begin
  select jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'public', b.public,
    'fileSizeLimit', b.file_size_limit,
    'allowedMimeTypes', b.allowed_mime_types
  )
  into v_bucket
  from storage.buckets b
  where b.id = 'portfolio-published'
    and b.public;

  if v_bucket is null then
    raise exception using
      errcode = '55000',
      message = 'Cannot review storage: portfolio-published must exist and be public.';
  end if;

  if not exists (
    select 1 from storage.buckets b
    where b.id = 'portfolio-private' and not b.public
  ) then
    raise exception using
      errcode = '55000',
      message = 'Cannot review storage: portfolio-private must exist and remain private.';
  end if;

  if not public.cms_legacy_bucket_safe('portfolio_media', true)
    or not public.cms_legacy_bucket_safe('portfolio-media', false)
    or not public.cms_legacy_bucket_safe('portfolio-media.', false)
  then
    raise exception using
      errcode = '55000',
      message = 'Cannot review storage: resolve the legacy bucket safety checks before recording an audit.';
  end if;

  if not public.cms_public_content_audited() then
    raise exception using
      errcode = '55000',
      message = 'Cannot review storage: reconcile public CMS projections and asset paths before recording an audit.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', object_row.id,
        'name', object_row.name,
        'createdAt', object_row.created_at,
        'updatedAt', object_row.updated_at,
        'metadata', coalesce(object_row.metadata, '{}'::jsonb),
        'referencedBy', coalesce(refs.items, '[]'::jsonb)
      )
      order by object_row.name
    ),
    '[]'::jsonb
  )
  into v_objects
  from storage.objects object_row
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'contentType', content.content_type,
        'recordId', content.record_id
      )
      order by content.content_type, content.record_id
    ) as items
    from (
      select r.content_type, r.record_id, r.published_payload
      from public.portfolio_cms_records r
      where r.published_payload is not null
        and r.published_payload ->> 'visibility' = 'true'
      union all
      select 'settings', s.id, s.published_payload
      from public.portfolio_cms_settings s
      where s.published_payload is not null
        and s.published_payload ->> 'visibility' = 'true'
    ) content
    where public.cms_jsonb_uses_storage_path(
      content.published_payload,
      'portfolio-published/' || object_row.name
    )
  ) refs on true
  where object_row.bucket_id = 'portfolio-published';

  return jsonb_build_object(
    'bucket', v_bucket,
    'objects', v_objects
  );
end;
$function$;

create or replace function public.cms_get_public_storage_audit_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform public.cms_require_portfolio_admin();
  return public.cms_public_storage_audit_snapshot();
end;
$function$;

create or replace function public.cms_record_public_storage_audit(
  p_reviewed_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := public.cms_require_portfolio_admin();
  v_current_snapshot jsonb;
begin
  if jsonb_typeof(p_reviewed_snapshot) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'A reviewed Storage inventory snapshot is required.';
  end if;

  perform 1
  from public.portfolio_cms_storage_audit
  where bucket_id = 'portfolio-published'
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Storage audit state is not initialized; apply the portfolio CMS migration first.';
  end if;

  v_current_snapshot := public.cms_public_storage_audit_snapshot();
  if p_reviewed_snapshot is distinct from v_current_snapshot then
    raise exception using
      errcode = '40001',
      message = 'Storage changed after review. Reload the inventory, inspect it again, and retry.';
  end if;

  update public.portfolio_cms_storage_audit
  set visibility_verified_at = clock_timestamp(),
      audited_at = clock_timestamp(),
      audited_by = v_uid
  where bucket_id = 'portfolio-published';

  return jsonb_build_object(
    'bucketId', 'portfolio-published',
    'auditedAt', clock_timestamp(),
    'auditedBy', v_uid
  );
end;
$function$;

revoke all on function public.cms_public_storage_audit_snapshot()
  from public, anon, authenticated;
revoke all on function public.cms_get_public_storage_audit_snapshot()
  from public, anon, authenticated;
revoke all on function public.cms_record_public_storage_audit(jsonb)
  from public, anon, authenticated;

grant execute on function public.cms_get_public_storage_audit_snapshot()
  to authenticated;
grant execute on function public.cms_record_public_storage_audit(jsonb)
  to authenticated;

commit;

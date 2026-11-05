begin;

create or replace function public.cms_jsonb_has_unsafe_public_storage_reference(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_child jsonb;
  v_text text;
  v_path text;
  v_bucket text;
begin
  if jsonb_typeof(p_value) = 'string' then
    v_text := p_value #>> '{}';
    foreach v_bucket in array array[
      'portfolio-private',
      'portfolio_media',
      'portfolio-media',
      'portfolio-media.'
    ]
    loop
      if left(v_text, char_length(v_bucket) + 1) = v_bucket || '/'
        or position('/' || v_bucket || '/' in v_text) > 0
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'object' then
    if p_value ? 'storagePath' then
      v_path := nullif(p_value ->> 'storagePath', '');
      if v_path is not null then
        v_bucket := split_part(v_path, '/', 1);
        if position('/' in v_path) = 0
          or v_bucket not in (
            'portfolio-private',
            'portfolio-published',
            'portfolio_media',
            'portfolio-media',
            'portfolio-media.'
          )
        then
          return true;
        end if;
      end if;
    end if;
    for v_child in select value from jsonb_each(p_value)
    loop
      if public.cms_jsonb_has_unsafe_public_storage_reference(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.cms_jsonb_has_unsafe_public_storage_reference(v_child) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$function$;

create or replace function public.cms_public_content_audited()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  return (
    select exists (
      select 1 from storage.buckets
      where id = 'portfolio-published' and public
    )
    and exists (
      select 1 from storage.buckets
      where id = 'portfolio-private' and not public
    )
    and not exists (
      select 1
      from public.portfolio_cms_records source
      left join public.portfolio_cms_public_records projection
        on projection.content_type = source.content_type
        and projection.record_id = source.record_id
      where source.published_payload is not null
        and source.published_payload ->> 'visibility' = 'true'
        and (
          projection.published_payload is distinct from source.published_payload
          or public.cms_jsonb_has_unsafe_public_storage_reference(source.published_payload)
        )
    )
    and not exists (
      select 1
      from public.portfolio_cms_public_records projection
      left join public.portfolio_cms_records source
        on source.content_type = projection.content_type
        and source.record_id = projection.record_id
      where source.record_id is null
        or source.published_payload is null
        or source.published_payload ->> 'visibility' is distinct from 'true'
        or source.published_payload is distinct from projection.published_payload
        or public.cms_jsonb_has_unsafe_public_storage_reference(projection.published_payload)
    )
    and not exists (
      select 1
      from public.portfolio_cms_settings source
      left join public.portfolio_cms_public_settings projection on projection.id = source.id
      where source.published_payload is not null
        and source.published_payload ->> 'visibility' = 'true'
        and (
          projection.published_payload is distinct from source.published_payload
          or public.cms_jsonb_has_unsafe_public_storage_reference(source.published_payload)
        )
    )
    and not exists (
      select 1
      from public.portfolio_cms_public_settings projection
      left join public.portfolio_cms_settings source on source.id = projection.id
      where source.id is null
        or source.published_payload is null
        or source.published_payload ->> 'visibility' is distinct from 'true'
        or source.published_payload is distinct from projection.published_payload
        or public.cms_jsonb_has_unsafe_public_storage_reference(projection.published_payload)
    )
  );
end;
$function$;

revoke all on function public.cms_jsonb_has_unsafe_public_storage_reference(jsonb)
  from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

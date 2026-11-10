begin;

drop policy if exists portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records;
create policy portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records
  as permissive
  for select
  to anon, authenticated
  using (
    (published_payload ->> 'visibility') = 'true'
    and (select public.cms_public_content_audited())
  );

drop policy if exists portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings;
create policy portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings
  as permissive
  for select
  to anon, authenticated
  using (
    (published_payload ->> 'visibility') = 'true'
    and (select public.cms_public_content_audited())
  );

commit;

notify pgrst, 'reload schema';

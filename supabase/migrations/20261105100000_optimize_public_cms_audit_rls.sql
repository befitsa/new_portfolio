begin;

-- Keep the global audit check as an initplan, not a per-row RLS expression.
drop policy if exists portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records;
create policy portfolio_cms_public_projection_read
  on public.portfolio_cms_public_records for select to anon, authenticated
  using (
    published_payload ->> 'visibility' = 'true'
    and (select public.cms_public_content_audited())
  );

drop policy if exists portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings;
create policy portfolio_cms_public_settings_projection_read
  on public.portfolio_cms_public_settings for select to anon, authenticated
  using (
    published_payload ->> 'visibility' = 'true'
    and (select public.cms_public_content_audited())
  );

commit;

notify pgrst, 'reload schema';

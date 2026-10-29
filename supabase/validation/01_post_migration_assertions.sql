-- Run only after the disposable-copy migration succeeds in the verified test project.
-- WARNING: SQL cannot independently prove the active Supabase project identity.
-- Verify Dashboard URL and Project Settings > General show ifakxmugmdcjyhytzpwx
-- before every script. Never use production ref bupageguxdvphaebvdoa.

DO $assertions$
DECLARE
  v_ref text := 'ifakxmugmdcjyhytzpwx';
  v_definition text;
  v_admin_check text;
  v_admin_wrapper text;
  v_ready_reason text;
  v_health jsonb;
BEGIN
  -- Confirm the disposable-project marker.
  IF v_ref <> 'ifakxmugmdcjyhytzpwx'
     OR NOT EXISTS (
       SELECT 1
       FROM public.cms_validation_scope
       WHERE scope_name = 'portfolio-cms-migration-test'
         AND verified_project_ref = 'ifakxmugmdcjyhytzpwx'
     )
  THEN
    RAISE EXCEPTION
      'STOP: disposable-project marker does not match the Dashboard project ref.';
  END IF;

  -- Required CMS tables.
  IF to_regclass('public.portfolio_cms_records') IS NULL
     OR to_regclass('public.portfolio_cms_settings') IS NULL
     OR to_regclass('public.portfolio_cms_public_records') IS NULL
     OR to_regclass('public.portfolio_cms_public_settings') IS NULL
     OR to_regclass('public.portfolio_cms_storage_audit') IS NULL
  THEN
    RAISE EXCEPTION 'FAIL: migration CMS tables are missing.';
  END IF;

  -- Required CMS functions.
  IF to_regprocedure('public.cms_list_records(text,text)') IS NULL
     OR to_regprocedure('public.cms_get_record(text,text,text)') IS NULL
     OR to_regprocedure('public.cms_save_record(text,text,jsonb,integer)') IS NULL
     OR to_regprocedure('public.cms_publish_record(text,text,integer,jsonb)') IS NULL
     OR to_regprocedure('public.cms_unpublish_record(text,text)') IS NULL
     OR to_regprocedure('public.cms_delete_record(text,text)') IS NULL
     OR to_regprocedure('public.cms_reorder_records(text,jsonb)') IS NULL
     OR to_regprocedure('public.cms_get_settings(text)') IS NULL
     OR to_regprocedure('public.cms_save_settings(jsonb,integer)') IS NULL
     OR to_regprocedure('public.cms_publish_settings(integer)') IS NULL
     OR to_regprocedure('public.cms_unpublish_settings()') IS NULL
     OR to_regprocedure('public.cms_health()') IS NULL
     OR to_regprocedure('public.cms_is_admin()') IS NULL
     OR to_regprocedure('public.cms_public_content_audited()') IS NULL
     OR to_regprocedure('public.cms_jsonb_has_unknown_storage_bucket(jsonb)') IS NULL
     OR to_regprocedure('public.cms_legacy_bucket_safe(text,boolean)') IS NULL
  THEN
    RAISE EXCEPTION 'FAIL: expected CMS functions are missing.';
  END IF;

  -- Required table columns.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_cms_records'
      AND column_name = 'content_type'
  )
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_cms_records'
      AND column_name = 'record_id'
  )
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_cms_records'
      AND column_name = 'draft_payload'
  )
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_cms_records'
      AND column_name = 'published_payload'
  )
  OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_cms_settings'
      AND column_name = 'draft_payload'
  )
  THEN
    RAISE EXCEPTION
      'FAIL: CMS table columns do not match the frontend draft/published data model.';
  END IF;

  -- Verify the administrator registry function.
  SELECT pg_get_functiondef('public.is_portfolio_admin()'::regprocedure)
  INTO v_admin_check;

  IF position('auth.uid()' IN lower(v_admin_check)) = 0
     OR position('security definer' IN lower(v_admin_check)) = 0
     OR position('search_path' IN lower(v_admin_check)) = 0
     OR position('cms_' IN lower(v_admin_check)) > 0
  THEN
    RAISE EXCEPTION
      'FAIL: test admin registry is not a non-recursive, locked-down check of auth.uid().';
  END IF;

  SELECT pg_get_functiondef(
    'public.cms_require_portfolio_admin()'::regprocedure
  )
  INTO v_definition;

  SELECT pg_get_functiondef('public.cms_is_admin()'::regprocedure)
  INTO v_admin_wrapper;

  IF position('public.is_portfolio_admin()' IN v_definition) = 0
     OR position('public.is_portfolio_admin()' IN v_admin_wrapper) = 0
     OR position(
       '350db73c-d045-4b51-88bf-36ee9b2d07db'
       IN v_definition || v_admin_wrapper
     ) > 0
  THEN
    RAISE EXCEPTION
      'FAIL: CMS authorization does not delegate to the trusted administrator registry.';
  END IF;

  -- Verify private storage buckets.
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'portfolio-private'
      AND public = false
  )
  THEN
    RAISE EXCEPTION
      'FAIL: missing portfolio-private bucket was not created privately.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'portfolio-published'
      AND public = false
  )
  THEN
    RAISE EXCEPTION
      'FAIL: missing portfolio-published bucket was not created privately.';
  END IF;

  -- Verify migration did not change legacy bucket visibility.
  IF EXISTS (
    SELECT 1
    FROM public.cms_validation_bucket_baseline baseline
    JOIN storage.buckets bucket
      ON bucket.id = baseline.bucket_id
    WHERE bucket.public IS DISTINCT FROM baseline.was_public
  )
  THEN
    RAISE EXCEPTION
      'FAIL: migration changed visibility of a legacy test bucket.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cms_validation_bucket_baseline baseline
    WHERE NOT EXISTS (
      SELECT 1
      FROM storage.buckets b
      WHERE b.id = baseline.bucket_id
    )
  )
  THEN
    RAISE EXCEPTION 'FAIL: migration removed a legacy test bucket.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cms_validation_bucket_baseline baseline
    WHERE (
      SELECT count(*)
      FROM storage.objects object
      WHERE object.bucket_id = baseline.bucket_id
    ) <> baseline.object_count
  )
  THEN
    RAISE EXCEPTION
      'FAIL: migration changed the object count in a legacy test bucket.';
  END IF;

  -- Legacy project draft mapping.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_records
    WHERE content_type = 'projects'
      AND record_id = 'validation-legacy-draft'
      AND status = 'draft'
      AND published_payload IS NULL
      AND draft_payload ->> 'synopsis' = 'Draft description'
      AND draft_payload -> 'techStack'
          = '["DraftTech","SharedTech"]'::jsonb
      AND draft_payload -> 'cover_image'
          = '"portfolio_media/projects/draft-cover.png"'::jsonb
      AND draft_payload -> 'images'
          = '["portfolio_media/projects/draft-gallery.png"]'::jsonb
      AND draft_payload #>> '{heroImage,storagePath}'
          = 'portfolio_media/projects/draft-cover.png'
      AND draft_payload #>> '{gallery,0,storagePath}'
          = 'portfolio_media/projects/draft-gallery.png'
  )
  THEN
    RAISE EXCEPTION
      'FAIL: actual-schema legacy draft fields or private media references were not preserved and mapped.';
  END IF;

  -- Legacy published project mapping.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_records
    WHERE content_type = 'projects'
      AND record_id = 'validation-legacy-published'
      AND status = 'published'
      AND published_payload ->> 'visibility' = 'true'
      AND published_payload -> 'techStack'
          = '["React","PostgreSQL","Vite"]'::jsonb
      AND draft_payload -> 'techStack'
          = '["React","PostgreSQL","Vite"]'::jsonb
      AND published_payload ->> 'synopsis' = 'Published description'
      AND published_payload #>> '{heroImage,url}'
          = 'https://assets.example.test/published-cover.png'
      AND published_payload #>> '{gallery,1,url}'
          = 'https://assets.example.test/published-2.png'
      AND published_payload -> 'technologies'
          = '["React","PostgreSQL","Vite"]'::jsonb
  )
  THEN
    RAISE EXCEPTION
      'FAIL: published legacy schema fields, structured technologies, or media references were not preserved and mapped.';
  END IF;

  -- Legacy comma-separated technologies.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_records
    WHERE content_type = 'projects'
      AND record_id = 'validation-legacy-comma-tech'
      AND status = 'published'
      AND published_payload -> 'technologies' = '"React, Vite"'::jsonb
      AND published_payload -> 'techStack' = '["React","Vite"]'::jsonb
  )
  THEN
    RAISE EXCEPTION
      'FAIL: comma-separated JSONB technology string was not converted without replacing its source value.';
  END IF;

  -- Experience record: keys reflect the actual stored JSONB payload.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_records
    WHERE content_type = 'experiences'
      AND record_id = 'validation-experience'
      AND status = 'published'
      AND published_payload ->> 'logoinitials' = 'EC'
      AND published_payload -> 'skills' = '["SQL","React"]'::jsonb
  )
  THEN
    RAISE EXCEPTION
      'FAIL: experience record status, logo initials, or skills were not retained.';
  END IF;

  -- Education record: keys reflect the actual stored JSONB payload.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_records
    WHERE content_type = 'education'
      AND record_id = 'validation-education'
      AND status = 'draft'
      AND published_payload IS NULL
      AND draft_payload ->> 'credentialurl'
          = 'https://example.test/credential'
  )
  THEN
    RAISE EXCEPTION
      'FAIL: education frontend fields, credential URL, or draft status were not retained.';
  END IF;

  -- Legacy site settings and public settings projection.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_settings
    WHERE id = 'main'
      AND status = 'published'
      AND published_payload ->> 'name' = 'Disposable Test Admin'
      AND published_payload -> 'socialLinks'
          = '{"github":"https://github.com/example"}'::jsonb
      AND published_payload -> 'featuredProjectIds'
          = '["validation-legacy-published"]'::jsonb
  )
  OR NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_public_settings
    WHERE id = 'main'
      AND published_payload ->> 'name' = 'Disposable Test Admin'
  )
  THEN
    RAISE EXCEPTION
      'FAIL: legacy site settings or its published projection were not preserved.';
  END IF;

  -- Ambiguous legacy projects must remain drafts and stay private.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_records
    WHERE content_type = 'projects'
      AND record_id = 'validation-legacy-ambiguous'
      AND status = 'draft'
      AND published_payload IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM public.portfolio_cms_public_records
    WHERE content_type = 'projects'
      AND record_id = 'validation-legacy-ambiguous'
  )
  THEN
    RAISE EXCEPTION
      'FAIL: ambiguous legacy publication status was exposed instead of treated as draft.';
  END IF;

  -- Verify expected public projection bootstrap row.
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolio_cms_public_records
    WHERE content_type = 'projects'
      AND record_id = 'validation-legacy-published'
  )
  THEN
    RAISE EXCEPTION
      'FAIL: expected public projection bootstrap row is missing.';
  END IF;

  -- Public content must not be considered audited while destination is private.
  IF public.cms_public_content_audited() THEN
    RAISE EXCEPTION
      'FAIL: public projection eligibility was true while the published destination bucket is still private.';
  END IF;

  -- Verify legacy bucket safety helpers.
  IF public.cms_legacy_bucket_safe('portfolio-media.', false)
       IS DISTINCT FROM true
     OR public.cms_legacy_bucket_safe('portfolio-media', false)
       IS DISTINCT FROM true
     OR public.cms_legacy_bucket_safe('portfolio-media', true)
       IS DISTINCT FROM false
     OR public.cms_legacy_bucket_safe('portfolio-private', true)
       IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION
      'FAIL: legacy bucket safety helper returned an unexpected result.';
  END IF;

  -- Verify unknown storage bucket detection.
  IF public.cms_jsonb_has_unknown_storage_bucket(
       '{"storagePath":"unknown-bucket/file.png"}'::jsonb
     ) IS DISTINCT FROM true
     OR public.cms_jsonb_has_unknown_storage_bucket(
       '{"storagePath":"portfolio-private/file.png"}'::jsonb
     ) IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION
      'FAIL: unknown storage bucket detection returned an unexpected result.';
  END IF;

  -- Verify the health function returns JSON.
  v_health := public.cms_health();

  IF v_health IS NULL OR jsonb_typeof(v_health) <> 'object' THEN
    RAISE EXCEPTION 'FAIL: CMS health function did not return a JSON object.';
  END IF;

  RAISE NOTICE
    'PASS: CMS migration assertions succeeded for disposable test project %.',
    v_ref;
END;
$assertions$;
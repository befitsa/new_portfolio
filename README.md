# Fitsum Mesfin Portfolio & CMS

The public portfolio and admin CMS share the existing React/Vite application. The portfolio continues to read its existing published production content. Local CMS editing is available only through the Vite development server and stores records in JSON files and uploaded assets on disk. No local filesystem data is included in the production build.

## Local development

Install dependencies and start Vite:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. The public portfolio is at `/`; the local CMS is at `/admin`. Local development authentication is intentionally Firebase-free and is only enabled in Vite development mode. Do not expose the development server to the public internet.

The first local run creates `.local-cms/content.json` with empty project, experience, education, resume, and media collections, plus profile settings initialized from the existing profile. Existing files are read and validated, never reset on startup; malformed or unsupported files cause an error rather than being overwritten. Uploaded images, media, and PDF resumes are stored under `.local-cms/uploads/`. Both locations are ignored by Git, persist through browser refreshes and server restarts, and remain on the local machine.

Local CRUD, drafts, publishing, and public reads use the same provider-facing CMS API as the production Supabase adapter. Public development pages read only published, visible local records. Local publishing never changes production content. The development API and its uploaded files accept loopback requests only.

The local CMS requires no Firebase, Cloudflare Workers, Cloudflare Access, Netlify Functions, external storage, or CMS API environment variables. The existing Firebase variables in `.env.example` are retained for the portfolio and production sign-in; local filesystem CMS does not need them.

## Admin features

- `/admin` — content dashboard and storage status.
- `/admin/background` — create, edit, reorder, preview, publish, and unpublish experience and education records.
- `/admin/projects` — search, filter, reorder, edit, publish, and unpublish projects.
- `/admin/projects/new` and `/admin/projects/:id` — create and edit projects, upload/replace cover images, manage galleries, preview, save drafts, and publish.
- `/admin/resume` — upload validated PDF drafts, preview/download, activate a version, restore an earlier version, and unpublish.
- `/admin/media` — upload and reference images, replace files, inspect usage, search, and remove unused assets.
- `/admin/settings` — save and publish local profile and SEO settings.

Draft records are kept separate from their published versions. A successful publish updates only the local public preview. Local uploads validate file size, MIME type and image signature; PDFs are checked for document structure. Browser code sends files to the Vite development API and does not write to the project directory.

## Production Supabase CMS

The production admin CMS and public published-content adapter use Supabase. The browser authenticates through Supabase Auth, reads/writes CMS records through authenticated Postgres RPCs, reads public projection tables, and uploads draft assets to Supabase Storage. Administrator authorization is enforced by the existing `public.is_portfolio_admin()` registry and CMS RPCs; a signed-in user is not automatically an administrator. Draft uploads stay in the private `portfolio-private` bucket until an authorized publish operation promotes referenced assets.

### Admin password recovery

The Supabase admin login provides **Forgot Password?** and sends a Supabase Auth reset email to `${window.location.origin}/admin/reset-password`. Configure Supabase Dashboard → **Authentication → URL Configuration** with the correct Site URL and allow the exact recovery redirect URLs:

- Local Site URL: `http://localhost:3000`
- Local Redirect URL: `http://localhost:3000/admin/reset-password`
- Production Redirect URL: `https://YOUR-PRODUCTION-DOMAIN/admin/reset-password`

Only add the actual production host and local development URL used by your team; do not use a broad wildcard. In Vite development mode, the regular CMS remains local-only; `/admin/login` can also send a Supabase recovery email when the Supabase public URL and publishable key are configured. The reset route processes the Supabase callback without changing local CMS data or login behavior. In **Authentication → Email Templates → Reset Password**, retain Supabase's confirmation URL variable (`{{ .ConfirmationURL }}`) so the email link can establish the recovery session and return to the configured path. Confirm Auth email delivery/SMTP and the template sender, then test delivery in the mailbox and Supabase Auth logs. A missing, expired, reused, or non-admin recovery session cannot show the password form. A valid recovery session must pass the existing `cms_is_admin` check; after changing the password the user is signed out and must sign in normally. Recovery does not extend or bypass the configured admin session lifetime.

The repository cannot inspect or change hosted Supabase URL allowlists, SMTP/email-template settings, or verify delivered email/reset links. Complete these project-level settings and test a real recovery link in a non-production test account before relying on recovery in production.

Site settings remain private as drafts. An explicit settings publish marks the global profile settings visible so legacy settings imported with `visibility: false` can be exposed through the public projection; use **Publish settings** after deployment to republish those settings.

### Netlify build configuration

The active Supabase CMS requires these browser configuration variables:

- `VITE_SUPABASE_URL` — URL of the Supabase project intended for this Netlify site.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — that project's publishable (formerly anon) key.

`VITE_PUBLIC_PORTFOLIO_URL` supplies the public-site link shown in the admin dashboard. `VITE_ADMIN_SUBDOMAIN` is only used in local/development routing. Values prefixed `VITE_` are embedded in browser code: use only public project configuration and never put service-role keys, database passwords, access tokens, or other secrets in them. A URL/key mismatch or missing variable requires correcting the Netlify site/environment build settings and rebuilding; do not post key values in tickets or chat.

### Contact email delivery

The contact form submits directly to the Netlify Function at `/.netlify/functions/contact`. `/api/contact` is also explicitly rewritten to that function before the single-page-app fallback. The function sends plain-text email through Resend; the recipient is read from `CONTACT_TO_EMAIL`, and the visitor's validated address is used as `reply_to`. Netlify Blobs stores a per-client rate counter (five messages per hour). Configure these variables in the Netlify site's server-side environment settings:

- `RESEND_API_KEY` — Resend API key. Keep it server-side; never prefix it with `VITE_`.
- `CONTACT_FROM_EMAIL` — a sender address verified in Resend, or Resend's supported testing sender `onboarding@resend.dev` until a sending domain is verified.
- `CONTACT_TO_EMAIL` — recipient, set to `befitsa123@gmail.com` (this is also the code default).
- `CONTACT_ALLOWED_ORIGINS` — optional comma-separated exact origins for a contact endpoint hosted on a different origin. Same-origin Netlify requests are allowed automatically.

The Resend testing sender may restrict recipients to verified addresses on the Resend account. Verify a custom sending domain in Resend before using a sender at that domain. Local Vite development does not run Netlify Functions; use Netlify Dev with the same server-side variables to exercise delivery locally. A successful form response means Resend accepted the message, not that it reached the recipient's inbox. Verify delivery through Resend's message logs and the recipient mailbox after deployment.

After updating Netlify variables, verify the site context (production vs deploy preview) and rebuild the site so Vite embeds the intended values. The repository cannot verify Netlify settings or which Supabase project a deployed bundle targets. Firebase environment variables and `VITE_CMS_API_URL` described by older setup notes are not used by the current Supabase CMS provider.

### Database, administrator, and Storage prerequisites

#### Repair a missing settings-publish RPC

The frontend calls `public.cms_publish_settings_with_assets(p_expected_revision integer, p_payload jsonb)`. If PostgREST reports that function missing, first confirm the Supabase project reference matches the production site's configured project. Apply `supabase/migrations/20261102182000_repair_settings_publish_rpc.sql` to that project; it safely creates/replaces the exact RPC, repairs mismatched argument names on the same integer/JSONB signature without `CASCADE`, keeps the administrator, revision, asset, and publication-review checks, grants execution only to `authenticated` (with the function still enforcing the portfolio-admin registry), and sends `NOTIFY pgrst, 'reload schema'` after commit. Do not apply the base CMS migration as a repair.

With the Supabase CLI installed, verify the project before linking and pushing:

```powershell
npx supabase projects list
npx supabase link --project-ref <verified-production-project-ref>
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

Confirm the dry run lists only the expected pending migration for the verified project. If the CLI is not linked/configured, open the SQL Editor for the verified production project, run the complete new migration file, and confirm the transaction succeeds. The migration itself reloads PostgREST's schema cache after commit.

After applying it, verify the RPC contract and role grants without selecting secrets or whole CMS payloads:

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.proargnames as argument_names,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  not exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'cms_publish_settings_with_assets';
```

Expected: identity arguments `p_expected_revision integer, p_payload jsonb`, `security_definer = true`, authenticated execution enabled, anon/public execution disabled. The function additionally calls `cms_require_portfolio_admin()` before any settings write.

Check only publication visibility and link counts in the public projection:

```sql
select
  id,
  published_payload ->> 'visibility' as visibility,
  jsonb_object_length(coalesce(published_payload -> 'socialLinks', '{}'::jsonb)) as built_in_link_fields,
  jsonb_array_length(coalesce(published_payload -> 'customSocialLinks', '[]'::jsonb)) as custom_link_count
from public.portfolio_cms_public_settings
where id = 'main';
```

The result should have `visibility = true` and reflect the published link counts. The RPC's publication gate checks the storage/operator review state and projection integrity; a successful draft save alone does not publish. No migration is applied automatically by the frontend.

### Public CMS verification-generation migration

The public-read policies now use a private, singleton verification-generation row instead of invoking the full recursive CMS audit on every visitor query. The full audit reads five database dependencies: `portfolio_cms_records`, `portfolio_cms_public_records`, `portfolio_cms_settings`, `portfolio_cms_public_settings`, and the existence/public flags of the `portfolio-published` and `portfolio-private` Storage buckets. Relevant row changes to each dependency invalidate the generation; statement-level `TRUNCATE` triggers invalidate it as well. Deferred per-row checks lock the singleton and verify the final transaction state once per generation; subsequent checks return the cached result. Draft-only source edits and unrelated Storage bucket changes do not invalidate the generation because they do not affect the audit result.

The audit recursively validates the source and projection JSON payloads; it does not read `storage.objects`. Object changes continue to invalidate the separate operator Storage-content audit, not the database publication generation. Direct privileged row changes still fire the same invalidation triggers. A database owner can disable triggers or edit protected state directly and is therefore part of the trusted database boundary; do not do so. If a changed generation fails the audit, it remains unverified and public database reads fail closed. Privileged `TRUNCATE` invalidates the state but does not automatically reverify it.

Review and test `supabase/migrations/20261105120000_version_public_cms_verification.sql` only after `20261105100000_optimize_public_cms_audit_rls.sql` and `20261105103000_consolidate_public_storage_audit.sql` are confirmed applied. First test it in the verified disposable project and run `supabase/validation/08_publication_verification.sql`. For two-session concurrency coverage, follow steps 15–17 in `supabase/validation/README.md` and run the paired scripts from two distinct SQL Editor sessions. These tests are disposable-project-only; do not run them in production.

The migration intentionally invalidates the current generation. Immediately after applying it, public projection reads will return no rows until a trusted database owner verifies the generation. In the SQL Editor for the verified target, inspect the function owner and current SQL Editor role:

```sql
select
  current_user as sql_editor_role,
  pg_get_userbyid(p.proowner) as function_owner,
  has_function_privilege(current_user, p.oid, 'execute') as can_run_trusted_verification
from pg_proc p
where p.oid = 'public.cms_reverify_publication_generation()'::regprocedure;
```

Only continue if `can_run_trusted_verification` is true and the selected project is correct. Then execute:

```sql
select public.cms_reverify_publication_generation() as verified;
select public.cms_publication_generation_is_verified() as public_reads_enabled;
```

Both results must be `true`. If the first is `false`, do not edit the verification table or force a success marker; inspect and reconcile the existing published-data audit. If either call times out or errors, leave the generation unverified and investigate before allowing public reads. The verification table and reverify function are not executable/readable by anon or ordinary authenticated clients. Supported CMS mutations automatically invalidate and revalidate the state at transaction end; generation changes serialize through a row lock so an older check cannot verify a newer generation. A privileged `TRUNCATE` invalidates the state but does not auto-verify it; run the trusted SQL verification again after recovery.

The full audit is moved off public reads, not removed: publication eligibility and controlled Storage-review workflows still perform it. Consequently published mutations may take longer and roll back on a database error, while normal collection reads check the indexed singleton and the existing per-row visibility gate. This verification covers database projection eligibility and bucket flags; it does not replace the separate operator review of public Storage object contents or make public object URLs private.

The two earlier migrations may have been applied manually rather than recorded in Supabase's migration history. Do not run `supabase db push` until `supabase migration list` is reconciled with the actual production schema. Prefer the reviewed SQL Editor procedure above for the new migration unless the target and history are independently confirmed. If using CLI history repair, first verify the live definitions and mark each manually applied version as applied individually with `supabase migration repair <version> --status applied`; never mark a version applied based solely on a successful command.

Do not run the base CMS migration against a populated project as a repair shortcut. First inspect the target project's existing schema and migration state. If the CMS schema/RPCs already exist, preserve them; use only the reviewed additive workflow migration when catalog checks confirm its three audit RPCs are missing and its prerequisites are present:

`supabase/migrations/20261029120000_portfolio_storage_audit_workflow.sql`

Apply and validate database changes in a disposable test project first. The additive migration installs the trusted Storage inventory/review RPCs; it does not change bucket visibility, CMS data, Storage objects, policies, or invalidation triggers. Do not apply it to a hosted project until the project identity, function ownership, and existing bucket/object state have been independently confirmed.

The exact bucket IDs are distinct. `portfolio-private` must remain private; `portfolio-published` must be explicitly public under the approved project configuration. The underscore legacy bucket `portfolio_media` is a private source bucket. The hyphenated `portfolio-media` and dotted `portfolio-media.` buckets are distinct legacy dependencies; their objects and CMS references must be reconciled according to the migration's safety checks. Do not rename/delete buckets or objects, or make a bucket public to get past a readiness check.

Publishing has an additional trusted-operator gate. The health RPC can report the CMS API/database as connected while publication is blocked because the public bucket inventory has not been reviewed. An authorized operator signs in through Supabase Auth, uses **Storage review** in the admin UI to inspect the bucket configuration and every `portfolio-published` object (including unreferenced objects), and explicitly records the snapshot. The server verifies the administrator and derives `audited_by` from the authenticated identity. Public-bucket object changes invalidate the content audit; another review is then required before the next publish. Public objects remain directly accessible by URL while present in a public bucket; database RLS does not protect their URLs.

The admin health check separately verifies the authenticated CMS health RPC and access to list both required Storage buckets. A missing Storage audit blocks publish only; it must not be interpreted as the Content API or Storage being unconfigured. Draft saves and private uploads can proceed when their API/bucket access checks succeed. Actual writes, publication, Auth, and object promotion still require verification against the intended hosted test project before relying on them in production.

### Background documents and credentials

Education credential images and work-experience recommendation-letter images are optional nested asset references in the existing JSONB CMS records; no database-column migration is needed. The admin uploads them to `portfolio-private` through the authenticated administrator flow. Draft payloads persist the exact bucket-prefixed `storagePath`, not the short-lived signed URL; signed URLs are generated when private records are loaded. Credential and recommendation URLs are optional HTTP(S) links and remain separate from image uploads.

Publishing continues through the existing CMS publication RPC and audit gate. Referenced private images are promoted to `portfolio-published` as part of the existing asset-promotion workflow, making those objects directly accessible by URL once copied. Any public-bucket mutation invalidates the Storage content audit as before, so a trusted operator may need to review Storage again before the next publish. Unused private attachments are removed only after reference checks; failed saves retain current records and report cleanup failures.

## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix functions test
npm.cmd --prefix functions run lint
```

The root web package has no lint script or linter configured. The root tests cover local CMS behavior, schemas, Supabase CMS API/publishing behavior, and PDF validation. A local build cannot verify deployed Netlify environment variables, hosted Supabase Auth, database RPCs, Storage permissions, or live publishing; those require a real test-project workflow.

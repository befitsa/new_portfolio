# Fitsum Mesfin Portfolio & CMS

The public portfolio and admin CMS share the existing React/Vite application. The portfolio continues to read its existing published production content. Local CMS editing is available only through the Vite development server and stores records in JSON files and uploaded assets on disk. No local filesystem data is included in the production build.

## Local development

Install dependencies and start Vite:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the URL printed by Vite. The public portfolio is at `/`; the local CMS is at `/admin`. Local development authentication is intentionally Firebase-free and is only enabled in Vite development mode. Do not expose the development server to the public internet.

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

### Netlify build configuration

The active Supabase CMS requires these browser configuration variables:

- `VITE_SUPABASE_URL` — URL of the Supabase project intended for this Netlify site.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — that project's publishable (formerly anon) key.

`VITE_PUBLIC_PORTFOLIO_URL` supplies the public-site link shown in the admin dashboard. `VITE_CONTACT_API_URL` is optional and only configures the contact endpoint. `VITE_ADMIN_SUBDOMAIN` is only used by local/development routing. Values prefixed `VITE_` are embedded in browser code: use only public project configuration and never put service-role keys, database passwords, access tokens, or other secrets in them. A URL/key mismatch or missing variable requires correcting the Netlify site/environment build settings and rebuilding; do not post key values in tickets or chat.

After updating Netlify variables, verify the site context (production vs deploy preview) and rebuild the site so Vite embeds the intended values. The repository cannot verify Netlify settings or which Supabase project a deployed bundle targets. Firebase environment variables and `VITE_CMS_API_URL` described by older setup notes are not used by the current Supabase CMS provider.

### Database, administrator, and Storage prerequisites

Do not run the base CMS migration against a populated project as a repair shortcut. First inspect the target project's existing schema and migration state. If the CMS schema/RPCs already exist, preserve them; use only the reviewed additive workflow migration when catalog checks confirm its three audit RPCs are missing and its prerequisites are present:

`supabase/migrations/20261029120000_portfolio_storage_audit_workflow.sql`

Apply and validate database changes in a disposable test project first. The additive migration installs the trusted Storage inventory/review RPCs; it does not change bucket visibility, CMS data, Storage objects, policies, or invalidation triggers. Do not apply it to a hosted project until the project identity, function ownership, and existing bucket/object state have been independently confirmed.

The exact bucket IDs are distinct. `portfolio-private` must remain private; `portfolio-published` must be explicitly public under the approved project configuration. The underscore legacy bucket `portfolio_media` is a private source bucket. The hyphenated `portfolio-media` and dotted `portfolio-media.` buckets are distinct legacy dependencies; their objects and CMS references must be reconciled according to the migration's safety checks. Do not rename/delete buckets or objects, or make a bucket public to get past a readiness check.

Publishing has an additional trusted-operator gate. The health RPC can report the CMS API/database as connected while publication is blocked because the public bucket inventory has not been reviewed. An authorized operator signs in through Supabase Auth, uses **Storage review** in the admin UI to inspect the bucket configuration and every `portfolio-published` object (including unreferenced objects), and explicitly records the snapshot. The server verifies the administrator and derives `audited_by` from the authenticated identity. Public-bucket object changes invalidate the content audit; another review is then required before the next publish. Public objects remain directly accessible by URL while present in a public bucket; database RLS does not protect their URLs.

The admin health check separately verifies the authenticated CMS health RPC and access to list both required Storage buckets. A missing Storage audit blocks publish only; it must not be interpreted as the Content API or Storage being unconfigured. Draft saves and private uploads can proceed when their API/bucket access checks succeed. Actual writes, publication, Auth, and object promotion still require verification against the intended hosted test project before relying on them in production.
## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix functions test
npm.cmd --prefix functions run lint
```

The root web package has no lint script or linter configured. The root tests cover local CMS behavior, schemas, Supabase CMS API/publishing behavior, and PDF validation. A local build cannot verify deployed Netlify environment variables, hosted Supabase Auth, database RPCs, Storage permissions, or live publishing; those require a real test-project workflow.

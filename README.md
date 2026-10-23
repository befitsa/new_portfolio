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

Local CRUD, drafts, publishing, and public reads use the same provider-facing CMS API as the eventual Firebase adapter. Public development pages read only published, visible local records. Local publishing never changes production content. The development API and its uploaded files accept loopback requests only.

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

## Production behavior

The Netlify-to-Cloudflare CMS proxy has been removed. Production admin sign-in still uses the existing Firebase Auth configuration and existing authorization checks. No persistent CMS provider is wired into the Netlify frontend, so the deployed admin displays a clear “Production CMS not configured” message after login; CMS reads and writes are disabled and the application does not make CMS proxy requests. This does not change production portfolio content or Firebase configuration.

The existing `functions/` Firebase backend source is retained but is not routed by Netlify and still contains its previous Cloudflare Access assertion check. It is not needed for local development and is not an active production CMS provider in this setup. Before reusing it in a future Firebase migration, replace that legacy proxy-specific gate with a deliberately configured secure Firebase API design and test authorization end to end.

The Vite filesystem CMS is not a production storage provider. Netlify's deployed site and function filesystems are not durable writable storage. Local edits and uploads never appear on Netlify.

## Future persistent publishing

To edit the live portfolio without pushing to GitHub, implement and configure a secure persistent provider (planned: Firebase/Firestore plus Cloud Storage) behind the existing CMS service interface. It must verify the existing administrator identity on every write, validate records and uploads server-side, preserve draft/published separation, and store uploads in durable object storage. Migrate existing production records and media with a verified backup before enabling writes. Then add deployment configuration and provider selection only after testing it; do not copy `.local-cms` to Netlify as a database.

The existing public portfolio/content Firebase configuration and Firebase sign-in are not changed by this local CMS setup. No Firebase backend has been enabled or deployed as part of the local CMS work.

## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix functions test
npm.cmd --prefix functions run lint
```

The root web package has no lint script or linter configured. The Functions `lint` script runs a Node syntax check. The root and Functions test commands cover the local CMS, schemas, content service, backend authorization, health checks, and PDF validation. A successful production build does not verify live Netlify CMS availability.

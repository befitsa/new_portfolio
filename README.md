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

Production CMS writes are enabled when the site is deployed with the existing Firebase portfolio configuration and the separate admin Firebase web API key. In that configuration, the admin dashboard uses the Firebase Firestore + Cloud Storage adapter behind the same CMS service interface. If the required Firebase environment variables are missing or the admin sign-in app is not configured, the deployed admin shows the “Production CMS not configured” message and disables live writes instead of silently failing.

The Netlify-to-Cloudflare CMS proxy has been removed. Production admin sign-in still uses the existing Firebase Auth configuration and current authorization checks. The Vite filesystem CMS remains a local-only development tool and is not used as a production storage provider. Netlify's deployed function filesystems are not durable writable storage, so local `.local-cms` data never appears on the live site.

The existing `functions/` Firebase backend source is retained for future use, but it is not the active production CMS path in this project unless deliberately re-enabled and configured. If it is reused, replace the legacy Cloudflare Access gate with a secure Firebase-backed design and test authorization end to end before exposing it publicly.

## Future persistent publishing

To edit the live portfolio without pushing to GitHub, configure the Firebase Firestore + Cloud Storage provider behind the existing CMS service interface. It must verify the existing administrator identity on every write, validate records and uploads server-side, preserve draft/published separation, and store uploads in durable object storage. Migrate existing production records and media with a verified backup before enabling writes. Do not copy `.local-cms` to Netlify as a database.

The existing public portfolio/content Firebase configuration and Firebase sign-in are not changed by the local filesystem CMS. The production adapter is only enabled when the required Firebase environment variables are set in the deployed app.

## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix functions test
npm.cmd --prefix functions run lint
```

The root web package has no lint script or linter configured. The Functions `lint` script runs a Node syntax check. The root and Functions test commands cover the local CMS, schemas, content service, backend authorization, health checks, and PDF validation. A successful production build does not verify live Netlify CMS availability.

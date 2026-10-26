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

Production admin requests use the existing Firebase Function API. The Function verifies the Firebase ID token against the `user-auth-vp` Authentication project and checks the server-side administrator UID before it reads drafts or performs writes. The Function validates content and upload bytes, then stores draft and published records in Firestore and persistent files in Cloud Storage. The browser does not write directly to Firestore or Storage.

The public portfolio subscribes to visible published Firestore records, so publish and unpublish changes arrive through Firebase's live listeners without a GitHub push or a Netlify build. Draft records are private. Resume uploads and project-editor images remain in private storage until publication; a successful publish promotes their files and updates the published record. The local Vite filesystem CMS remains separate and is not used in production.

### One-time production setup

1. In the Firebase project used for portfolio content, enable Firestore and Cloud Storage, and deploy the existing restrictive rules and indexes. Deploy the `cmsApi` Function to that same project. Its service account needs Firestore access and Cloud Storage object create, read, and delete access.
2. Create `functions/.env.<content-project-id>` with `CMS_ALLOWED_ORIGINS=https://testportfolios01.netlify.app`. Set a comma-separated list if the site has more than one production origin. `CMS_FUNCTION_REGION` is optional and defaults to `us-central1`.
3. In Netlify, set the portfolio web app values `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`. The project ID and bucket must match the Firebase project and bucket used by the Function.
4. Keep `VITE_ADMIN_FIREBASE_API_KEY` pointed at the existing `user-auth-vp` web app, and set `VITE_CMS_API_URL` to the deployed Function root, for example `https://us-central1-<content-project-id>.cloudfunctions.net/cmsApi` (omit `/api`). Do not put service account credentials in Netlify `VITE_` variables.
5. Deploy the Function and the initial Netlify build, then sign in to `/admin`. The dashboard health check verifies administrator access, Firestore access, Storage read/write access, and the allowed production origin before it enables writes.

Example deployment from the repository root:

```powershell
firebase deploy --only functions:cmsApi --project <content-project-id>
```

Changing code or Netlify build variables requires one deployment. Publishing records after that writes to Firestore and Storage directly and does not trigger another build.
## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix functions test
npm.cmd --prefix functions run lint
```

The root web package has no lint script or linter configured. The Functions `lint` script runs a Node syntax check. The root and Functions tests cover local CMS behavior, schemas, Firebase rules, backend authorization, health reporting, and PDF validation. A local build cannot verify production Firebase credentials, deployed Function access, or Netlify publishing; those require the one-time dashboard setup above.

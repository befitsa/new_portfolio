# Fitsum Mesfin Portfolio & CMS

The project serves the existing public portfolio and its editorial CMS from one Vite/React codebase. In development, `/` remains the portfolio and `/admin` opens the CMS. Development edits use shared browser storage; production content continues to use the existing Firestore and protected CMS API integration.

## Development

Install the existing web dependencies and start Vite:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the Vite URL shown in the terminal. The public site is at `/` and the admin dashboard is at `/admin` on that same server. In this checkout, the verified URLs are `http://127.0.0.1:5175/` and `http://127.0.0.1:5175/admin`.

Development content mode does not require the CMS API or Cloudflare. Text records are saved in browser local storage, and uploaded images and resume PDFs are stored as binary files in IndexedDB. Publishing updates only the local public preview in that browser; it does not publish to the live website. Admin pages still require Firebase Authentication and the authorized administrator UID; there is no local authentication bypass. Configure the existing Firebase web app values and sign in with the administrator account, or use the Auth emulator. A new local copy starts with no projects, education, or experience entries. Existing browser copies remove the former built-in project slots and education records when they are read; old temporary object URL previews cannot be recovered, so upload those files again.

### Optional backend emulator testing

The following setup is only needed when testing the existing Firebase adapter locally:

```powershell
firebase emulators:start --project demo-fitsum-portfolio --only auth,firestore,storage,functions
```

In a second terminal, configure the web Firebase values and Function dependencies. Set `VITE_USE_FIREBASE_EMULATORS=true` and `VITE_CMS_API_URL=http://127.0.0.1:5001/demo-fitsum-portfolio/us-central1/cmsApi/api`. Copy `functions/.env.example` to `functions/.env.demo-fitsum-portfolio` and set `CMS_ALLOW_LOCAL_EMULATOR=true` there only for the local Functions emulator. That bypass is gated on emulator mode and a localhost origin; it does not work in a deployed function. The Auth emulator account used to enter the CMS must have the administrator UID below. Do not use emulator data for a production project.

## CMS pages

- `/admin` — CMS overview, pending projects, resume and media status, and recent content.
- `/admin/background` — create, edit, reorder, preview, publish, and unpublish work and education records.
- `/admin/projects` — search and filter the project registry; edit, reorder, publish, and unpublish.
- `/admin/projects/new` and `/admin/projects/:id` — project identity, case study, metrics, links, SEO, hero and gallery images, Markdown editing and preview, draft preview, save, and publish.
- `/admin/resume` — upload validated PDF versions, preview/download them, activate a version, restore an earlier one, and hide the active version.
- `/admin/media` — upload and reference images, replace image files, inspect usage, search, copy URLs, and safely remove unused assets.
- `/admin/settings` — edit and publish public profile and SEO settings.

Draft edits write only to `drafts/...`. A publish request validates the draft on the server, writes the public copy atomically, updates its revision and publishing metadata, and then returns success. Public pages subscribe only to `published/...` records whose `status` is `published` and `visibility` is `true`. Resume publication turns off any other active version in the same Firestore transaction. An unpublished resume stays suppressed once CMS resume management has been enabled. The public download uses the filename `Fitsum-Mesfin-Resume.pdf` and is available only for an active, visible published PDF record.

### Resume storage availability

The remote upload path uses Cloud Storage through the protected Firebase Function and validates PDF structure before accepting a draft. The local development workflow previews and publishes a valid PDF only inside the current browser with IndexedDB; it never claims that local content reached the live site. On the current Firebase Spark project, the Cloud Storage upload path is unavailable, so production resume uploads and live download changes need the existing remote storage service to be eligible and configured. This project update does not upgrade billing, create storage resources, or deploy anything.

## Security design

The admin login uses a separate named Firebase Auth app for project `user-auth-vp`; it does not replace the existing portfolio/content Firebase app configured by `VITE_FIREBASE_*`. The app's registered web configuration was retrieved from Firebase and its project ID, project number, auth domain, storage bucket, and app ID match the supplied values. The public web API key is saved only in the ignored local `.env.local` as `VITE_ADMIN_FIREBASE_API_KEY`. Its `Username` field accepts the admin account's registered Firebase email; no username mapping or password database is used, and there is no registration flow.

The UI restores sessions through Firebase's auth-state listener and permits only UID `0SYXtQtU61hMim2S9a2aktAeeSA2`. The authenticated Firebase token is verified by a separately named Admin SDK app configured for `user-auth-vp`, rather than the Functions/content project. Before any CMS health check, read, or mutation, `functions/index.js` independently validates the Cloudflare Access JWT (signature, issuer, expiry, and audience), verifies the Firebase ID token with revocation checking enabled, and requires that exact UID. Firestore and Storage client rules continue to deny all browser writes and draft reads; public reads remain governed by the existing published-content rules. The Worker forwards the Access assertion and Firebase ID token to the Function. Firebase Admin credentials remain in the Function runtime and never enter Vite variables.

Firebase CLI access confirms that the `user-auth-vp` project and the specified registered web app exist, and that the app configuration matches the supplied project details. The available local credentials do not permit a Firebase Auth user lookup, so membership of UID `0SYXtQtU61hMim2S9a2aktAeeSA2` in that project is not independently verified yet. In Firebase Console, enable the Email/Password provider, add the admin hostname to Authentication's authorized domains, and confirm the existing admin account's UID is exactly the value above. Enter that account's registered email in the login form's `Username` field. Do not create a public signup flow or put passwords in source code. Configure Cloudflare Zero Trust with a self-hosted Access application and an allow policy for the administrator. Protect the admin `/api/*` route or the CMS Worker itself. The public portfolio hostname should not share this Access policy.

Because the CMS Function may run in the portfolio/content Firebase project while Auth lives in `user-auth-vp`, grant the deployed Function service identity permission to verify Auth users in the `user-auth-vp` project (including `firebaseauth.users.get` for revocation checking). Use the narrowest applicable Firebase Authentication IAM role. Do not add the Auth service account key to the frontend or repository.

### Netlify production CMS API route

The production frontend calls the same-origin `/api/*` route. `public/_redirects` sends those requests to `netlify/functions/cms-api.mjs` before the general SPA fallback; the function relays only the CMS API path to the existing Cloudflare Access-protected Worker. It does not write content itself, hold Firebase Admin credentials, or accept arbitrary upstream URLs. The Worker and Firebase Function continue to validate Cloudflare Access and the Firebase administrator UID.

In Netlify site settings, configure these as **private runtime environment variables for Functions**:

- `CMS_WORKER_URL` — the actual HTTPS origin of the existing Cloudflare Worker route, with no path (for example, `https://cms-api.your-owned-domain.example`; replace this with the real configured hostname).
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` — credentials for a Cloudflare Access service token. In Zero Trust, add a **Service Auth** policy for this token to the Access application covering the Worker’s `/api/*` route. Keep the existing human administrator policy as well.

Do not set `VITE_CMS_API_URL` in the Netlify production build; the production client uses the same-origin Netlify function. The API key exposed as `VITE_ADMIN_FIREBASE_API_KEY` is a Firebase web-app identifier, not a server secret. Keep Firebase Admin credentials, Cloudflare service-token secrets, and any storage credentials out of all `VITE_` variables.

The Netlify function forwards the browser's Firebase ID token and the original site origin, then expects a JSON API envelope from the Worker. The Worker’s `CMS_BACKEND_URL` must point at the already deployed Firebase HTTPS Function. The Firebase Function environment must include `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `CMS_ALLOWED_ORIGINS=https://testportfolios01.netlify.app` (plus any other exact site origins actually used). Do not add a made-up Worker or Function URL: obtain both from the deployed Cloudflare and Firebase consoles. If these services or the Access service-token policy are not configured, the proxy returns a JSON configuration/upstream error instead of the SPA HTML shell.

The CMS health endpoint requires an authenticated administrator token; a direct unauthenticated request to `/api/health` should return a JSON `401`, not the SPA page. After admin sign-in, the health check verifies the Firebase administrator identity, Cloudflare Access, a Firestore read, Cloud Storage bucket access, object create/get/delete permissions, and signed-URL generation. Firestore failures mark the CMS unavailable. If storage checks fail, content editing remains available but image, media import, and resume upload actions are blocked with the reported storage readiness reason.

The CMS uploads directly to the existing content project's default Cloud Storage bucket using short-lived signed URLs issued by the Firebase Function. Configure that bucket's CORS to allow `https://testportfolios01.netlify.app` for signed `PUT` uploads and `GET` downloads (and any separate admin origin if used). The bucket belongs to the portfolio/content Firebase project, not the separate Auth project. Cloud Storage must be enabled and the project must have a billing plan that permits its use; the Function identity needs the necessary object permissions and `iam.serviceAccounts.signBlob` for signed URLs. Apply the lifecycle policy in `storage-lifecycle.json.example` to delete abandoned objects under `cms-incoming/` after one day, for example with `gcloud storage buckets update gs://<actual-content-bucket> --lifecycle-file=storage-lifecycle.json` after copying the example. Do not make the bucket writable to browser clients.

### Cloudflare and Firebase setup

1. Create the Firebase project, Firestore database, and default Storage bucket. Deploy Firestore/Storage rules and indexes with `firebase deploy --only firestore,storage`.
2. Copy `functions/.env.example` to `functions/.env.<firebase-project-id>`. Set `CF_ACCESS_TEAM_DOMAIN` (for example `your-team.cloudflareaccess.com`), `CF_ACCESS_AUD` from the Access app, and the exact admin origin in `CMS_ALLOWED_ORIGINS`. Deploy the Function with `firebase deploy --only functions:cmsApi`.
3. Copy `cloudflare/wrangler.toml.example` to `cloudflare/wrangler.toml`. Replace the admin route, zone name, and `CMS_BACKEND_URL` with the deployed `cmsApi` HTTPS URL. From the `cloudflare` directory, deploy with `npx wrangler deploy`.
4. In Cloudflare Zero Trust, create an Access application covering the Worker `/api/*` route. Add the administrator policy and a Service Auth policy for the Netlify-held service token. Confirm the Worker receives `Cf-Access-Jwt-Assertion`. Configure the app's audience tag in the Function environment.
5. Set `CMS_WORKER_URL`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET` in Netlify's private Function environment; set `CMS_ALLOWED_ORIGINS` in the Firebase Function environment to the deployed Netlify origin. Keep the Netlify production branch set to the intended repository branch.
6. Configure bucket CORS using `cloudflare/storage-cors.json.example`, replacing or extending its origin with the actual Netlify production origin (and any separate admin origin), so the browser can upload to short-lived signed Storage URLs. For example use `gcloud storage buckets update gs://<bucket-name> --cors-file=storage-cors.json` after copying and editing that file. Apply `storage-lifecycle.json.example` as the bucket lifecycle policy to clean up unfinalized uploads.
7. Keep `VITE_FIREBASE_*` pointed at the existing portfolio/content project. The separate admin Auth web app metadata is fixed to the verified `user-auth-vp` app; set `VITE_ADMIN_FIREBASE_API_KEY` in ignored `.env.local` to that registered app's Web API key. The local checkout has this value from Firebase's SDK config command; do not commit `.env.local`. Set `VITE_PUBLIC_PORTFOLIO_URL` if the public website is not on the hostname inferred from the admin hostname.

For GitHub-connected Netlify deployment, `netlify.toml` sets the build command and publish directory to `npm run build` and `dist`. Verify the production branch in Netlify, then push the committed change to that branch and wait for its deploy to finish. This checkout currently has local branch `main` tracking `origin/main`; the Netlify dashboard's configured production branch cannot be verified from repository files.

Function environment values are loaded from Firebase-supported dotenv files under `functions/`. Keep project-specific `.env.*` files out of source control. The Function uses the Google runtime's default service identity; grant it the Firebase/Firestore and bucket permissions required by the Admin SDK. V4 upload URL signing also needs `iam.serviceAccounts.signBlob`; when the runtime uses its attached service identity, grant that identity `roles/iam.serviceAccountTokenCreator` on itself. No service-account JSON is required in the browser or repository.

### Image handling

Local JPEG, PNG, and WebP uploads are initiated with a ten-minute, single-object signed URL; the Function finalizer enforces the 12 MB limit, checks content signature, and reads dimensions before moving the file into managed storage. Resume PDFs have a 5 MB limit and are checked for a PDF header, objects, EOF marker, and cross-reference target before they become drafts. Stored resume files use an attachment filename for public downloads and an inline response for the admin preview. URL imports run on the Function, resolve public addresses, reject private/internal targets, re-check every redirect, require HTTPS to remain HTTPS after redirects, cap redirects/time and bytes, validate MIME and file signature, inspect image dimensions, and store the copied file. Original external source URLs are saved for reference. Imported content must be used with permission.

Media deletion scans project, background, resume, and settings records and is denied when saved content references the asset. Firebase per-object download tokens are public bearer URLs for intentionally public portfolio assets; keep draft metadata private in Firestore and never store secrets in content records.

## Checks

```powershell
npm.cmd run build
npm.cmd test
npm.cmd --prefix functions test
npm.cmd --prefix functions run lint
npm.cmd run test:rules
node --check functions/index.js
node --check netlify/functions/cms-api.mjs
node --check cloudflare/worker.js
```

`test:rules` needs Java and the Firebase CLI/emulators. The tests assert that anonymous and Firebase-authenticated web clients cannot access drafts or write content, while public reads remain limited to visible published records. A production deployment still needs the real Cloudflare Access app, Firebase Email/Password provider and existing administrator account, Firebase project/bucket, Function environment, domain route, and bucket CORS configuration; this repository alone cannot verify those account settings.

The public portfolio is client-rendered by Vite. Its titles and meta descriptions are updated client-side; crawlers that do not execute JavaScript will not receive fully server-rendered per-project metadata.

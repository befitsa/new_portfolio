# Fitsum Mesfin Portfolio

The repository contains the React/Vite public portfolio and a protected Portfolio Admin Dashboard. Cloudflare Pages serves both the site and its API. Published content is read from D1; uploaded images and resumes are stored in a private R2 bucket. Publishing does not require a Git commit or frontend redeployment.

## Production architecture

- Firebase Authentication issues administrator ID tokens. The Pages Function verifies Google's token signature, Firebase project, expiry, and the server-side `CMS_ADMIN_UIDS` allowlist.
- Cloudflare D1 stores draft and published snapshots in `content_records`. Every write checks the record revision to avoid silently overwriting concurrent edits.
- Cloudflare R2 stores uploads privately. The API validates file type, file signature, and size before storing them. Short-lived HMAC-signed media URLs are returned for previews and published files.
- `/api/*` is handled by `functions/api/[[path]].js`; `public/_routes.json` excludes these routes from the static-site SPA fallback.
- No Netlify, Firestore, Cloudinary, browser storage, or deployed filesystem is used by the Cloudflare Pages API.

## Required Cloudflare resources

Create these resources in the same Cloudflare account as the Pages project:

1. A D1 database (for example, `portfolio-content`).
2. A private R2 bucket (for example, `portfolio-media`). Do not enable public bucket access.
3. Apply [`cloudflare/schema.sql`](./cloudflare/schema.sql) to the D1 database using its dashboard SQL console or `wrangler d1 execute <database-name> --remote --file=cloudflare/schema.sql`.
4. In **Workers & Pages → your Pages project → Settings → Functions → Bindings**, add:
   - D1 database binding **`DB`** pointing to the created database.
   - R2 bucket binding **`MEDIA`** pointing to the private bucket.
5. In **Settings → Variables and Secrets**, configure these for the production environment:
   - `FIREBASE_PROJECT_ID` (plain-text variable): `user-auth-vp`.
   - `FIREBASE_WEB_API_KEY` (plain-text variable): the public web API key for the existing Firebase Auth app. The server uses Firebase account lookup to reject disabled and revoked admin sessions; this key is not a secret.
   - `CMS_ADMIN_UIDS` (plain-text variable): comma-separated Firebase Auth UIDs allowed to edit the portfolio.
   - `MEDIA_SIGNING_SECRET` (secret): at least 32 random bytes. Generate it locally with a password manager or cryptographically secure generator; never commit it or use a `VITE_` prefix.
   - `VITE_ADMIN_FIREBASE_API_KEY` (build-time variable): the public web API key for the existing Firebase Auth app.
   - `VITE_ADMIN_UIDS` (build-time variable): mirror the allowed UID list used by the server.
   - Optional `VITE_PUBLIC_PORTFOLIO_URL`: set only if the public portfolio lives on a different URL; by default the dashboard opens the same Pages origin.
6. In Firebase Authentication, add the Cloudflare Pages production hostname and custom domain to **Authorized domains**. Confirm Email/Password sign-in is enabled if used by the current admin sign-in page.
7. Redeploy Pages after adding bindings or build variables. Bindings configured only after a deployment are not available to that deployment.

The D1 binding, R2 binding, Firebase project ID and web API key, administrator allowlist, and media signing secret are runtime requirements. `/api/health` reports `ready: false` until they are all present and the D1/R2 bindings respond. The Firebase web API key is public client configuration; no Firebase service-account key or Cloudinary secret is needed.

For `FIREBASE_WEB_API_KEY`, use an API key that can call Firebase Identity Toolkit from the Pages Function. Restrict its allowed APIs to Identity Toolkit; HTTP-referrer-only restrictions can block server-side account verification.

## Deployment

Set the Cloudflare Pages build command to `npm run build` and the output directory to `dist`, then deploy the repository. The Pages Function and `_routes.json` are part of the deployment. After deploy:

1. Open `https://<production-host>/api/health`. It must return HTTP 200 JSON with `{"data":{"ready":true}}`.
2. Sign into `/admin` using an allowlisted Firebase account.
3. Verify a draft save, publish, unpublish, project image upload, resume PDF upload, and public portfolio content read. Confirm the records appear in D1 and uploaded objects appear in R2.
4. Check `/api/health` after changing environment variables or bindings; deploy again if Pages has not picked up the new configuration.

For local validation, run `npm test` and `npm run build`. To run the Pages Function locally against Cloudflare resources, use the Cloudflare Wrangler CLI with a Pages project configuration and local secrets; never put production signing secrets in the repository.

## Admin behavior and limits

The API persists draft and published snapshots separately. Unpublishing removes the public snapshot but keeps the draft available for editing. Project, Experience, Education, Resume, and site settings records use the same API and storage. Image files are limited to 8 MB; resume PDFs are limited to 5 MB and structurally validated before storage. Published content APIs return published snapshots only.

This D1/R2 API starts with an empty database and bucket. It does not automatically import any existing Firestore records or Cloudinary files. If the existing Firestore project contains portfolio content, export and migrate that content and its media before switching the live site to this API; do not delete or disable the old backend until that migration is verified.

Production operations cannot be confirmed by a local build. Configure the Cloudflare resources and Firebase host allowlist above, migrate any existing content, deploy the Pages project, and perform the production checks before treating the CMS as live.

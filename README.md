# Fitsum Mesfin Portfolio

This repository contains the public React/Vite portfolio and its admin publishing app. Publishing writes to Firestore through Netlify Functions, so normal portfolio content updates do not require a frontend build or redeploy.

## Architecture

- React + Vite public site, with the existing project cards, project detail page, navigation, animations, and responsive section layouts.
- Firebase Authentication from the existing `user-auth-vp` web app for admin sign-in.
- Netlify Functions verify Firebase ID tokens and the administrator UID allowlist before reading private drafts or changing content.
- Firestore stores draft and published snapshots in `portfolioContent/{type}/items/{id}`. The browser has no Firestore or Firebase Storage access.
- Cloudinary signed uploads use `authenticated` delivery. Draft media is available only to an authorized admin. Public API routes issue short lived Cloudinary download links only after confirming the item is still published.

The project does not use Firebase Cloud Functions or Firebase Storage. Firestore is available on Firebase's Spark plan within its no-cost quota; exceeding a quota can pause reads or writes until the quota resets. No billing upgrade is required by this design.

## Local development

Install the web dependencies, create `.env` from `.env.example`, and set the Firebase web API key plus server credentials. Then run the Netlify development server so its API rewrites and Functions are available:

```powershell
npm.cmd install
npm.cmd run dev:netlify
```

Open the local URL printed by Netlify Dev and go to `/admin`. Firebase Authentication must have Email/Password enabled and the local hostname added to its authorized domains. The admin still signs in with the real administrator account during local work; there is no local bypass or filesystem CMS.

`npm.cmd run dev` starts Vite alone and is useful for front-end styling, but API calls require `npm.cmd run dev:netlify`.

## Netlify environment variables

Set the following variables in Netlify under **Project configuration → Environment variables**. The template contains names only; do not commit `.env` or credentials.

| Variable | Purpose |
| --- | --- |
| `VITE_ADMIN_FIREBASE_API_KEY` | Public web API key for the registered admin Auth app in `user-auth-vp`. |
| `VITE_ADMIN_UIDS` | Optional comma separated UIDs allowed by the frontend route guard; mirror the same list in `CMS_ADMIN_UIDS`. |
| `FIREBASE_PROJECT_ID` | Must be `user-auth-vp`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON service-account credential for `user-auth-vp`, used by Netlify Functions only. Grant the service account Firestore access. |
| `CMS_ADMIN_UIDS` | Comma separated Firebase Auth UIDs allowed to manage content. Defaults in server code to the existing admin UID. |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name. |
| `CLOUDINARY_API_KEY` | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret, server side only. |
| `ALLOWED_ORIGINS` | Optional comma separated list for production, preview, and custom-domain origins that may issue protected writes. Netlify's site URLs are also accepted. |

The public Firebase API key is not a server secret. The service-account JSON and Cloudinary API secret are private and must never use a `VITE_` prefix.

## One time Firebase and Cloudinary setup

1. In `user-auth-vp`, enable Firestore and verify the project remains on Spark. Create or select the registered web app used by the existing admin Auth flow, then set its web API key in Netlify.
2. Create a service account for `user-auth-vp`, grant it a Firestore role that can read and write the portfolio database, and add its JSON to Netlify as `FIREBASE_SERVICE_ACCOUNT_JSON`. Do not deploy Firebase Functions or configure Firebase Storage.
3. Deploy the included Firestore rules to `user-auth-vp`. They deny all browser reads and writes; the server-side Firebase Admin SDK is the only database path.
4. Create a Cloudinary account and add its cloud name, API key, and API secret to Netlify. In Cloudinary **Product environment settings → Security**, enable **Allow delivery of PDF and ZIP files** for free-plan PDF resumes. PDF delivery is blocked by default on free accounts; enabling this setting permits it without a paid plan. Uploads use authenticated media and signed, expiring download URLs; this implementation does not use Cloudinary's premium token or cookie authentication.
5. In Firebase Authentication, authorize the production Netlify hostname and any custom domain. In Netlify, set `CMS_ADMIN_UIDS` if the existing admin UID changes. Add extra deploy-preview origins to `ALLOWED_ORIGINS` if needed.
6. Deploy to Netlify. The build remains `npm run build` and the publish directory remains `dist`. Netlify Functions are configured in `netlify/functions`; `/api/*` routes to the Functions API.

The health status in `/admin` requires both Firestore and Cloudinary runtime variables. A successful local build cannot confirm that dashboard secrets, Firebase Auth settings, Firestore access, Cloudinary PDF delivery, or Netlify deployment are configured.

Cloudinary currently offers a free tier with 25 monthly credits and no required credit card. Monitor usage because temporary private download links are not CDN-cached and Cloudinary documents that this delivery method can use twice the bandwidth. The signed media flow is chosen so an unpublish removes media from the public API and short-lived links expire.

## Legacy content migration

The old CMS kept content in Firestore rather than in the checked-in JavaScript arrays. `scripts/migrate-legacy-cms.mjs` copies legacy `drafts/{type}/items` and `published/{type}/items` from the old content project into the new `user-auth-vp` model. It is a dry run by default and never modifies the source project. Existing published external media URLs are preserved; new uploads use Cloudinary.

Set `LEGACY_FIREBASE_SERVICE_ACCOUNT_JSON` to the old content project's service-account JSON and `FIREBASE_SERVICE_ACCOUNT_JSON` to the destination `user-auth-vp` service-account JSON in the local shell. First inspect the dry-run report:

```powershell
node scripts/migrate-legacy-cms.mjs
```

After confirming the record counts and any skipped validation entries, copy the content with:

```powershell
node scripts/migrate-legacy-cms.mjs --apply
```

Legacy project slots named `project-01`, `project-02`, etc. are excluded as placeholders. The script does not copy Firebase Storage objects; existing published media URLs remain in the published snapshots, and new or replaced media can be uploaded through the admin. Keep the old Firestore project and its export until the new public site has been checked.

## Admin workflow

Visit `/admin` and sign in with the authorized Firebase administrator. The dashboard provides:

- **Experience & Background** for professional experience and education.
- **Projects** for project listings, case-study content, links, images, galleries, and ordering.
- **Resume** for private PDF drafts and the active public download.
- **Settings** for profile details and social links.

Save Draft never changes the public snapshot. Preview uses the public project detail component or the corresponding public section presentation. Publish explicitly copies the saved draft to the public version. Editing an already published record leaves its current public snapshot in place until the next publish. Unpublish removes it from the public API; delete requires confirmation.

## Validation

```powershell
npm.cmd test
npm.cmd run build
```

The tests cover content validation, PDF structure checks, and API authorization boundaries. Use the local Netlify Dev server to exercise real authenticated writes after supplying the runtime credentials.

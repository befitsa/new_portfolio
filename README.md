# Fitsum Mesfin Portfolio

This repository contains the React/Vite portfolio and a protected Portfolio Admin Dashboard. The current content editor is a **local development tool**: it saves drafts, published records, and uploaded files on the machine running Vite. Publishing here updates only that machine's local portfolio preview; it does not change the hosted website or any production database.

## Run locally

1. Use Node.js 20 or newer and install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set `VITE_ADMIN_FIREBASE_API_KEY` to the public Web API key for the existing Firebase Auth project `user-auth-vp`. Keep `.env.local` out of version control.
3. Run `npm run dev`. Vite listens on port `5173`; open `/admin` to sign in and use the dashboard.
4. Run `npm test` and `npm run build` to validate the project.

Firebase Email/Password authentication is used for administrator login. The frontend checks the signed-in UID against `VITE_ADMIN_UIDS`; the local API independently verifies the Firebase ID-token signature, project, expiry, and allowlisted UID before accepting admin writes. If `VITE_ADMIN_UIDS` is unset, the existing administrator UID is used. Do not put passwords or service-account credentials in `.env.local`.

The local API is registered only with the Vite development server and accepts requests from the local machine. Public routes expose only published records. Admin writes require an authenticated allowlisted Firebase user. The server validates structured content, file type and bytes, and protects draft updates with revision checks.

## Local data and uploads

- Structured content is stored in `.local-cms/content.json`.
- Uploaded images, PDF resumes, and experience cover letters are stored in `.local-cms/uploads/`.
- The local CMS creates the data file on first use and preserves existing local content. Keep `.local-cms/` backed up if you need to retain local edits; it is ignored by Git.
- Drafts stay hidden from the local public preview until published. Unpublishing hides the public snapshot but preserves the record for later editing.
- Image uploads from the dashboard accept JPEG, PNG, and WebP files up to 8 MB. Resume uploads and experience cover letters accept structurally valid PDFs up to 5 MB. Cover letter metadata is saved on the experience draft and copied into its public snapshot only when that experience is published.

## Production and existing content

The file-backed provider is intentionally not used in production. A production Vite build does not include the local API server, and the admin client refuses to send CMS writes outside development. Do not interpret a successful local save or publish as a live-site update; the hosted portfolio requires a separately configured persistent production content provider before live editing can be enabled.

Cover letter uploads currently use the local disk provider, so they preview and publish only in the local development site. No production upload or publishing environment variables are configured; live cover letters require a persistent production content API and file storage binding before deployment.

Existing Firestore/Cloudinary or previously deployed Cloudflare content is not imported, overwritten, or deleted by this local provider. `.local-cms/content.json` was preserved during this change; its current collections are empty. Production data remains in its existing provider and requires a separately planned, access-authorized migration before changing the production read/write source.

The local Vite server continues to use the project's current port, `5173`. It has no production storage bindings or deployment secrets to configure.

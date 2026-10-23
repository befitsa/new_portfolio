# Local CMS files

`npm run dev` uses the local filesystem provider by default. At runtime it creates:

- `.local-cms/content.json` — drafts, published records, site settings, and publication metadata.
- `.local-cms/uploads/` — project images, media files, and resume PDFs.

The runtime directory is ignored by Git and is not part of a Vite production build. The tracked `content.example.json` documents the initial JSON shape; the Vite server initializes the runtime file from the existing profile data and empty content collections when none exists.

The development API is served only by Vite, bound to loopback requests, and is not a production backend. Back up `.local-cms` yourself if these development records matter.

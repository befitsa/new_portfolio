CREATE TABLE IF NOT EXISTS content_records (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('projects', 'experiences', 'education', 'resumes', 'settings')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'deleted')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  published_revision INTEGER NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
  draft_data TEXT NOT NULL CHECK (json_valid(draft_data)),
  published_data TEXT CHECK (published_data IS NULL OR json_valid(published_data)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  author_id TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  project_slug TEXT,
  published_slug TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS content_records_project_slug_unique
  ON content_records (project_slug)
  WHERE project_slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS content_records_published_slug_unique
  ON content_records (published_slug)
  WHERE published_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_records_type_status
  ON content_records (type, status);

CREATE INDEX IF NOT EXISTS content_records_published_order
  ON content_records (type, status, published_at);

# Hosted Supabase migration validation (review-only)

These are disposable-project validation scripts, not migrations. No script or
migration in this workflow has been executed against a hosted database.

## Mandatory target-project check

The only permitted hosted target is the disposable project named
**`portfolio-cms-test`**, with project ref **`ifakxmugmdcjyhytzpwx`** and URL
`https://ifakxmugmdcjyhytzpwx.supabase.co`. Never run this workflow against
production project `bupageguxdvphaebvdoa`.

**Before every individual SQL execution**, verify in the Supabase Dashboard
that the project name is exactly `portfolio-cms-test`, the Dashboard URL
contains ref `ifakxmugmdcjyhytzpwx`, and **Project Settings > General** shows
the same ref. If any value is unavailable, differs, or is ambiguous, stop.
A SQL script cannot independently prove which Dashboard project the operator
intended to select or authenticate the active SQL Editor project. Each
executable script has the expected ref as a fixed marker and scripts after
setup also check a marker row; these only catch script/setup mismatches and
are not project identity verification.

Do not use production credentials, production data, publishable keys,
service-role keys, database passwords, or connection strings. Do not link the
repository, deploy, run `supabase db push`, or execute any remote migration
from a CLI.

## Administrator authorization prerequisite

The CMS delegates administrator decisions to the existing
`public.is_portfolio_admin()` registry; the migration no longer contains or
compares the production administrator UID. It refuses to proceed unless that
function is a `SECURITY DEFINER` boolean check of `auth.uid()`, has an empty
`search_path`, and does not call another CMS function. The migration cannot
prove the business meaning of a remotely-defined function from source text
alone. Inspect the existing function definition and admin registry before
applying the migration. The setup fixture defines the same safe pattern and
registers only its fake test UID (`11111111-1111-4111-8111-111111111111`);
the test project does not need the production administrator UID.

## Bucket dependencies and exposure

- `portfolio-private` stores new draft uploads and must be private.
- The legacy `portfolio_media` (underscore) bucket is a real private source
  dependency: existing paths may still be signed for admins and explicitly
  copied to the publication bucket during publishing. It must exist and remain
  private. The migration deliberately does not create it or change its
  visibility. For the fresh disposable project, `00_setup.sql` creates this
  exact ID as a private, empty fixture after checking that no named buckets
  already exist. On any non-empty project, inspect existing assets and CMS
  references first; do not create an empty replacement to hide missing legacy
  data.
- `portfolio-media` (hyphen) and `portfolio-media.` (hyphen plus trailing
  period) are distinct optional legacy buckets. Their objects and CMS
  `storagePath` references are checked against the exact bucket ID. A missing
  legacy bucket is acceptable only when there are no references to it. An
  existing public legacy bucket blocks publishing while it contains objects or
  CMS references. Do not rename or merge these IDs.
- `portfolio-published` must be explicitly configured public by a trusted
  operator before publishing; the migration creates it private if absent and
  never changes an existing bucket's public flag. Database projection RLS does
  **not** protect public Storage objects or direct object URLs. A public
  `portfolio-published` object is accessible outside database projection
  rules, so its contents require a separate Storage audit.
- `cms_public_content_audited()` is a dynamic eligibility check, not an audit
  marker check. For every public database read it verifies current source /
  projection parity, public/private destination bucket flags, and the absence
  of private, unknown, or unsafe legacy asset paths. A stale or unsafe
  projection fails closed. It does not make direct public Storage URLs private.
- Trusted-operator visibility and Storage-content attestations remain
  publication-readiness requirements. Destination bucket configuration
  changes invalidate both; object changes invalidate the content review.
  Public projection reads do not depend on these timestamps. The separate
  `projections_audited_at` field is advisory: projection changes and every
  migration rerun clear it, but a normal publish, unpublish, delete, or rerun
  does not hide otherwise-safe public database content or require a new
  projection review before reads. Re-audit Storage contents before publishing
  again after Storage changes. The health RPC exposes the dynamic check as
  `publicProjectionEligible` and the operator attestation separately as
  `publicStorageContentAuditRecorded`.
- The legacy project fixture models the known source columns (`technologies`
  JSONB, `title`, `slug`, `description`, `category`, `cover_image`, `images`,
  status/visibility, and ordering metadata). Structured technologies and
  original media fields are preserved. A structured `technologies` array is
  mapped to frontend `techStack` only when `techStack` is absent; a JSONB
  comma-separated technology string is split only in that fallback case.
  Existing `techStack` strings are normalized independently into the array
  form required by the frontend.
  Experience, education, and site-settings fixtures cover the frontend fields
  mapped by this migration, but their exact hosted legacy DDL/data have not
  been independently verified.

## Frontend Storage lifecycle

The Supabase API uploads new draft assets to `portfolio-private`, stores their
exact bucket/path in CMS payloads, and obtains signed URLs for private assets.
On publish it first calls the readiness-checked CMS RPC, then copies referenced
assets to `portfolio-published` and rewrites only the CMS payload paths to that
destination. If a copy fails, the client tries to unpublish the record and
remove newly copied public objects; if rollback or cleanup also fails it
surfaces that failure. This is a multi-step client workflow, not a single
Storage/Postgres transaction. Existing public object URLs remain independently
fetchable while their objects exist, even if a database projection is hidden.

Unpublish and delete first update the CMS row (delete is a soft-delete), which
removes its public projection, then the client removes only unreferenced
`portfolio-published`/`portfolio-private` objects. Cleanup failure can leave an
orphaned object and is surfaced to the caller. Legacy-bucket source objects are
not silently rewritten or removed; publishing copies their referenced assets
only when explicitly requested.

## Safe execution sequence

Use only a newly created, empty `portfolio-cms-test` project whose ref has
been verified as `ifakxmugmdcjyhytzpwx`. Stop if it already has validation/CMS
tables, prerequisite or legacy tables, or any of the fixture bucket IDs.

1. Verify the Dashboard project name and ref as described above.
2. Run [00_setup.sql](./00_setup.sql) once. It checks Auth/Storage prerequisites
   and object-name collisions before creating the test-only admin registry,
   legacy fixture tables, and three empty legacy buckets. The whole script is
   transactional. If it fails, issue `ROLLBACK;` in that same SQL Editor
   session if a transaction remains open, then inspect the project before
   retrying. Do not remove or overwrite pre-existing project objects.
3. Verify the Dashboard project name and ref again. Apply the repository
   migration
   [20261028130000_portfolio_cms.sql](../migrations/20261028130000_portfolio_cms.sql)
   unchanged in the SQL Editor. It is transaction-wrapped. Do not substitute
   the production UID or create a separate migration copy.
4. Verify the Dashboard project again and run
   [01_post_migration_assertions.sql](./01_post_migration_assertions.sql). It
   checks function signatures, trusted-admin behavior, conservative backfill,
   bucket distinctions, projection contents, and blocked initial publishing.
5. Verify the Dashboard project again and run
   [02_rerun_seed.sql](./02_rerun_seed.sql). It records bucket metadata and
   object-count baselines and creates only clearly named test sentinels. It
   does not change bucket visibility. Both destination buckets must be private
   and empty. The transaction makes a failed seed retryable; it also accepts
   only already-existing sentinels that exactly match its expected values.
6. Verify the Dashboard project again, run the same repository migration a
   second time, then verify the project and run
   [03_rerun_assertions.sql](./03_rerun_assertions.sql). This checks that the
   sentinels, migrated records, bucket configuration, and object counts were
   preserved. A migration rerun clears the advisory projection-review
   timestamp, but not database read eligibility; no new projection review is
   needed merely to keep reads available. Changes to `portfolio-published`
   bucket configuration invalidate both visibility and content attestations;
   object changes invalidate the content attestation and require an operator
   review before the next publication.
7. Verify the Dashboard project again and run
   [04_security_and_bucket_scenarios.sql](./04_security_and_bucket_scenarios.sql).
   It tests authorized test-admin recognition, direct-RPC readiness enforcement,
   failed-publication rollback, projection synchronization on publish,
   unpublish, and delete, non-admin authenticated write denial,
   unauthenticated write denial, audit marker insufficiency, and draft privacy.
   It changes only temporary CMS records/audit markers inside a transaction
   and ends with `ROLLBACK`.
   Anonymous queries are attempted only if the role has table-level `SELECT`;
   absence of that grant is itself a valid deny and does not make the test fail.
8. If the disposable project's operator has explicitly configured
   `portfolio-published` as public, performed the Storage review, and recorded
   the required attestations, verify the Dashboard project again and run
   [06_public_lifecycle.sql](./06_public_lifecycle.sql). It tests ordinary
   publish / anonymous read, continued availability of unrelated published
   content after unpublish and delete, draft privacy, stale-projection
   fail-closed reads, and read availability after audit timestamps are
   invalidated. All CMS modifications occur inside a transaction ending in
   `ROLLBACK`. It temporarily removes only the exact rerun sentinel rows inside
   that transaction so the deliberate stale-projection fixture does not block
   unrelated lifecycle tests; rollback restores those sentinels. Storage
   upload/copy/cleanup effects are simulated here by invalidating audit
   timestamps; this SQL script does not invoke the Storage API or claim to test
   actual object-copy behavior.

   Do not change bucket visibility just to run this test. If
   `portfolio-published` is private, skip this scenario and report it as not
   run. Only if the bucket is already public under an independently approved
   test-project configuration, verify the Dashboard project and review its
   contents and configuration. Then, and only then, use the privileged SQL
   Editor to record the attestation:

   ```sql
   update public.portfolio_cms_storage_audit
   set visibility_verified_at = now(),
       audited_at = now(),
       audited_by = auth.uid()
   where bucket_id = 'portfolio-published';
   ```

   This statement records, but does not perform, the operator review. Do not
   run it without inspecting the actual bucket and contents first. It does not
   set `projections_audited_at`, which is advisory and not required for reads.
   If the SQL Editor cannot run with a privileged role, stop; do not broaden
   table grants or add a public audit RPC.
9. The dotted-object check is optional and is the only step that creates an
   actual Storage object. If needed, verify the Dashboard project again and
   upload exactly one harmless, non-sensitive text file to bucket ID
   `portfolio-media.` (including the trailing period). This fixture bucket is
   public, so the file may be fetched from its direct public URL until deleted.
   Do not use sensitive content. Run
   [05_dotted_object_assertion.sql](./05_dotted_object_assertion.sql), then
   immediately delete that exact test object in the Dashboard. Verify that
   `portfolio-media.` contains zero objects before ending the test. If the
   assertion fails, perform this cleanup anyway. Never write directly to
   `storage.objects`.

If SQL Editor does not permit role/claim simulation, report those scenarios as
not run. Do not weaken policies to make a test pass. If a transaction fails,
roll it back before retrying. If setup has already committed, do not rerun
setup; inspect and continue from the failed step or use a new disposable
project. Rerunning the migration is idempotent for its own objects, does not overwrite
existing CMS/projection conflicts or refresh already migrated records, and
clears the advisory projection-review timestamp. It does not require a new
projection review for public database reads. Review the migration's changes
and re-run the assertions after each rerun; verify current Storage attestations
before a subsequent publish if Storage changed.

## What these checks do not prove

- A SQL ref marker does not identify the active Dashboard project.
- The SQL Editor role/claim simulation is not a signed Auth JWT or a complete
  PostgREST integration test.
- These scripts do not verify HTTP access to direct public Storage URLs, signed
  URL behavior, actual Storage upload/copy/delete behavior or failure
  handling, browser uploads, Realtime delivery, or hosted Auth sign-in.
- Projection RLS controls database rows only. It cannot revoke a public
  Storage object's direct URL access.
- The hosted project's PostgreSQL version, grants, Storage implementation,
  Auth functions, and publication configuration remain unverified until the
  scripts are actually run in the disposable project.
- This workflow does not establish that production has the same schema,
  administrator registry, content, or bucket states. Production must not be
  used for these tests.

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
- The CMS provides a **Storage review** page for authenticated portfolio
  administrators. The server-side snapshot includes exact bucket
  configuration, every object and its metadata, and the published CMS records
  that reference each object. The operator must inspect every object (including
  unreferenced items), open assets as needed, and confirm the review in the UI.
  The audit RPC independently checks `public.is_portfolio_admin()`, compares
  the reviewed snapshot against current Storage state, and records
  `audited_by = auth.uid()` on the server. It accepts no caller-supplied user
  ID. A changed or stale inventory is rejected and must be reloaded and
  reviewed again.
- Every public-bucket object mutation still clears `audited_at`; bucket
  configuration changes still clear the visibility and content attestations.
  A successful publish may copy files after the publish RPC, so a publish that
  changes Storage can succeed and immediately require a new review before the
  next publish. New media-library uploads now remain private drafts; publish
  them explicitly from the library so publication follows the same gate.
  Project images and resumes likewise upload to private draft storage. Public
  objects are directly accessible as soon as copied to the public bucket;
  database RLS cannot protect their direct URLs while an operator is reviewing.
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

The Media Library and Resume pages upload new files as private drafts. Media
records are no longer auto-published on upload. An operator explicitly
publishes a media record after reviewing it; asset promotion still passes the
database publication gate and invalidates the Storage-content audit whenever
the public bucket changes.

Unpublish and delete first update the CMS row (delete is a soft-delete), which
removes its public projection, then the client removes only unreferenced
`portfolio-published`/`portfolio-private` objects. Cleanup failure can leave an
orphaned object and is surfaced to the caller. Legacy-bucket source objects are
not silently rewritten or removed; publishing copies their referenced assets
only when explicitly requested.

## Recording a trusted-operator review

After applying the additive workflow migration and deploying the matching CMS
frontend to the **disposable test project**:

1. Sign in with an account already registered by `public.is_portfolio_admin()`.
   Do not add a new public policy, expose the audit table, or pass an operator
   UID from the browser.
2. Open **Storage review** from the admin navigation. The server returns the
   `portfolio-published` configuration and full object inventory; the page
   shows each object, metadata, its published CMS references, and a direct
   link for inspection. Review unreferenced items too.
3. If any object or configuration is unexpected, stop and investigate it.
   The page does not delete assets or change bucket visibility. Direct object
   URLs remain accessible while the public bucket is public.
4. Confirm the review in the page. The RPC re-reads configuration and
   inventory, rejects a stale snapshot, derives the actor from `auth.uid()`,
   and records the audit timestamps and `audited_by` together.
5. If Storage changes at any point after confirmation, the existing trigger
   invalidates the audit. Reload, inspect the new full inventory, and confirm
   a new review before another publication.

No separate auditor table, client secret, or service-role key is introduced.
The existing portfolio-admin registry is the trusted-operator allowlist;
register only accounts trusted to inspect and attest to all public assets.
The additive migration itself makes no Dashboard setting changes. If
`portfolio-published` is not already public under an independently approved
test configuration, do not change it merely to make validation pass.

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
4. Verify the Dashboard project again and apply
   [20261029120000_portfolio_storage_audit_workflow.sql](../migrations/20261029120000_portfolio_storage_audit_workflow.sql).
   This additive transaction installs admin-only inventory/review RPCs; it
   does not change bucket visibility, Storage policies, or audit triggers.
5. Verify the Dashboard project again and run
   [01_post_migration_assertions.sql](./01_post_migration_assertions.sql). It
   checks function signatures, trusted-admin behavior, conservative backfill,
   bucket distinctions, projection contents, and blocked initial publishing.
6. Verify the Dashboard project again and run
   [02_rerun_seed.sql](./02_rerun_seed.sql). It records bucket metadata and
   object-count baselines and creates only clearly named test sentinels. It
   does not change bucket visibility. Both destination buckets must be private
   and empty. The transaction makes a failed seed retryable; it also accepts
   only already-existing sentinels that exactly match its expected values.
7. Verify the Dashboard project again, rerun both repository migrations in
   order, then verify the project and run
   [03_rerun_assertions.sql](./03_rerun_assertions.sql). This checks that the
   sentinels, migrated records, bucket configuration, and object counts were
   preserved. A migration rerun clears the advisory projection-review
   timestamp, but not database read eligibility; no new projection review is
   needed merely to keep reads available. Changes to `portfolio-published`
   bucket configuration invalidate both visibility and content attestations;
   object changes invalidate the content attestation and require an operator
   review before the next publication.
8. Verify the Dashboard project again and run
   [04_security_and_bucket_scenarios.sql](./04_security_and_bucket_scenarios.sql).
   It tests authorized test-admin recognition, direct-RPC readiness enforcement,
   failed-publication rollback, projection synchronization on publish,
   unpublish, and delete, non-admin authenticated write denial,
   unauthenticated write denial, audit marker insufficiency, and draft privacy.
   It changes only temporary CMS records/audit markers inside a transaction
   and ends with `ROLLBACK`.
   Anonymous queries are attempted only if the role has table-level `SELECT`;
   absence of that grant is itself a valid deny and does not make the test fail.
9. Run [07_storage_audit_workflow.sql](./07_storage_audit_workflow.sql) in the
   verified test project's SQL Editor. It uses `SET LOCAL ROLE anon` and
   `SET LOCAL ROLE authenticated` to test actual SQL EXECUTE and table grants,
   tests that the original shared JSON helper ignores plain strings but finds
   nested `storagePath` properties, and ends with `ROLLBACK`. Its non-admin JWT
   claim is a negative authorization simulation; it does not create or simulate
   a successful administrator identity. SQL Editor role/claim tests do not
   prove signed PostgREST authentication.
10. For signed Auth/PostgREST verification, create or use one real test Auth
    account already authorized by the project's existing
    `public.is_portfolio_admin()` registry and a separate real Auth account
    that is not an administrator. Do not insert a fabricated UID or enable
    public sign-up for this test. Create/invite the test users through the
    project's existing Auth setup. If this fresh validation setup uses the
    fixture `public.portfolio_admins` registry, register only the UID of the
    confirmed, email-verified test Auth user (look it up from `auth.users` or
    the Dashboard; never invent one). For another registry, use its existing
    approved provisioning procedure without changing the admin-check
    function. Manually inspect the complete public test bucket inventory
    first, then set the integration environment variables listed below and run
    `node --test supabase/tests/07_storage_audit_workflow.integration.mjs`.
    The script refuses any URL except the test ref, verifies anonymous and
    signed-in non-admin denials (including table reads/writes), performs the
    snapshot/audit workflow as the signed-in admin, checks that the server
    records that user's actual Auth UID, and rejects a stale snapshot.
    It then uploads one uniquely named, harmless PNG to the already-public
    test bucket, verifies that the trigger invalidates the audit, deletes that
    exact object in a `finally` cleanup, and confirms cleanup does not restore
    the audit. The test object is publicly accessible until removed. Verify
    its deletion in the Dashboard even when the script fails. This integration
    test creates a fresh audit only after the operator has explicitly marked
    the public inventory as manually reviewed.
11. If the disposable project's operator has explicitly configured
    `portfolio-published` as public, performed the Storage review, and recorded
    the required attestations using the CMS **Storage review** page, verify
    the Dashboard project again and run
    [06_public_lifecycle.sql](./06_public_lifecycle.sql). It tests ordinary
    publish / anonymous read, continued availability of unrelated published
    content after unpublish and delete, draft privacy, stale-projection
    fail-closed reads, and read availability after audit timestamps are
    invalidated. All CMS modifications occur inside a transaction ending in
    `ROLLBACK`. It temporarily removes only the exact rerun sentinel rows inside
    that transaction so the deliberate stale-projection fixture does not block
    unrelated lifecycle tests; rollback restores those sentinels. Storage
    upload/copy/cleanup effects are simulated here by invalidating audit
    timestamps; actual public object mutation is exercised by the PostgREST
    integration test above.

   Do not change bucket visibility just to run this test. If the required
   configuration is not already in place, skip this scenario and report it as
   not run. The lifecycle script rolls its CMS changes back.
12. The dotted-object check is optional and is the only step that creates an
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

The PostgREST integration test requires these environment variables, set only
in the test shell or a secret manager and never committed or printed:
`RUN_SUPABASE_TEST_INTEGRATION=true`, `SUPABASE_TEST_URL`,
`SUPABASE_TEST_PUBLISHABLE_KEY`, `SUPABASE_TEST_ADMIN_EMAIL`,
`SUPABASE_TEST_ADMIN_PASSWORD`, `SUPABASE_TEST_NON_ADMIN_EMAIL`,
`SUPABASE_TEST_NON_ADMIN_PASSWORD`, and
`SUPABASE_TEST_PUBLIC_ASSETS_REVIEWED=true`. The last value is an explicit
operator acknowledgement that every current public object was inspected.
Use real accounts from the test project's existing Auth configuration and
administrator registry.

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

## Test-project rollback

The fixed additive migration no longer replaces the shared
`cms_jsonb_uses_storage_path(jsonb,text)` helper. If the earlier implementation
that did replace it was already applied to the disposable project, first
restore the helper from the base migration, then remove only the three new
workflow functions. Recheck the Dashboard project name/ref before running this
rollback. Do not drop the shared helper, audit table, triggers, buckets, CMS
tables, or project data.

```sql
begin;

create or replace function public.cms_jsonb_uses_storage_path(
  p_value jsonb,
  p_path text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    if p_value ->> 'storagePath' = p_path then
      return true;
    end if;
    for v_child in select value from jsonb_each(p_value)
    loop
      if public.cms_jsonb_uses_storage_path(v_child, p_path) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.cms_jsonb_uses_storage_path(v_child, p_path) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$function$;

revoke all on function public.cms_jsonb_uses_storage_path(jsonb, text)
  from public, anon, authenticated;

drop function if exists public.cms_record_public_storage_audit(jsonb);
drop function if exists public.cms_get_public_storage_audit_snapshot();
drop function if exists public.cms_public_storage_audit_snapshot();

commit;
```

The rollback is only for the additive workflow functions/helper regression.
It intentionally leaves audit rows and all base migration behavior intact.
If any `DROP FUNCTION` reports a dependency, stop and roll back rather than
adding `CASCADE`. Revert the frontend separately to its prior test build.
Remove only the uniquely named integration-test object if automatic cleanup
failed, then verify its absence. Do not reset audit timestamps manually;
review the current bucket contents through the trusted CMS UI after rollback
before allowing another publication.

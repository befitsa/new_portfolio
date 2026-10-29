import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const enabled = process.env.RUN_SUPABASE_TEST_INTEGRATION === 'true'

test('Storage audit RPCs enforce real Auth and PostgREST authorization', {
  skip: enabled
    ? false
    : 'Set RUN_SUPABASE_TEST_INTEGRATION=true to run against the disposable test project.',
}, async () => {
  const required = [
    'SUPABASE_TEST_URL',
    'SUPABASE_TEST_PUBLISHABLE_KEY',
    'SUPABASE_TEST_ADMIN_EMAIL',
    'SUPABASE_TEST_ADMIN_PASSWORD',
    'SUPABASE_TEST_NON_ADMIN_EMAIL',
    'SUPABASE_TEST_NON_ADMIN_PASSWORD',
    'SUPABASE_TEST_PUBLIC_ASSETS_REVIEWED',
  ]
  const missing = required.filter((name) => !process.env[name])
  assert.deepEqual(missing, [], `Missing integration environment variables: ${missing.join(', ')}`)
  assert.equal(
    process.env.SUPABASE_TEST_PUBLIC_ASSETS_REVIEWED,
    'true',
    'Review every public test-bucket object manually before enabling audit recording.',
  )

  const url = new URL(process.env.SUPABASE_TEST_URL)
  assert.equal(
    url.hostname,
    'ifakxmugmdcjyhytzpwx.supabase.co',
    'Refusing to run outside disposable project ifakxmugmdcjyhytzpwx.',
  )

  const makeClient = () => createClient(
    process.env.SUPABASE_TEST_URL,
    process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const anonymous = makeClient()
  const nonAdmin = makeClient()
  const admin = makeClient()

  const assertRpcDenied = async (client, name, args) => {
    const { error } = await client.rpc(name, args)
    assert.ok(error, `${name} unexpectedly succeeded`)
    assert.equal(error.code, '42501', `${name} failed for a reason other than authorization`)
  }
  const assertAuditTableDenied = async (client, label) => {
    const { error: readError } = await client
      .from('portfolio_cms_storage_audit')
      .select('bucket_id')
      .limit(1)
    assert.ok(readError, `${label} unexpectedly read the audit table`)
    assert.equal(readError.code, '42501', `${label} audit-table read failed for an unexpected reason`)

    const { error: writeError } = await client
      .from('portfolio_cms_storage_audit')
      .update({ audited_at: null })
      .eq('bucket_id', 'portfolio-published')
    assert.ok(writeError, `${label} unexpectedly wrote the audit table`)
    assert.equal(writeError.code, '42501', `${label} audit-table write failed for an unexpected reason`)
  }

  await assertRpcDenied(
    anonymous,
    'cms_get_public_storage_audit_snapshot',
    {},
  )
  await assertRpcDenied(
    anonymous,
    'cms_record_public_storage_audit',
    { p_reviewed_snapshot: {} },
  )
  await assertAuditTableDenied(anonymous, 'Anonymous client')

  const nonAdminSignIn = await nonAdmin.auth.signInWithPassword({
    email: process.env.SUPABASE_TEST_NON_ADMIN_EMAIL,
    password: process.env.SUPABASE_TEST_NON_ADMIN_PASSWORD,
  })
  assert.equal(nonAdminSignIn.error, null, 'Test non-admin sign-in failed')
  const { data: nonAdminStatus, error: nonAdminStatusError } = await nonAdmin
    .rpc('cms_is_admin')
  assert.equal(nonAdminStatusError, null)
  assert.equal(nonAdminStatus, false, 'The non-admin integration account is authorized as an admin')
  await assertRpcDenied(nonAdmin, 'cms_get_public_storage_audit_snapshot', {})
  await assertRpcDenied(
    nonAdmin,
    'cms_record_public_storage_audit',
    { p_reviewed_snapshot: {} },
  )
  await assertAuditTableDenied(nonAdmin, 'Authenticated non-admin')

  const adminSignIn = await admin.auth.signInWithPassword({
    email: process.env.SUPABASE_TEST_ADMIN_EMAIL,
    password: process.env.SUPABASE_TEST_ADMIN_PASSWORD,
  })
  assert.equal(adminSignIn.error, null, 'Test admin sign-in failed')
  const { data: userData, error: userError } = await admin.auth.getUser()
  assert.equal(userError, null, 'Could not verify the signed-in test admin')
  assert.ok(userData.user?.id, 'Supabase Auth did not return the signed-in test admin UID')
  const { data: adminStatus, error: adminStatusError } = await admin.rpc('cms_is_admin')
  assert.equal(adminStatusError, null)
  assert.equal(adminStatus, true, 'Signed-in test account is not authorized by the existing admin registry')

  const { data: snapshot, error: snapshotError } = await admin
    .rpc('cms_get_public_storage_audit_snapshot')
  assert.equal(snapshotError, null, 'Authorized admin could not retrieve the Storage inventory')
  assert.equal(snapshot?.bucket?.id, 'portfolio-published')
  assert.ok(Array.isArray(snapshot.objects))

  const staleSnapshot = structuredClone(snapshot)
  staleSnapshot.bucket.name = `${staleSnapshot.bucket.name}-stale`
  const { error: staleError } = await admin.rpc(
    'cms_record_public_storage_audit',
    { p_reviewed_snapshot: staleSnapshot },
  )
  assert.equal(staleError?.code, '40001', 'Stale snapshot was not rejected as a serialization conflict')
  assert.match(staleError.message, /Storage changed after review/)

  const { data: auditResult, error: auditError } = await admin
    .rpc('cms_record_public_storage_audit', {
      p_reviewed_snapshot: snapshot,
    })
  assert.equal(auditError, null, 'Authorized admin could not record the reviewed inventory')
  assert.equal(auditResult?.auditedBy, userData.user.id)

  const testObjectPath = `published/test-audit-invalidation-${randomUUID()}.png`
  let uploadAttempted = false
  try {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
      'base64',
    )
    uploadAttempted = true
    const { error: uploadError } = await admin.storage
      .from('portfolio-published')
      .upload(testObjectPath, png, {
        contentType: 'image/png',
        upsert: false,
      })
      assert.equal(uploadError, null, 'Could not create the temporary public audit test object')

    const { data: afterUpload, error: uploadHealthError } = await admin.rpc('cms_health')
    assert.equal(uploadHealthError, null)
    assert.equal(
      afterUpload.storage.publicStorageContentAuditRecorded,
      false,
      'A public-bucket upload did not invalidate the content audit',
    )
  } finally {
    if (uploadAttempted) {
      const { error: removeError } = await admin.storage
        .from('portfolio-published')
        .remove([testObjectPath])
      assert.equal(removeError, null, 'Could not remove the temporary public audit test object')
    }
  }

  const { data: afterCleanup, error: cleanupHealthError } = await admin.rpc('cms_health')
  assert.equal(cleanupHealthError, null)
  assert.equal(
    afterCleanup.storage.publicStorageContentAuditRecorded,
    false,
    'Storage cleanup unexpectedly restored the invalidated content audit',
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_SECTIONS, adminPathForSection, adminSectionForPath } from '../src/admin/adminRoutes.js'

test('Content Core sections all have valid admin paths and resolve to the matching active section', () => {
  for (const { label } of ADMIN_SECTIONS) {
    const path = adminPathForSection(label)
    assert.ok(path.startsWith('/'))
    assert.equal(path.includes('undefined'), false)
    assert.equal(adminSectionForPath(`/admin${path}`), label)
  }
  assert.equal(adminPathForSection('Unknown section'), '/')
  assert.equal(adminSectionForPath('/admin/projects/example-case-study'), 'Projects Management')
})

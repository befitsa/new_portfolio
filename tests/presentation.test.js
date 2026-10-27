import test from 'node:test'
import assert from 'node:assert/strict'
import { toPublicEducation, toPublicExperience } from '../src/lib/db/presentation.js'
import { educationQualifications } from '../src/lib/db/contentSchemas.js'

test('public education view keeps institution, qualification, and field as separate display values', () => {
  const view = toPublicEducation({
    id: 'hawassa',
    institution: 'Hawassa University',
    degree: 'BSc',
    fieldOfStudy: 'Computer Science',
    startYear: 2020,
    endYear: 2024,
    notes: 'Graduated with honors',
  })

  assert.equal(view.institution, 'Hawassa University')
  assert.equal(view.qualification, 'BSc')
  assert.equal(view.fieldOfStudy, 'Computer Science')
  assert.equal(view.date, '2020 — 2024')
  assert.equal(view.description, 'Graduated with honors')
})

test('public education cards preserve each supported qualification label', () => {
  for (const qualification of educationQualifications) {
    const view = toPublicEducation({
      id: 'qualification-test',
      institution: 'Example University',
      degree: qualification,
      startYear: 2018,
      endYear: 2024,
    })
    assert.equal(view.qualification, qualification)
    assert.equal(view.title, qualification)
  }
})

test('public experience view exposes an attached cover letter only when present', () => {
  const experience = {
    id: 'role-1',
    role: 'Engineer',
    company: 'Example Co.',
    startDate: '2023-01-01',
    coverLetter: {
      fileName: 'cover-letter.pdf',
      fileUrl: '/__local-cms/uploads/123e4567-e89b-12d3-a456-426614174000/cover-letter.pdf',
      storagePath: 'uploads/123e4567-e89b-12d3-a456-426614174000/cover-letter.pdf',
      sizeKB: 24.5,
    },
  }
  assert.deepEqual(toPublicExperience(experience).coverLetter, {
    fileName: 'cover-letter.pdf',
    fileUrl: experience.coverLetter.fileUrl,
  })
  assert.equal(toPublicExperience({ ...experience, coverLetter: undefined }).coverLetter, null)
})

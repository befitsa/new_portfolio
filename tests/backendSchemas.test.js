import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePayload } from '../functions/contentSchemas.js'
import { isLegacySeedRecord } from '../src/lib/db/legacyContent.js'

test('public reads suppress the previous built-in project and education seed IDs', () => {
  assert.equal(isLegacySeedRecord('projects', { id: 'project-01' }), true)
  assert.equal(isLegacySeedRecord('projects', { id: 'local-project-new' }), false)
  assert.equal(isLegacySeedRecord('education', { id: 'edu-hawassa' }), true)
  assert.equal(isLegacySeedRecord('education', { id: 'local-education-new' }), false)
})

test('CMS API canonicalizes legacy category names and validates education credential links', () => {
  const base = { title: 'Legacy site', slug: 'legacy-site', category: 'Web Design' }
  assert.equal(parsePayload('projects', base).category, 'Web')
  assert.equal(parsePayload('projects', { ...base, slug: 'mobile-app', category: 'Mobile App' }).category, 'Mobile')
  assert.equal(parsePayload('education', {
    degree: 'Certificate', institution: 'Example', startYear: 2024, credentialUrl: 'https://example.com/credential',
  }).credentialUrl, 'https://example.com/credential')
  assert.throws(() => parsePayload('education', {
    degree: 'Certificate', institution: 'Example', startYear: 2024, credentialUrl: 'javascript:alert(1)',
  }))
})

test('backend CMS validation accepts structured technologies and preserves legacy values', () => {
  const project = {
    title: 'Technology project',
    slug: 'technology-project',
    techStack: [{ id: 'react', name: 'React', logo: { url: 'https://storage.example/react.svg', storagePath: 'portfolio-private/drafts/react.svg' }, description: 'UI components.' }],
  }
  assert.equal(parsePayload('projects', project).techStack[0].logo.storagePath, 'portfolio-private/drafts/react.svg')
  assert.deepEqual(parsePayload('projects', { ...project, slug: 'legacy-stack', techStack: 'React, Vite' }).techStack.map(({ name }) => name), ['React', 'Vite'])
})

test('CMS API resume records support an inline preview URL separately from the download URL', () => {
  const resume = parsePayload('resumes', {
    fileUrl: 'https://storage.example/resume.pdf', previewUrl: 'https://storage.example/resume.pdf?inline=1',
    storagePath: 'resumes/test/resume.pdf', fileName: 'resume.pdf', sizeKB: 24, version: '1.0',
  })
  assert.equal(resume.previewUrl, 'https://storage.example/resume.pdf?inline=1')
})

test('backend accepts managed skill metadata and rejects incomplete regular media', () => {
  const skill = parsePayload('media', {
    type: 'image',
    isSkill: true,
    name: 'JavaScript',
    category: 'Frontend',
    url: 'https://cdn.example.com/javascript.svg',
    storagePath: '',
    sizeBytes: 0,
  })
  assert.equal(skill.name, 'JavaScript')
  assert.equal(skill.category, 'Frontend')
  assert.throws(() => parsePayload('media', {
    type: 'image',
    isSkill: true,
    name: '',
    url: '',
    storagePath: '',
    sizeBytes: 0,
  }))
  assert.throws(() => parsePayload('media', {
    type: 'image',
    url: 'https://cdn.example.com/image.png',
    storagePath: '',
    sizeBytes: 0,
  }))
})

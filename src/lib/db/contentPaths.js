import { collection, doc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { contentSchemas } from './contentSchemas.js'

export function assertContentType(type) {
  if (!Object.hasOwn(contentSchemas, type)) {
    throw new Error(`Unsupported CMS content type: ${type}`)
  }
  if (!db) throw new Error('Firebase is not configured.')
  return type
}

export function draftCollection(type) {
  assertContentType(type)
  return collection(db, 'drafts', type, 'items')
}

export function publishedCollection(type) {
  assertContentType(type)
  return collection(db, 'published', type, 'items')
}

export function draftDocument(type, id) {
  assertContentType(type)
  return doc(db, 'drafts', type, 'items', id)
}

export function publishedDocument(type, id) {
  assertContentType(type)
  return doc(db, 'published', type, 'items', id)
}

export function draftSettingsDocument() {
  if (!db) throw new Error('Firebase is not configured.')
  return doc(db, 'drafts', 'site', 'settings', 'current')
}

export function publishedSettingsDocument() {
  if (!db) throw new Error('Firebase is not configured.')
  return doc(db, 'published', 'site', 'settings', 'current')
}

export function projectSlugDocument(slug) {
  if (!db) throw new Error('Firebase is not configured.')
  return doc(db, 'slugRegistry', 'projects', 'slugs', slug)
}

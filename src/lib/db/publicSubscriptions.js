import {
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import {
  assertContentType,
  publishedCollection,
  publishedSettingsDocument,
} from './contentPaths.js'
import { normalizeFirestoreError } from './errors.js'
import { isLegacySeedRecord } from './legacyContent.js'
import {
  subscribePublishedCollection,
  subscribePublishedDocument,
  subscribePublishedSettings,
} from '../../services/contentService.js'
import {
  subscribeLocalCmsCollection,
  subscribeLocalCmsDocument,
  subscribeLocalCmsSettings,
} from '../../services/localCmsSubscriptions.js'
import { isLocalFilesystemCms } from '../../services/cmsProvider.js'

export function subscribeToPublishedCollection(type, onValue, onError) {
  if (isLocalFilesystemCms) return subscribeLocalCmsCollection(type, onValue, onError)
  if (import.meta.env.DEV) return subscribePublishedCollection(type, onValue, onError)
  assertContentType(type)
  const request = query(
    publishedCollection(type),
    where('status', '==', 'published'),
    where('visibility', '==', true),
    orderBy('order', 'asc'),
  )
  return onSnapshot(
    request,
    (snapshot) => onValue(snapshot.docs
      .map((item) => ({ ...item.data(), id: item.id }))
      .filter((item) => !isLegacySeedRecord(type, item))),
    (error) => onError(normalizeFirestoreError(error)),
  )
}

export function subscribeToPublishedDocument(type, id, onValue, onError) {
  if (isLocalFilesystemCms) return subscribeLocalCmsDocument(type, id, onValue, onError)
  if (import.meta.env.DEV) return subscribePublishedDocument(type, id, onValue, onError)
  assertContentType(type)
  return onSnapshot(
    doc(publishedCollection(type), id),
    (snapshot) => {
      const value = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null
      const visibleValue = value && !isLegacySeedRecord(type, value) ? value : null
      onValue(visibleValue?.status === 'published' && visibleValue.visibility === true ? visibleValue : null)
    },
    (error) => onError(normalizeFirestoreError(error)),
  )
}

export function subscribeToPublishedSiteSettings(onValue, onError) {
  if (isLocalFilesystemCms) return subscribeLocalCmsSettings(onValue, onError)
  if (import.meta.env.DEV) return subscribePublishedSettings(onValue, onError)
  if (!db) throw new Error('Firebase is not configured.')
  return onSnapshot(
    publishedSettingsDocument(),
    (snapshot) => {
      const value = snapshot.exists() ? snapshot.data() : null
      onValue(value?.status === 'published' && value.visibility === true ? value : null)
    },
    (error) => onError(normalizeFirestoreError(error)),
  )
}

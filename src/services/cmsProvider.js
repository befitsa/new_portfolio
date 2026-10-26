import { auth, db, isFirebaseConfigured, storage } from '../lib/firebase.js'

export const isLocalFilesystemCms = import.meta.env.DEV

export const localCmsStorageLabel = 'Local JSON + disk uploads'
export const productionCmsStorageLabel = 'Firebase Firestore + Storage'
export const hasProductionCmsProvider = !isLocalFilesystemCms && isFirebaseConfigured && Boolean(db) && Boolean(storage) && Boolean(auth)

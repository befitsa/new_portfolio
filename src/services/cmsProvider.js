import { auth, db, isFirebaseConfigured, missingFirebaseVariables } from '../lib/firebase.js'

export const isLocalFilesystemCms = import.meta.env.DEV

export const localCmsStorageLabel = 'Local JSON + disk uploads'
export const productionCmsStorageLabel = 'Firebase Functions + Firestore + Storage'
export const productionCmsApiUrl = (import.meta.env.VITE_CMS_API_URL || '').trim().replace(/\/+$/, '')
export const productionCmsConfigurationError = !productionCmsApiUrl
  ? 'Set VITE_CMS_API_URL to the deployed Firebase Function URL.'
  : !isFirebaseConfigured || !db
    ? `Set the production portfolio Firebase web app variables: ${missingFirebaseVariables.join(', ')}.`
    : !auth
      ? 'Set VITE_ADMIN_FIREBASE_API_KEY for the existing user-auth-vp administrator sign-in app.'
      : ''
export const hasProductionCmsProvider = !isLocalFilesystemCms && !productionCmsConfigurationError

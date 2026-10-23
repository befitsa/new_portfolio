import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const portfolioConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const missingFirebaseVariables = Object.entries(portfolioConfig)
  .filter(([, value]) => !value?.trim())
  .map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)

export const isFirebaseConfigured = missingFirebaseVariables.length === 0
const firebaseApps = getApps()
const existingPortfolioApp = firebaseApps.find((app) => app.name === '[DEFAULT]')
const portfolioApp = isFirebaseConfigured
  ? existingPortfolioApp ?? initializeApp(portfolioConfig)
  : existingPortfolioApp ?? null

export const db = portfolioApp ? getFirestore(portfolioApp) : null
export const storage = portfolioApp ? getStorage(portfolioApp) : null

const ADMIN_AUTH_APP_NAME = 'admin-auth-user-auth-vp'
const adminAuthConfig = {
  apiKey: import.meta.env.VITE_ADMIN_FIREBASE_API_KEY?.trim(),
  authDomain: 'user-auth-vp.firebaseapp.com',
  projectId: 'user-auth-vp',
  storageBucket: 'user-auth-vp.firebasestorage.app',
  messagingSenderId: '622076734184',
  appId: '1:622076734184:web:a068e1c0f84d69ffe5b75d',
}
const existingAdminAuthApp = firebaseApps.find((app) => app.name === ADMIN_AUTH_APP_NAME)
const adminAuthProjectMatches = !existingAdminAuthApp || existingAdminAuthApp.options.projectId === adminAuthConfig.projectId
const adminAuthConfigured = Boolean(adminAuthConfig.apiKey) && adminAuthProjectMatches
const adminAuthApp = adminAuthConfigured
  ? existingAdminAuthApp ?? initializeApp(adminAuthConfig, ADMIN_AUTH_APP_NAME)
  : null

export const auth = adminAuthApp ? getAuth(adminAuthApp) : null
export const authConfigurationError = !adminAuthProjectMatches
  ? 'The cached Firebase admin Auth app belongs to a different project. Restart the application after correcting its Firebase configuration.'
  : !adminAuthConfig.apiKey
    ? 'Admin Firebase Authentication is not configured. Set VITE_ADMIN_FIREBASE_API_KEY to the API key from the user-auth-vp web app configuration.'
    : ''

if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  if (auth) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  if (db) connectFirestoreEmulator(db, '127.0.0.1', 8280)
  if (storage) connectStorageEmulator(storage, '127.0.0.1', 9299)
}

export { browserLocalPersistence }

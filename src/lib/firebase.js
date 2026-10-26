import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth } from 'firebase/auth'

const ADMIN_AUTH_APP_NAME = 'admin-auth-user-auth-vp'
const adminAuthConfig = {
  apiKey: import.meta.env.VITE_ADMIN_FIREBASE_API_KEY?.trim(),
  authDomain: 'user-auth-vp.firebaseapp.com',
  projectId: 'user-auth-vp',
  messagingSenderId: '622076734184',
  appId: '1:622076734184:web:a068e1c0f84d69ffe5b75d',
}
const existingApp = getApps().find((app) => app.name === ADMIN_AUTH_APP_NAME)
const projectMatches = !existingApp || existingApp.options.projectId === adminAuthConfig.projectId
const configured = Boolean(adminAuthConfig.apiKey) && projectMatches
const app = configured ? existingApp ?? initializeApp(adminAuthConfig, ADMIN_AUTH_APP_NAME) : null

export const auth = app ? getAuth(app) : null
export const authConfigurationError = !projectMatches
  ? 'The cached Firebase Auth app belongs to a different project. Restart after correcting its configuration.'
  : !adminAuthConfig.apiKey
    ? 'Admin Firebase Authentication is not configured. Set VITE_ADMIN_FIREBASE_API_KEY for user-auth-vp.'
    : ''
export { browserLocalPersistence }

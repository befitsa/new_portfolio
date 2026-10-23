export class RevisionConflictError extends Error {
  constructor(message = 'This content changed since it was opened. Reload it before saving.') {
    super(message)
    this.name = 'RevisionConflictError'
  }
}

export class DuplicateSlugError extends Error {
  constructor(slug) {
    super(`The project slug "${slug}" is already in use.`)
    this.name = 'DuplicateSlugError'
  }
}

export class PartialOperationError extends Error {
  constructor(message, { completedCount, siteVersion, cause }) {
    super(message, { cause })
    this.name = 'PartialOperationError'
    this.completedCount = completedCount
    this.siteVersion = siteVersion
  }
}

export class ContentNotFoundError extends Error {
  constructor(message = 'The requested CMS content no longer exists.') {
    super(message)
    this.name = 'ContentNotFoundError'
  }
}

export class FirestoreAccessError extends Error {
  constructor(message = 'Firestore denied this operation. Check your account and Firebase rules.') {
    super(message)
    this.name = 'FirestoreAccessError'
  }
}

export function normalizeFirestoreError(error) {
  if (error?.code === 'permission-denied' || error?.code === 'unauthenticated') {
    return new FirestoreAccessError()
  }
  return error
}

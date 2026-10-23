export async function checkCmsHealth({ checkFirestore, checkStorage, projectId = '' }) {
  const [firestoreResult, storageResult] = await Promise.allSettled([
    checkFirestore(),
    checkStorage(),
  ])
  const firestoreReady = firestoreResult.status === 'fulfilled'
  const storageReady = storageResult.status === 'fulfilled'

  return {
    ok: firestoreReady,
    access: 'verified',
    administrator: 'verified',
    firestore: {
      ready: firestoreReady,
      message: firestoreReady ? '' : 'Firestore is unavailable or not configured.',
    },
    storage: {
      ready: storageReady,
      message: storageReady ? '' : 'Cloud Storage is unavailable or URL signing is not configured. Verify billing, the content bucket, and service-account permissions.',
    },
    projectId,
  }
}

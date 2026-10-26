export async function checkCmsHealth({ checkFirestore, checkStorage, projectId = '', configurationReady = true }) {
  const [firestoreResult, storageResult] = await Promise.allSettled([
    checkFirestore(),
    checkStorage(),
  ])
  const firestoreReady = firestoreResult.status === 'fulfilled'
  const storageReady = storageResult.status === 'fulfilled'

  return {
    ok: configurationReady && firestoreReady && storageReady,
    firestore: {
      ready: firestoreReady,
      message: firestoreReady ? '' : 'Firestore is unavailable or not configured.',
    },
    storage: {
      ready: storageReady,
      message: storageReady ? '' : 'Cloud Storage read/write access is unavailable. Verify the bucket, billing, and Function service account permissions.',
    },
    configuration: {
      ready: configurationReady,
      message: configurationReady ? '' : 'Set CMS_ALLOWED_ORIGINS for the deployed portfolio origin.',
    },
    projectId,
  }
}

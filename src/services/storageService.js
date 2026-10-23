const DATABASE_NAME = 'fitsum-portfolio-local-files'
const DATABASE_VERSION = 1
const FILE_STORE = 'files'

let databasePromise
const objectUrls = new Map()

export class LocalFileStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'LocalFileStorageError'
  }
}

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new LocalFileStorageError('This browser does not provide IndexedDB. Uploaded files cannot be stored safely.'))
      return
    }
    let request
    try { request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION) }
    catch (error) { reject(new LocalFileStorageError('Could not open local file storage.', error)); return }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new LocalFileStorageError('Could not open local file storage.', request.error))
    request.onblocked = () => reject(new LocalFileStorageError('Local file storage is blocked by another open portfolio tab. Close the other tab and retry.'))
  }).catch((error) => {
    databasePromise = null
    throw error
  })
  return databasePromise
}

async function transact(mode, operation) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let transaction
    let result
    try {
      transaction = database.transaction(FILE_STORE, mode)
      const request = operation(transaction.objectStore(FILE_STORE))
      if (request) request.onsuccess = () => { result = request.result }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(new LocalFileStorageError('The browser could not complete local file storage.', transaction.error))
      transaction.onabort = () => reject(new LocalFileStorageError('The browser cancelled local file storage.', transaction.error))
    } catch (error) {
      reject(error instanceof LocalFileStorageError ? error : new LocalFileStorageError('The browser could not access local file storage.', error))
    }
  })
}

export async function storeLocalFile(file, id) {
  if (!(file instanceof Blob) || !id) throw new LocalFileStorageError('Choose a file before saving it.')
  await transact('readwrite', (store) => store.put({
    id,
    blob: file,
    fileName: file.name || 'portfolio-upload',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    storedAt: new Date().toISOString(),
  }))
  return id
}

export async function readLocalFile(id) {
  if (!id) return null
  const value = await transact('readonly', (store) => store.get(id))
  return value?.blob || null
}

export async function getLocalFileUrl(id) {
  if (!id) return null
  if (objectUrls.has(id)) return objectUrls.get(id)
  const blob = await readLocalFile(id)
  if (!blob) return null
  if (!globalThis.URL?.createObjectURL) throw new LocalFileStorageError('This browser cannot preview locally stored files.')
  const url = URL.createObjectURL(blob)
  objectUrls.set(id, url)
  return url
}

export async function removeLocalFile(id) {
  if (!id) return
  const url = objectUrls.get(id)
  if (url) URL.revokeObjectURL(url)
  objectUrls.delete(id)
  await transact('readwrite', (store) => store.delete(id))
}

export async function removeUnusedLocalFiles(ids) {
  await Promise.all([...new Set(ids)].filter(Boolean).map(removeLocalFile))
}

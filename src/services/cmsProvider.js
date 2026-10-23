export const isLocalFilesystemCms = import.meta.env.DEV
  && import.meta.env.VITE_CMS_PROVIDER !== 'remote'

export const localCmsStorageLabel = 'Local JSON + disk uploads'

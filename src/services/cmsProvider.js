import { isSupabaseConfigured, missingSupabaseVariables } from '../lib/supabase.js'

export const isLocalFilesystemCms = import.meta.env.DEV

export const localCmsStorageLabel = 'Local JSON + disk uploads'
export const productionCmsStorageLabel = 'Supabase Auth + Postgres + Storage'
export const productionCmsConfigurationError = !isSupabaseConfigured
  ? `Set ${missingSupabaseVariables.join(' and ')} before building the production site.`
  : ''
export const hasProductionCmsProvider = !isLocalFilesystemCms && isSupabaseConfigured

import { contentSchemas } from './contentSchemas.js'
import { isLegacySeedRecord } from './legacyContent.js'
import {
  subscribePublishedCollection,
  subscribePublishedDocument,
  subscribePublishedSettings,
} from '../../services/contentService.js'
import {
  subscribeLocalCmsCollection,
  subscribeLocalCmsDocument,
  subscribeLocalCmsSettings,
} from '../../services/localCmsSubscriptions.js'
import { isLocalFilesystemCms } from '../../services/cmsProvider.js'
import { isSupabaseConfigured, supabase } from '../supabase.js'

function assertContentType(type) {
  if (!Object.hasOwn(contentSchemas, type)) throw new Error(`Unsupported CMS content type: ${type}`)
  if (!supabase || !isSupabaseConfigured) throw new Error('Supabase is not configured for the public portfolio.')
}

function sortByOrder(items) {
  return items.sort((left, right) => {
    const leftOrder = Number(left.order)
    const rightOrder = Number(right.order)
    const normalizedLeft = Number.isFinite(leftOrder) ? leftOrder : 0
    const normalizedRight = Number.isFinite(rightOrder) ? rightOrder : 0
    return normalizedLeft - normalizedRight
  })
}

async function fetchPublishedCollection(type) {
  const { data, error } = await supabase
    .from('portfolio_cms_public_records')
    .select('record_id,published_payload')
    .eq('content_type', type)
  if (error) throw error
  return sortByOrder((data || [])
    .map(({ record_id: id, published_payload: payload }) => ({ ...payload, id, status: 'published' }))
    .filter((record) => record.visibility === true && !isLegacySeedRecord(type, record)))
}

function subscribeToRecords(type, onValue, onError, id = null) {
  assertContentType(type)
  let active = true
  const load = async () => {
    try {
      if (id) {
        const { data, error } = await supabase
          .from('portfolio_cms_public_records')
          .select('record_id,published_payload')
          .eq('content_type', type)
          .eq('record_id', id)
          .maybeSingle()
        if (error) throw error
        const record = data?.published_payload
          ? { ...data.published_payload, id: data.record_id, status: 'published' }
          : null
        onValue(record?.visibility === true && !isLegacySeedRecord(type, record) ? record : null)
        return
      }
      onValue(await fetchPublishedCollection(type))
    } catch (error) {
      if (active) onError(error)
    }
  }

  const channel = supabase.channel(`published-${type}${id ? `-${id}` : ''}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'portfolio_cms_public_records',
      filter: `content_type=eq.${type}`,
    }, (payload) => {
      if (!id || payload.new?.record_id === id || payload.old?.record_id === id) void load()
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        void load()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (active) onError(error || new Error('Supabase Realtime could not subscribe to published portfolio updates.'))
      }
    })

  void load()
  return () => {
    active = false
    void supabase.removeChannel(channel)
  }
}

function subscribeToSettings(onValue, onError) {
  if (!supabase || !isSupabaseConfigured) throw new Error('Supabase is not configured for the public portfolio.')
  let active = true
  const load = async () => {
    try {
      const { data, error } = await supabase
        .from('portfolio_cms_public_settings')
        .select('published_payload')
        .eq('id', 'main')
        .maybeSingle()
      if (error) throw error
      const value = data?.published_payload || null
      if (active) onValue(value?.visibility === false ? null : value)
    } catch (error) {
      if (active) onError(error)
    }
  }

  const channel = supabase.channel('published-site-settings')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'portfolio_cms_public_settings',
      filter: 'id=eq.main',
    }, () => { void load() })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        void load()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (active) onError(error || new Error('Supabase Realtime could not subscribe to site settings.'))
      }
    })

  void load()
  return () => {
    active = false
    void supabase.removeChannel(channel)
  }
}

export function subscribeToPublishedCollection(type, onValue, onError) {
  if (isLocalFilesystemCms) return subscribeLocalCmsCollection(type, onValue, onError)
  if (import.meta.env.DEV) return subscribePublishedCollection(type, onValue, onError)
  return subscribeToRecords(type, onValue, onError)
}

export function subscribeToPublishedDocument(type, id, onValue, onError) {
  if (isLocalFilesystemCms) return subscribeLocalCmsDocument(type, id, onValue, onError)
  if (import.meta.env.DEV) return subscribePublishedDocument(type, id, onValue, onError)
  return subscribeToRecords(type, onValue, onError, id)
}

export function subscribeToPublishedSiteSettings(onValue, onError) {
  if (isLocalFilesystemCms) return subscribeLocalCmsSettings(onValue, onError)
  if (import.meta.env.DEV) return subscribePublishedSettings(onValue, onError)
  return subscribeToSettings(onValue, onError)
}

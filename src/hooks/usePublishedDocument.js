import { useEffect, useState } from 'react'
import {
  subscribeToPublishedDocument,
  subscribeToPublishedSiteSettings,
} from '../lib/db/publicSubscriptions.js'

export function usePublishedDocument(type, id) {
  const [state, setState] = useState({ data: null, loading: true, error: null, managed: import.meta.env.DEV })

  useEffect(() => {
    let active = true
    setState({ data: null, loading: true, error: null, managed: import.meta.env.DEV })
    if (!id) {
      setState({ data: null, loading: false, error: null, managed: import.meta.env.DEV })
      return undefined
    }
    let unsubscribe
    try {
      unsubscribe = subscribeToPublishedDocument(
        type,
        id,
        (data) => {
          if (active) setState({ data, loading: false, error: null, managed: import.meta.env.DEV })
        },
        (error) => {
          if (active) setState({ data: null, loading: false, error, managed: import.meta.env.DEV })
        },
      )
    } catch (error) {
      setState({ data: null, loading: false, error, managed: import.meta.env.DEV })
    }
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [type, id])

  return state
}

export function usePublishedSiteSettings() {
  const [state, setState] = useState({ data: null, loading: true, error: null, managed: import.meta.env.DEV })

  useEffect(() => {
    let active = true
    setState({ data: null, loading: true, error: null, managed: import.meta.env.DEV })
    let unsubscribe
    try {
      unsubscribe = subscribeToPublishedSiteSettings(
        (data) => {
          if (active) setState({ data, loading: false, error: null, managed: import.meta.env.DEV })
        },
        (error) => {
          if (active) setState({ data: null, loading: false, error, managed: import.meta.env.DEV })
        },
      )
    } catch (error) {
      setState({ data: null, loading: false, error, managed: import.meta.env.DEV })
    }
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  return state
}

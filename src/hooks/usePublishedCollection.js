import { useEffect, useState } from 'react'
import { subscribeToPublishedCollection } from '../lib/db/publicSubscriptions.js'

export function usePublishedCollection(type) {
  const [state, setState] = useState({ data: [], loading: true, error: null, managed: import.meta.env.DEV })

  useEffect(() => {
    let active = true
    setState({ data: [], loading: true, error: null, managed: import.meta.env.DEV })
    let unsubscribe
    try {
      unsubscribe = subscribeToPublishedCollection(
        type,
        (data) => {
          if (active) setState({ data, loading: false, error: null, managed: import.meta.env.DEV })
        },
        (error) => {
          if (active) setState({ data: [], loading: false, error, managed: import.meta.env.DEV })
        },
      )
    } catch (error) {
      setState({ data: [], loading: false, error, managed: import.meta.env.DEV })
    }
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [type])

  return state
}

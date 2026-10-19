// src/hooks/useResumeStatus.js
import { useEffect, useState } from 'react'
import { profile } from '../data/profile'

// Returns { status, href }.  status: 'checking' | 'ready' | 'missing'
// We really check the file exists, so the site never claims a resume is
// ready when it isn't. (A dev server answers missing files with index.html,
// so we also confirm the response is a document type, not HTML.)
export function useResumeStatus() {
  const { url, path } = profile.resume
  const href = url || path
  const [status, setStatus] = useState(url ? 'ready' : 'checking')

  useEffect(() => {
    if (url) return undefined // external link: can't be verified from the browser
    const controller = new AbortController()
    fetch(path, { method: 'HEAD', signal: controller.signal })
      .then((res) => {
        const type = res.headers.get('content-type') || ''
        const isDocument = /pdf|msword|officedocument|octet-stream/i.test(type)
        setStatus(res.ok && isDocument ? 'ready' : 'missing')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setStatus('missing')
      })
    return () => controller.abort()
  }, [url, path])

  return { status, href }
}

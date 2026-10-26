// src/hooks/useResumeStatus.js
import { useEffect, useMemo, useState } from 'react'
import { usePublishedCollection } from './usePublishedCollection.js'
import { profile } from '../data/profile.js'

// A download is available only for the visible, published resume record.
// The backend validates the PDF bytes before creating that public record.
export function useResumeStatus() {
  const published = usePublishedCollection('resumes')
  const activeResume = useMemo(
    () => published.data.find((resume) => resume.status === 'published' && resume.isActive && resume.visibility === true && resume.fileUrl) ?? null,
    [published.data],
  )
  const href = activeResume?.fileUrl || ''
  const downloadName = profile.resume.downloadName
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    if (published.loading) setStatus('checking')
    else if (published.error) setStatus('error')
    else setStatus(activeResume ? 'ready' : 'missing')
  }, [activeResume, published.error, published.loading])

  return { status, href, downloadName, resume: activeResume, error: published.error }
}

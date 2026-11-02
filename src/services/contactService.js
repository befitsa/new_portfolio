// src/services/contactService.js
// The only file that talks to a backend. The page never pretends a message was
// sent unless your endpoint answered with a success status.

const ENDPOINT = import.meta.env.VITE_CONTACT_API_URL || '/api/contact'

// Returns one of:
//   { status: 'sent' }           endpoint confirmed provider acceptance
//   { status: 'error', message } validation, delivery, or network failed
export async function sendContactMessage(values) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: values.name.trim(),
        email: values.email.trim(),
        subject: values.subject.trim(),
        message: values.message.trim(),
        website: values.website || '',
      }),
    })
    let payload
    try { payload = await res.json() } catch { payload = null }
    if (!res.ok || payload?.accepted !== true) {
      return {
        status: 'error',
        message: typeof payload?.error === 'string'
          ? payload.error
          : 'The email service could not accept your message. Please try again later.',
      }
    }
    return { status: 'sent' }
  } catch {
    return { status: 'error', message: 'Could not reach the message service. Check your connection and try again.' }
  }
}

// Fallback: opens the visitor's email app with the message pre-filled.
// This is NOT a delivered message, and the UI says so.
export function buildMailto(to, { name = '', subject = '', message = '' } = {}) {
  const body = `${message}\n\n— ${name}`
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// src/services/contactService.js
// The only file that talks to a backend. The page never pretends a message was
// sent unless your endpoint answered with a success status.

const ENDPOINT = import.meta.env.VITE_CONTACT_API_URL

export const isContactConfigured = Boolean(ENDPOINT)

// Returns one of:
//   { status: 'sent' }           endpoint accepted the message
//   { status: 'unconfigured' }   no VITE_CONTACT_API_URL set — nothing was sent
//   { status: 'error', message } endpoint or network failed
export async function sendContactMessage(values) {
  if (!ENDPOINT) return { status: 'unconfigured' }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(values),
    })
    if (!res.ok) return { status: 'error', message: `The server answered with ${res.status}.` }
    return { status: 'sent' }
  } catch {
    return { status: 'error', message: 'Could not reach the server. Check your connection.' }
  }
}

// Fallback: opens the visitor's email app with the message pre-filled.
// This is NOT a delivered message, and the UI says so.
export function buildMailto(to, { name = '', subject = '', message = '' } = {}) {
  const body = `${message}\n\n— ${name}`
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

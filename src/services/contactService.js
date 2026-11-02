// src/services/contactService.js
// The only file that talks to a backend. The page never pretends a message was
// sent unless your endpoint answered with a success status.

export const CONTACT_ENDPOINT = '/.netlify/functions/contact'

function responseError(payload, status) {
  switch (payload?.code) {
    case 'CONTACT_VALIDATION_FAILED':
    case 'INVALID_JSON':
    case 'UNSUPPORTED_CONTENT_TYPE':
    case 'REQUEST_TOO_LARGE':
      return payload.error
    case 'CONTACT_CONFIGURATION_INCOMPLETE':
      return 'Email delivery is not configured correctly on the server. Please try again later.'
    case 'EMAIL_PROVIDER_REJECTED':
      return `The email provider rejected the message (HTTP ${payload.providerStatus || status}). Please try again later or email me directly.`
    case 'EMAIL_PROVIDER_UNAVAILABLE':
      return 'The email provider could not be reached. Please try again later or email me directly.'
    case 'CONTACT_RATE_LIMITED':
      return payload.error
    default:
      return typeof payload?.error === 'string'
        ? payload.error
        : `The contact service returned an unexpected response (HTTP ${status}). Please try again later or email me directly.`
  }
}

// Returns one of:
//   { status: 'sent' }           endpoint confirmed provider acceptance
//   { status: 'error', message } validation, delivery, or network failed
export async function sendContactMessage(values) {
  try {
    const res = await fetch(CONTACT_ENDPOINT, {
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
        message: responseError(payload, res.status),
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

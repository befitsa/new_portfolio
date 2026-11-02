import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { z } from 'zod'

const RECIPIENT = 'befitsa123@gmail.com'
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_BODY_BYTES = 16 * 1024
const emailPattern = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]{2,}$/
const safeHeaderText = /^[^\u0000-\u001f\u007f]+$/

const messageSchema = z.object({
  name: z.string().trim().min(2).max(120).regex(safeHeaderText),
  email: z.string().trim().min(3).max(254).regex(emailPattern),
  subject: z.string().trim().min(3).max(160).regex(safeHeaderText),
  message: z.string().trim().min(10).max(5000).refine((value) => !/[\u0000\u000b\u000c\u000e-\u001f\u007f]/.test(value)),
  website: z.string().max(300).optional().default(''),
})

function jsonResponse(status, payload, origin = '') {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Vary', 'Origin')
  }
  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers })
}

function allowedOrigin(request, configuredOrigins) {
  const origin = request.headers.get('origin')
  if (!origin) return ''
  let requestOrigin
  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    return null
  }
  const explicitlyAllowed = configuredOrigins.split(',').map((value) => value.trim()).filter(Boolean)
  return origin === requestOrigin || explicitlyAllowed.includes(origin) ? origin : null
}

function clientKey(ip) {
  return createHash('sha256').update(ip).digest('hex')
}

export async function consumeRateLimit(ip, store, now) {
  const key = clientKey(ip)
  const current = await store.get(key, { type: 'json' })
  const sameWindow = current && now - current.windowStartedAt < RATE_WINDOW_MS
  if (sameWindow && current.count >= RATE_LIMIT) return false
  await store.setJSON(key, {
    windowStartedAt: sameWindow ? current.windowStartedAt : now,
    count: sameWindow ? current.count + 1 : 1,
  })
  return true
}

export function createContactHandler({
  env = process.env,
  rateLimit = (ip, now) => consumeRateLimit(ip, getStore('portfolio-contact-rate-limits'), now),
  fetchImpl = fetch,
  now = () => new Date(),
  logger = console,
} = {}) {
  return async (request, context = {}) => {
    const origin = allowedOrigin(request, env.CONTACT_ALLOWED_ORIGINS || '')
    if (origin === null) return jsonResponse(403, { error: 'This website is not allowed to submit contact messages.' })
    if (request.method === 'OPTIONS') return jsonResponse(204, {}, origin)
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Use POST to send a message.' }, origin)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return jsonResponse(415, { error: 'Send the contact form as JSON.' }, origin)
    }

    const declaredLength = Number(request.headers.get('content-length') || 0)
    if (declaredLength > MAX_BODY_BYTES) return jsonResponse(413, { error: 'Your message is too large to submit.' }, origin)

    let rawBody
    try {
      rawBody = await request.text()
    } catch {
      return jsonResponse(400, { error: 'The contact form could not be read. Please try again.' }, origin)
    }
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: 'Your message is too large to submit.' }, origin)
    }

    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return jsonResponse(400, { error: 'The contact form contains invalid data.' }, origin)
    }
    const validated = messageSchema.safeParse(payload)
    if (!validated.success) {
      return jsonResponse(422, { error: 'Please check the name, email, subject, and message, then try again.' }, origin)
    }
    if (validated.data.website) {
      return jsonResponse(400, { error: 'The contact form could not be accepted.' }, origin)
    }

    const apiKey = env.RESEND_API_KEY
    const from = env.CONTACT_FROM_EMAIL
    if (!apiKey || !from) {
      logger.error('Contact email delivery is not configured.')
      return jsonResponse(503, { error: 'Email delivery is temporarily unavailable. Please try again later.' }, origin)
    }

    if (typeof context.ip !== 'string' || !context.ip) {
      logger.error('Contact rate limiting is unavailable because the client IP is missing.')
      return jsonResponse(503, { error: 'The message service is temporarily unavailable. Please try again later.' }, origin)
    }

    try {
      if (!await rateLimit(context.ip, now().getTime())) {
        return jsonResponse(429, { error: 'Too many messages were sent from this connection. Please try again later.' }, origin)
      }
    } catch (error) {
      logger.error('Contact rate-limit storage failed.', error)
      return jsonResponse(503, { error: 'The message service is temporarily unavailable. Please try again later.' }, origin)
    }

    const submittedAt = now().toISOString()
    const { name, email, subject, message } = validated.data
    const emailPayload = {
      from,
      to: [env.CONTACT_TO_EMAIL || RECIPIENT],
      reply_to: email,
      subject: `Portfolio Contact: ${subject}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Subject: ${subject}`,
        `Submitted: ${submittedAt}`,
        '',
        'Message:',
        message,
      ].join('\n'),
    }

    try {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(emailPayload),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) {
        logger.error('Resend rejected a contact email.', { status: response.status })
        return jsonResponse(502, { error: 'Email delivery failed. Please try again later or use the direct email link.' }, origin)
      }
      const result = await response.json()
      if (typeof result?.id !== 'string' || !result.id) {
        logger.error('Resend returned a successful status without an email ID.')
        return jsonResponse(502, { error: 'Email delivery could not be confirmed. Please try again later.' }, origin)
      }
      return jsonResponse(200, { accepted: true }, origin)
    } catch (error) {
      logger.error('Contact email provider request failed.', { name: error?.name || 'Error' })
      return jsonResponse(502, { error: 'Email delivery failed. Please try again later or use the direct email link.' }, origin)
    }
  }
}

export default createContactHandler()

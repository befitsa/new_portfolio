import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { z } from 'zod'

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

function errorResponse(status, code, error, origin = '', details = {}) {
  return jsonResponse(status, { code, error, ...details }, origin)
}

function sanitizeProviderDetail(value) {
  if (typeof value !== 'string') return undefined
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:re_[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function providerErrorDetails(body) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return { message: sanitizeProviderDetail(body) }
  }
  const nested = parsed?.error && typeof parsed.error === 'object' ? parsed.error : null
  const name = parsed?.name || parsed?.type || nested?.name || nested?.type
  const code = parsed?.code || nested?.code
  const message = parsed?.message || nested?.message || (typeof parsed?.error === 'string' ? parsed.error : '')
  return {
    ...(typeof name === 'string' ? { name: sanitizeProviderDetail(name) } : {}),
    ...(typeof code === 'string' ? { code: sanitizeProviderDetail(code) } : {}),
    ...(typeof message === 'string' ? { message: sanitizeProviderDetail(message) } : {}),
  }
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
    const requestId = typeof context.requestId === 'string' ? context.requestId : undefined
    logger.info('Contact function invoked.', { method: request.method, requestId })
    logger.info('Contact email configuration presence.', {
      hasResendApiKey: Boolean(env.RESEND_API_KEY),
      hasContactFromEmail: Boolean(env.CONTACT_FROM_EMAIL),
      hasContactToEmail: Boolean(env.CONTACT_TO_EMAIL),
      requestId,
    })

    const origin = allowedOrigin(request, env.CONTACT_ALLOWED_ORIGINS || '')
    if (origin === null) return errorResponse(403, 'CONTACT_ORIGIN_REJECTED', 'This website is not allowed to submit contact messages.')
    if (request.method === 'OPTIONS') return jsonResponse(204, {}, origin)
    if (request.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST to send a message.', origin)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return errorResponse(415, 'UNSUPPORTED_CONTENT_TYPE', 'Send the contact form as JSON.', origin)
    }

    const declaredLength = Number(request.headers.get('content-length') || 0)
    if (declaredLength > MAX_BODY_BYTES) return errorResponse(413, 'REQUEST_TOO_LARGE', 'Your message is too large to submit.', origin)

    let rawBody
    try {
      rawBody = await request.text()
    } catch {
      return errorResponse(400, 'REQUEST_BODY_UNREADABLE', 'The contact form could not be read. Please try again.', origin)
    }
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return errorResponse(413, 'REQUEST_TOO_LARGE', 'Your message is too large to submit.', origin)
    }

    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'The contact form contains invalid data.', origin)
    }
    const validated = messageSchema.safeParse(payload)
    if (!validated.success) {
      logger.info('Contact request validation failed.', { issueCount: validated.error.issues.length, requestId })
      return errorResponse(422, 'CONTACT_VALIDATION_FAILED', 'Please check the name, email, subject, and message, then try again.', origin)
    }
    if (validated.data.website) {
      logger.info('Contact request rejected by honeypot.', { requestId })
      return errorResponse(400, 'CONTACT_REJECTED', 'The contact form could not be accepted.', origin)
    }

    const apiKey = env.RESEND_API_KEY
    const from = env.CONTACT_FROM_EMAIL
    const to = env.CONTACT_TO_EMAIL
    if (!apiKey || !from || !to) {
      logger.error('Contact email delivery configuration is incomplete.', {
        hasResendApiKey: Boolean(apiKey),
        hasContactFromEmail: Boolean(from),
        hasContactToEmail: Boolean(to),
        requestId,
      })
      return errorResponse(503, 'CONTACT_CONFIGURATION_INCOMPLETE', 'Email delivery is temporarily unavailable because its server configuration is incomplete.', origin)
    }

    if (typeof context.ip !== 'string' || !context.ip) {
      logger.error('Contact rate limiting is unavailable because the client IP is missing.', { requestId })
      return errorResponse(503, 'CONTACT_RATE_LIMIT_UNAVAILABLE', 'The message service is temporarily unavailable. Please try again later.', origin)
    }

    try {
      if (!await rateLimit(context.ip, now().getTime())) {
        return errorResponse(429, 'CONTACT_RATE_LIMITED', 'Too many messages were sent from this connection. Please try again later.', origin)
      }
    } catch (error) {
      logger.error('Contact rate-limit storage failed.', { name: error?.name || 'Error', requestId })
      return errorResponse(503, 'CONTACT_RATE_LIMIT_UNAVAILABLE', 'The message service is temporarily unavailable. Please try again later.', origin)
    }

    const submittedAt = now().toISOString()
    const { name, email, subject, message } = validated.data
    const emailPayload = {
      from,
      to: [to],
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
      logger.info('Sending contact message to Resend.', { requestId })
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
      logger.info('Resend responded to contact message.', { status: response.status, requestId })
      const responseBody = await response.text()
      if (!response.ok) {
        logger.error('Resend rejected a contact email.', {
          status: response.status,
          provider: providerErrorDetails(responseBody),
          requestId,
        })
        return errorResponse(502, 'EMAIL_PROVIDER_REJECTED', 'The email provider rejected the message. Please try again later or use the direct email link.', origin, { providerStatus: response.status })
      }
      let result
      try {
        result = JSON.parse(responseBody)
      } catch {
        result = null
      }
      if (typeof result?.id !== 'string' || !result.id) {
        logger.error('Resend returned a successful status without an email ID.', {
          status: response.status,
          provider: providerErrorDetails(responseBody),
          requestId,
        })
        return errorResponse(502, 'EMAIL_PROVIDER_UNCONFIRMED', 'Email delivery could not be confirmed. Please try again later.', origin)
      }
      return jsonResponse(200, { accepted: true, requestId }, origin)
    } catch (error) {
      logger.error('Contact email provider request failed.', { name: error?.name || 'Error', requestId })
      return errorResponse(502, 'EMAIL_PROVIDER_UNAVAILABLE', 'The email provider could not be reached. Please try again later or use the direct email link.', origin)
    }
  }
}

export default createContactHandler()

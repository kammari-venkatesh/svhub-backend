import crypto from 'node:crypto'

/**
 * Validates or generates an HTTP Request/Correlation ID.
 *
 * Rules:
 * - Accepts incoming X-Request-Id or X-Correlation-Id header if safe (alphanumeric, hyphen, underscore, 1-64 chars).
 * - Generates crypto-random ID if absent or invalid.
 * - Attaches identifier to req.id and req.requestId.
 * - Always emits X-Request-Id on response headers.
 */
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/

export function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id']
  let finalId

  if (typeof incoming === 'string' && SAFE_REQUEST_ID_REGEX.test(incoming.trim())) {
    finalId = incoming.trim()
  } else {
    // Generate safe prefixed identifier: req_<timestamp>_<randomHex>
    finalId = `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
  }

  req.id = finalId
  req.requestId = finalId
  res.setHeader('X-Request-Id', finalId)

  next()
}

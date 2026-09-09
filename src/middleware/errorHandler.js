import { env } from '../config/env.js'

export function errorHandler(err, req, res, next) {
  // If response headers are already sent, delegate to default Express handler
  if (res.headersSent) {
    return next(err)
  }

  // Syntax error from malformed JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      code: 'invalid_json',
      message: 'Malformed JSON payload in request body.',
    })
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {}).map((e) => e.message)
    return res.status(400).json({
      success: false,
      code: 'validation_error',
      message: messages.join(', ') || 'Validation error',
      details: messages,
    })
  }

  // Mongoose invalid ObjectId
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    return res.status(400).json({
      success: false,
      code: 'malformed_id',
      message: `Invalid resource identifier: ${err.value}`,
    })
  }

  // MongoDB duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field'
    return res.status(409).json({
      success: false,
      code: 'duplicate_key',
      message: `An account or record with this ${field} already exists.`,
    })
  }

  // Generic internal server error
  console.error('Unhandled server error:', err)

  const isDev = env.NODE_ENV === 'development'
  return res.status(err.status || 500).json({
    success: false,
    code: err.code || 'server_error',
    message: isDev ? err.message : 'Something went wrong. Please try again.',
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  })
}

import { env } from '../config/env.js'

export function requestLogger(req, res, next) {
  if (env.NODE_ENV === 'test') {
    return next()
  }

  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    const method = req.method
    const url = req.originalUrl || req.url

    // Safe formatting - never log request bodies containing passwords, tokens, etc.
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : status >= 300 ? '\x1b[36m' : '\x1b[32m'
    const reset = '\x1b[0m'

    console.log(`${method} ${url} ${color}${status}${reset} - ${duration}ms`)
  })

  next()
}

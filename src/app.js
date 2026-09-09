import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { requestLogger } from './middleware/requestLogger.js'
import { apiRouter } from './routes/index.js'

const app = express()

// Security Baseline Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})

// CORS Configuration
const allowedOrigins = [
  env.CLIENT_ORIGIN,
  env.CLIENT_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
        return callback(null, true)
      }
      return callback(new Error('Blocked by CORS policy'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  }),
)

// Body Parsers with safe payload limits
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// Request Logger (never logs sensitive data)
app.use(requestLogger)

// Mount Centralized API Router
app.use('/api', apiRouter)

// Direct root health ping
app.get('/health', (req, res) => {
  res.redirect(301, '/api/health')
})

// 404 Not Found Handler
app.use(notFound)

// Global Centralized Error Handler
app.use(errorHandler)

export { app }

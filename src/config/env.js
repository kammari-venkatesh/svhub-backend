import 'dotenv/config'

function resolveMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI
  if (process.env.MONGO_URI) return process.env.MONGO_URI

  const user = process.env.DB_USERNAME
  const password = process.env.DB_PASSWORD
  if (user && password) {
    return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@cluster0.mqh7sqq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
  }

  return ''
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 5000,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  CLIENT_URL: process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  MONGODB_URI: resolveMongoUri(),
  MONGO_DB: process.env.MONGO_DB || 'svhub',
  JWT_SECRET: process.env.JWT_SECRET || '',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY || '',
  // Planned Razorpay credentials (documented for Phase 1.3):
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
}

export function validateEnv() {
  const missing = []

  if (!env.MONGODB_URI) {
    missing.push('MONGODB_URI (or MONGO_URI, or DB_USERNAME + DB_PASSWORD)')
  } else if (env.MONGODB_URI.includes('<db_password>') || env.MONGODB_URI.includes('<DB_PASSWORD>')) {
    missing.push('Valid password inside MONGODB_URI (contains placeholder <db_password>)')
  }

  if (!env.JWT_SECRET || env.JWT_SECRET === 'change-me') {
    missing.push('JWT_SECRET (must be set and different from "change-me")')
  }

  if (missing.length > 0) {
    throw new Error(`Environment validation failed. Missing or invalid variables:\n - ${missing.join('\n - ')}`)
  }
}

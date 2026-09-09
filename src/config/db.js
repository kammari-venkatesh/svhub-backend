import mongoose from 'mongoose'
import dns from 'node:dns'
import { env } from './env.js'

// Fallback to Google/Cloudflare public DNS if local ISP DNS fails on MongoDB SRV records
try {
  dns.setServers(['8.8.8.8', '1.1.1.1'])
} catch {
  // Ignore if not permitted
}

const states = ['disconnected', 'connected', 'connecting', 'disconnecting']

export function dbStatus() {
  return states[mongoose.connection.readyState] ?? 'unknown'
}

function maskMongoUri(uri = '') {
  try {
    return uri.replace(/\/\/(.*?)@/, '//***:***@')
  } catch {
    return 'mongodb://***'
  }
}

export async function connectDb() {
  const uri = env.MONGODB_URI

  if (!uri) {
    throw new Error('Database connection failed: MONGODB_URI is not set')
  }

  if (uri.includes('<db_password>') || uri.includes('<DB_PASSWORD>')) {
    throw new Error('Database connection failed: Please replace <db_password> placeholder in .env')
  }

  mongoose.set('strictQuery', true)

  // Attach event listeners for health and connection state
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message)
  })

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected. Reconnecting...')
  })

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected successfully')
  })

  await mongoose.connect(uri, {
    dbName: env.MONGO_DB,
  })

  const { name, host } = mongoose.connection
  console.log(`MongoDB connected: ${name || env.MONGO_DB} on ${host} (${maskMongoUri(uri)})`)
}

export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
    console.log('MongoDB connection closed')
  }
}

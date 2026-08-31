import mongoose from 'mongoose'

const states = ['disconnected', 'connected', 'connecting', 'disconnecting']

export function dbStatus() {
  return states[mongoose.connection.readyState] ?? 'unknown'
}

function resolveUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI

  const user = process.env.DB_USERNAME
  const password = process.env.DB_PASSWORD
  if (user && password) {
    return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@cluster0.mqh7sqq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
  }

  return ''
}

export async function connectDb() {
  const uri = resolveUri()

  if (!uri) {
    throw new Error('MONGO_URI is not set')
  }

  if (uri.includes('<db_password>') || uri.includes('<DB_PASSWORD>')) {
    throw new Error('Set DB_PASSWORD and a complete MONGO_URI in backend/.env')
  }

  const dbName = process.env.MONGO_DB || 'svhub'

  mongoose.set('strictQuery', true)

  await mongoose.connect(uri, { dbName })

  const { name, host } = mongoose.connection
  console.log(`MongoDB connected (${name || 'default'} @ ${host})`)
}

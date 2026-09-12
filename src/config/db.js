import mongoose from 'mongoose'
import dns from 'node:dns'
import { env } from './env.js'

/**
 * Local/ISP DNS on this machine intermittently fails Atlas host lookups
 * (ENOTFOUND → shop shows "Products could not be loaded").
 * Route MongoDB DNS through public resolvers while keeping hostnames for TLS/SNI.
 */
const publicResolver = new dns.Resolver()
try {
  publicResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // Ignore if not permitted
}

function isMongoHost(hostname = '') {
  return hostname.includes('mongodb.net') || hostname.includes('mongodb.com')
}

const originalLookup = dns.lookup.bind(dns)
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }

  if (!isMongoHost(hostname)) {
    return originalLookup(hostname, options, callback)
  }

  publicResolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) {
      return originalLookup(hostname, options, callback)
    }
    const family = 4
    const address = addresses[0]
    if (options && options.all) {
      callback(null, addresses.map((addr) => ({ address: addr, family })))
      return
    }
    callback(null, address, family)
  })
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

/**
 * Resolve mongodb+srv to hostname-based mongodb:// URI via public DNS SRV/TXT.
 * Keeps shard hostnames (required for Atlas TLS SNI) but avoids flaky local SRV.
 */
async function resolveSrvToHostnameUri(srvUri) {
  const parsed = new URL(srvUri)
  if (parsed.protocol !== 'mongodb+srv:') return srvUri

  const hostname = parsed.hostname
  const auth =
    parsed.username || parsed.password
      ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}@`
      : ''

  const srvRecords = await new Promise((resolve, reject) => {
    publicResolver.resolveSrv(`_mongodb._tcp.${hostname}`, (err, records) => {
      if (err) reject(err)
      else resolve(records || [])
    })
  })

  if (!srvRecords.length) {
    throw new Error(`No SRV records found for ${hostname}`)
  }

  const hosts = srvRecords.map((record) => `${record.name}:${record.port || 27017}`)

  let txtParams = ''
  try {
    const txt = await new Promise((resolve, reject) => {
      publicResolver.resolveTxt(hostname, (err, records) => {
        if (err) reject(err)
        else resolve(records || [])
      })
    })
    txtParams = txt.flat().join('').trim()
  } catch {
    // optional
  }

  const search = new URLSearchParams(parsed.search)
  if (txtParams) {
    for (const part of txtParams.split('&')) {
      const [key, value] = part.split('=')
      if (key && value && !search.has(key)) search.set(key, value)
    }
  }
  search.set('tls', 'true')
  search.set('retryWrites', search.get('retryWrites') || 'true')
  search.set('w', search.get('w') || 'majority')

  return `mongodb://${auth}${hosts.join(',')}/?${search.toString()}`
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

  mongoose.connection.removeAllListeners('error')
  mongoose.connection.removeAllListeners('disconnected')
  mongoose.connection.removeAllListeners('reconnected')

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err.message)
  })

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected. Reconnecting...')
  })

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected successfully')
  })

  let connectUri = uri
  try {
    connectUri = await resolveSrvToHostnameUri(uri)
    if (connectUri !== uri) {
      console.log('MongoDB: SRV resolved via public DNS (hostname URI, TLS/SNI intact)')
    }
  } catch (error) {
    console.warn(`MongoDB SRV pre-resolve failed (${error.message}); falling back to driver SRV`)
    connectUri = uri
  }

  await mongoose.connect(connectUri, {
    dbName: env.MONGO_DB,
    family: 4,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 10000,
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

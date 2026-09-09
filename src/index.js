import { app } from './app.js'
import { connectDb, disconnectDb } from './config/db.js'
import { env, validateEnv } from './config/env.js'

// 1. Validate environment before boot (Firebase Admin credentials configured)
try {
  validateEnv()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

// 2. Connect to MongoDB
try {
  await connectDb()
} catch (error) {
  console.error(`MongoDB initialization failed: ${error.message}`)
  process.exit(1)
}

// 3. Start HTTP Server
const server = app.listen(env.PORT, () => {
  console.log(`SV Hub API server running on http://localhost:${env.PORT}`)
  console.log(`Environment: ${env.NODE_ENV}`)
})

// 4. Graceful Shutdown
async function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`)
  server.close(async () => {
    console.log('HTTP server closed')
    await disconnectDb()
    process.exit(0)
  })
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))

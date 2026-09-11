import mongoose from 'mongoose'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'

export default async function handler(req, res) {
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDb()
    } catch (err) {
      console.error('MongoDB connection error in Vercel handler:', err)
      return res.status(500).json({
        success: false,
        error: { code: 'database_connection_error', message: err.message },
      })
    }
  }
  return app(req, res)
}

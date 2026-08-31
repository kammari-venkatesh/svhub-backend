import { Router } from 'express'
import { dbStatus } from '../db.js'

const healthRouter = Router()

healthRouter.get('/', (req, res) => {
  const database = dbStatus()

  res.json({
    service: 'svhub-backend',
    status: database === 'connected' ? 'ok' : 'degraded',
    database,
  })
})

export { healthRouter }

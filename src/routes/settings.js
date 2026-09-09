import { Router } from 'express'
import { getPublicSettings } from '../controllers/settingsController.js'

const settingsRouter = Router()

// Public Store Configuration Endpoint
settingsRouter.get('/public', getPublicSettings)

export { settingsRouter }

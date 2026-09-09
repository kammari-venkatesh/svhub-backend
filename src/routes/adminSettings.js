import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getAdminSettings,
  updateAdminSettings,
} from '../controllers/adminSettingsController.js'

const adminSettingsRouter = Router()

// All administrative settings endpoints require valid JWT and ADMIN role
adminSettingsRouter.use(requireAuth, requireAdmin)

// GET /api/admin/settings
adminSettingsRouter.get('/', getAdminSettings)

// PATCH /api/admin/settings
adminSettingsRouter.patch('/', updateAdminSettings)

export { adminSettingsRouter }

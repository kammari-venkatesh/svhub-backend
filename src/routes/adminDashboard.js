import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { getAdminDashboard } from '../controllers/adminDashboardController.js'

const adminDashboardRouter = Router()

// All dashboard endpoints strictly require valid JWT and ADMIN role
adminDashboardRouter.use(requireAuth, requireAdmin)

// GET /api/admin/dashboard
adminDashboardRouter.get('/', getAdminDashboard)

export { adminDashboardRouter }

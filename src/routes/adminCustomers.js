import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getAdminCustomers,
  getAdminCustomerById,
  updateAdminCustomer,
} from '../controllers/adminCustomerController.js'
import { adminMutationRateLimiter } from '../middleware/rateLimiter.js'

const adminCustomersRouter = Router()

// Strictly protected by authentication and administrator role
adminCustomersRouter.use(requireAuth, requireAdmin)

// GET /api/admin/customers
adminCustomersRouter.get('/', getAdminCustomers)

// GET /api/admin/customers/:id
adminCustomersRouter.get('/:id', getAdminCustomerById)

// PATCH /api/admin/customers/:id
adminCustomersRouter.patch('/:id', adminMutationRateLimiter, updateAdminCustomer)

export { adminCustomersRouter }

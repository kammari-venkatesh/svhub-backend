import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getAdminOrders,
  getAdminOrderById,
  updateAdminOrder,
  cancelAdminOrder,
} from '../controllers/adminOrderController.js'

const adminOrdersRouter = Router()

// All admin order endpoints require valid JWT authentication and ADMIN role
adminOrdersRouter.use(requireAuth, requireAdmin)

// GET /api/admin/orders - List orders with filtering, search, pagination, sorting
adminOrdersRouter.get('/', getAdminOrders)

// GET /api/admin/orders/:id - Get administrative view of order details
adminOrdersRouter.get('/:id', getAdminOrderById)

// PATCH /api/admin/orders/:id - Update order status, payment status, tracking, courier, notes
adminOrdersRouter.patch('/:id', updateAdminOrder)

// POST /api/admin/orders/:id/cancel - Cancel order with mandatory reason
adminOrdersRouter.post('/:id/cancel', cancelAdminOrder)

export { adminOrdersRouter }

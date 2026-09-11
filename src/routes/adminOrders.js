import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getAdminOrders,
  getAdminOrderById,
  updateAdminOrder,
  cancelAdminOrder,
  reconcileAdminOrder,
  refundAdminOrder,
  reconcileAdminRefund,
} from '../controllers/adminOrderController.js'
import {
  adminRefundRateLimiter,
  adminMutationRateLimiter,
} from '../middleware/rateLimiter.js'

const adminOrdersRouter = Router()

// All admin order endpoints require valid JWT authentication and ADMIN role
adminOrdersRouter.use(requireAuth, requireAdmin)

// GET /api/admin/orders - List orders with filtering, search, pagination, sorting
adminOrdersRouter.get('/', getAdminOrders)

// GET /api/admin/orders/:id - Get administrative view of order details
adminOrdersRouter.get('/:id', getAdminOrderById)

// PATCH /api/admin/orders/:id - Update order status, payment status, tracking, courier, notes
adminOrdersRouter.patch('/:id', adminMutationRateLimiter, updateAdminOrder)

// POST /api/admin/orders/:id/cancel - Cancel order with mandatory reason
adminOrdersRouter.post('/:id/cancel', adminMutationRateLimiter, cancelAdminOrder)

// POST /api/admin/orders/:id/reconcile - Trigger administrative payment reconciliation
adminOrdersRouter.post('/:id/reconcile', adminMutationRateLimiter, reconcileAdminOrder)

// POST /api/admin/orders/:id/refund - Initiate full or partial refund on order (Phase 2.4E)
adminOrdersRouter.post('/:id/refund', adminRefundRateLimiter, refundAdminOrder)

// POST /api/admin/orders/:id/refunds/:refundId/reconcile - Reconcile specific refund record (Phase 2.4E)
adminOrdersRouter.post('/:id/refunds/:refundId/reconcile', adminMutationRateLimiter, reconcileAdminRefund)

export { adminOrdersRouter }

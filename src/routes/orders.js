import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  createOrder,
  getCustomerOrders,
  getCustomerOrderById,
  cancelCustomerOrder,
} from '../controllers/orderController.js'
import { requestCustomerRefund } from '../controllers/refundController.js'
import {
  customerRefundRateLimiter,
  orderCreateRateLimiter,
  orderCancelRateLimiter,
} from '../middleware/rateLimiter.js'

const ordersRouter = Router()

// All order endpoints require authenticated customer session
ordersRouter.use(requireAuth)

ordersRouter.post('/', orderCreateRateLimiter, createOrder)
ordersRouter.get('/', getCustomerOrders)
ordersRouter.get('/:id', getCustomerOrderById)

// Customer-initiated cancellation on order (Phase 2.4F & 2.4G)
ordersRouter.post('/:id/cancel', orderCancelRateLimiter, cancelCustomerOrder)

// Customer-initiated refund on order (Phase 2.4E)
ordersRouter.post('/:id/refund', customerRefundRateLimiter, requestCustomerRefund)

export { ordersRouter }

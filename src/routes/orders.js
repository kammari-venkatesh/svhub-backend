import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  createOrder,
  getCustomerOrders,
  getCustomerOrderById,
} from '../controllers/orderController.js'

const ordersRouter = Router()

// All order endpoints require authenticated customer session
ordersRouter.use(requireAuth)

ordersRouter.post('/', createOrder)
ordersRouter.get('/', getCustomerOrders)
ordersRouter.get('/:id', getCustomerOrderById)

export { ordersRouter }

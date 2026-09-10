import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  recordPaymentFailure,
} from '../controllers/paymentController.js'

const paymentsRouter = Router()

// All payment routes strictly require user authentication
paymentsRouter.use(requireAuth)

// Razorpay Payment Endpoints
paymentsRouter.post('/razorpay/create-order', createRazorpayOrder)
paymentsRouter.post('/razorpay/verify', verifyRazorpayPayment)
paymentsRouter.post('/razorpay/record-failure', recordPaymentFailure)

export { paymentsRouter }

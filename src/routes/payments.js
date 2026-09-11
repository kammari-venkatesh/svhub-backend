import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  recordPaymentFailure,
} from '../controllers/paymentController.js'
import { handleRazorpayWebhook } from '../controllers/webhookController.js'
import {
  paymentCreateRateLimiter,
  paymentVerifyRateLimiter,
  paymentFailureRateLimiter,
  webhookRateLimiter,
} from '../middleware/rateLimiter.js'

const paymentsRouter = Router()

// Public Server-to-Server Webhook Endpoint (Protected via X-Razorpay-Signature)
// Must NOT be gated by customer JWT requireAuth
paymentsRouter.post('/razorpay/webhook', webhookRateLimiter, handleRazorpayWebhook)

// Customer-facing payment routes strictly require user authentication
paymentsRouter.use(requireAuth)

// Razorpay Customer Payment Endpoints with Rate Limiting (Phase 2.4D)
paymentsRouter.post('/razorpay/create-order', paymentCreateRateLimiter, createRazorpayOrder)
paymentsRouter.post('/razorpay/verify', paymentVerifyRateLimiter, verifyRazorpayPayment)
paymentsRouter.post('/razorpay/record-failure', paymentFailureRateLimiter, recordPaymentFailure)

export { paymentsRouter }


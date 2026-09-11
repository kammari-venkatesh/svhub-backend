import mongoose from 'mongoose'
import { Order } from '../models/Order.js'
import { Payment } from '../models/Payment.js'
import { WebhookEvent } from '../models/WebhookEvent.js'
import {
  getRazorpayClient,
  isRazorpayConfigured,
} from '../config/razorpay.js'
import {
  fulfillRazorpayPayment,
  recordWebhookPaymentFailure,
} from './paymentFulfillmentService.js'

/**
 * Authoritative Gateway Error & Status Classifications (Phase 2.4D)
 */
export const GATEWAY_CLASSIFICATION = {
  SUCCESS_CONFIRMED: 'SUCCESS_CONFIRMED',
  FAILED_CONFIRMED: 'FAILED_CONFIRMED',
  NOT_FOUND_CONFIRMED: 'NOT_FOUND_CONFIRMED',
  AUTHORIZED_UNCONFIRMED: 'AUTHORIZED_UNCONFIRMED',
  RETRYABLE_ERROR: 'RETRYABLE_ERROR',
  PERMANENT_ERROR: 'PERMANENT_ERROR',
  UNKNOWN: 'UNKNOWN',
}

/**
 * Classifies an error thrown during a Razorpay gateway API call.
 * CRITICAL RULE: A network error, timeout, or 5xx is NEVER classified as payment failure.
 *
 * @param {Error|Object} err
 * @returns {{ classification: string, retryable: boolean, statusCode: number, reason: string }}
 */
export function classifyGatewayError(err) {
  if (!err) {
    return {
      classification: GATEWAY_CLASSIFICATION.UNKNOWN,
      retryable: false,
      statusCode: 500,
      reason: 'Unknown error occurred',
    }
  }

  const statusCode = err.statusCode || err.status || (err.error && err.error.code === 'BAD_REQUEST_ERROR' ? 400 : 500)
  const message = String(err.message || err.error?.description || err.description || '').toLowerCase()
  const code = String(err.code || err.error?.code || '').toUpperCase()

  // 1. Transient Network / Timeout / Gateway 5xx -> RETRYABLE_ERROR
  const isNetworkTimeout =
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENOTFOUND' ||
    message.includes('timeout') ||
    message.includes('socket hung up') ||
    message.includes('econnreset') ||
    message.includes('network') ||
    statusCode === 504 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 500

  if (isNetworkTimeout) {
    return {
      classification: GATEWAY_CLASSIFICATION.RETRYABLE_ERROR,
      retryable: true,
      statusCode: statusCode >= 500 ? statusCode : 502,
      reason: `Transient gateway error: ${err.message || code || 'Timeout/Unavailable'}`,
    }
  }

  // 2. Explicit 404 / Entity Not Found -> NOT_FOUND_CONFIRMED
  if (
    statusCode === 404 ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    (code === 'BAD_REQUEST_ERROR' && message.includes('id does not exist'))
  ) {
    return {
      classification: GATEWAY_CLASSIFICATION.NOT_FOUND_CONFIRMED,
      retryable: false,
      statusCode: 404,
      reason: 'Entity not found on payment gateway',
    }
  }

  // 3. Client configuration or validation error -> PERMANENT_ERROR
  return {
    classification: GATEWAY_CLASSIFICATION.PERMANENT_ERROR,
    retryable: false,
    statusCode: statusCode || 400,
    reason: err.message || 'Permanent gateway error',
  }
}

/**
 * Calculates exponential backoff with jitter.
 *
 * @param {number} attempt
 * @param {number} [baseMs=1000]
 * @param {number} [maxMs=60000]
 * @returns {number}
 */
export function calculateBackoff(attempt = 1, baseMs = 1000, maxMs = 60000) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)))
  const jitter = Math.floor(Math.random() * (exp * 0.2))
  return exp + jitter
}

/**
 * Server-Side Razorpay Payment Reconciliation.
 * Queries Razorpay authoritative order/payment state and fulfills or records failure.
 *
 * @param {Object} params
 * @param {string} [params.orderId]
 * @param {string} [params.razorpayOrderId]
 * @param {boolean} [params.force=false]
 * @param {Object} [params.user=null] - If called by customer, enforce ownership
 * @returns {Promise<{success: boolean, reconciled: boolean, idempotent?: boolean, order?: Object, payment?: Object, classification: string, message: string}>}
 */
export async function reconcileOrderPayment({
  orderId = null,
  razorpayOrderId = null,
  force = false,
  user = null,
}) {
  // 1. Resolve local Order
  let order = null
  if (orderId && mongoose.isValidObjectId(orderId)) {
    order = await Order.findById(orderId)
  }
  if (!order && razorpayOrderId) {
    order = await Order.findOne({ razorpayOrderId })
  }
  if (!order && razorpayOrderId) {
    const p = await Payment.findOne({ razorpayOrderId })
    if (p?.orderId) {
      order = await Order.findById(p.orderId)
    }
  }

  if (!order) {
    return {
      success: false,
      reconciled: false,
      classification: GATEWAY_CLASSIFICATION.NOT_FOUND_CONFIRMED,
      message: 'Local order record not found for reconciliation.',
    }
  }

  // 2. Ownership boundary check if called on behalf of a user
  if (user && String(order.userId) !== String(user._id || user.id)) {
    return {
      success: false,
      reconciled: false,
      classification: GATEWAY_CLASSIFICATION.PERMANENT_ERROR,
      message: 'Unauthorized: Cannot reconcile another customer\'s order.',
    }
  }

  // 3. Resolve local Payment
  const rzpOrderId = razorpayOrderId || order.razorpayOrderId
  const payment =
    (await Payment.findOne({ orderId: order._id, ...(rzpOrderId ? { razorpayOrderId: rzpOrderId } : {}) })) ||
    (await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 }))

  // 4. Fast path: Already confirmed and fully fulfilled
  if (
    order.status === 'CONFIRMED' &&
    (order.paymentStatus === 'SUCCESS' || order.paymentStatus === 'PAID')
  ) {
    return {
      success: true,
      reconciled: true,
      idempotent: true,
      order,
      payment,
      classification: GATEWAY_CLASSIFICATION.SUCCESS_CONFIRMED,
      message: 'Order is already confirmed and fulfilled.',
    }
  }

  // If no gateway order ID exists yet, cannot reconcile against Razorpay
  if (!rzpOrderId || rzpOrderId.startsWith('CREATING_')) {
    return {
      success: false,
      reconciled: false,
      classification: GATEWAY_CLASSIFICATION.UNKNOWN,
      message: 'No active Razorpay order ID exists on this order.',
    }
  }

  // 5. Query Razorpay API
  let rzpPaymentsList = []
  let fetchError = null

  if (isRazorpayConfigured() && process.env.SKIP_RZP_FETCH !== 'true') {
    try {
      const razorpay = getRazorpayClient()
      if (typeof razorpay.orders?.fetchPayments === 'function') {
        const resp = await razorpay.orders.fetchPayments(rzpOrderId)
        rzpPaymentsList = resp?.items || resp || []
      } else if (payment?.razorpayPaymentId && typeof razorpay.payments?.fetch === 'function') {
        const p = await razorpay.payments.fetch(payment.razorpayPaymentId)
        if (p) rzpPaymentsList = [p]
      }
    } catch (err) {
      fetchError = err
    }
  }

  // Handle gateway errors
  if (fetchError) {
    const errorAnalysis = classifyGatewayError(fetchError)

    if (payment) {
      payment.reconciliationAttempts = (payment.reconciliationAttempts || 0) + 1
      payment.lastReconciledAt = new Date()
      await payment.save().catch(() => {})
    }

    // Never mark payment failed due to transient gateway error
    return {
      success: false,
      reconciled: false,
      classification: errorAnalysis.classification,
      retryable: errorAnalysis.retryable,
      statusCode: errorAnalysis.statusCode,
      message: errorAnalysis.reason,
    }
  }

  // Normalize payments list
  if (!Array.isArray(rzpPaymentsList) && rzpPaymentsList && typeof rzpPaymentsList === 'object') {
    rzpPaymentsList = [rzpPaymentsList]
  }

  // 6. Look for a captured payment among gateway payments
  const capturedPayment = rzpPaymentsList.find(
    (p) => p && (p.status === 'captured' || p.captured === true)
  )

  if (capturedPayment) {
    // Upstream captured payment found! Delegate to shared atomic fulfillment
    const expectedPaise = Math.round(order.totalAmount * 100)
    if (capturedPayment.amount && Number(capturedPayment.amount) !== expectedPaise) {
      // Flag anomaly: captured amount does not match authoritative order total
      if (payment) {
        payment.status = 'REQUIRES_RECONCILIATION'
        payment.reconciliationReason = `Amount mismatch during reconciliation: expected ${expectedPaise}, got ${capturedPayment.amount}`
        payment.reconciliationAttempts = (payment.reconciliationAttempts || 0) + 1
        payment.lastReconciledAt = new Date()
        await payment.save().catch(() => {})
      }
      order.status = 'REQUIRES_RECONCILIATION'
      order.paymentStatus = 'REQUIRES_RECONCILIATION'
      await order.save().catch(() => {})

      return {
        success: false,
        reconciled: false,
        classification: GATEWAY_CLASSIFICATION.PERMANENT_ERROR,
        message: 'Reconciliation failed: Gateway captured amount does not match order amount.',
      }
    }

    // Call atomic fulfillment service
    const fulfillRes = await fulfillRazorpayPayment({
      orderId: order._id,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: capturedPayment.id,
      amount: order.totalAmount,
      isWebhook: true,
      gatewayPayment: capturedPayment,
    })

    if (payment) {
      payment.reconciliationAttempts = (payment.reconciliationAttempts || 0) + 1
      payment.lastReconciledAt = new Date()
      await payment.save().catch(() => {})
    }

    return {
      success: fulfillRes.success,
      reconciled: true,
      idempotent: fulfillRes.idempotent || false,
      order: fulfillRes.order || order,
      payment: fulfillRes.payment || payment,
      classification: GATEWAY_CLASSIFICATION.SUCCESS_CONFIRMED,
      message: fulfillRes.message || 'Payment successfully reconciled and fulfilled.',
    }
  }

  // 7. Check for failed payment
  const failedPayment = rzpPaymentsList.find((p) => p && p.status === 'failed')
  if (failedPayment && rzpPaymentsList.length === 1) {
    // Gateway explicitly confirmed failure
    await recordWebhookPaymentFailure({
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: failedPayment.id,
      errorReason: failedPayment.error_description || 'Payment failed at gateway',
      errorCode: failedPayment.error_code || 'BAD_REQUEST_ERROR',
    })

    if (payment) {
      payment.reconciliationAttempts = (payment.reconciliationAttempts || 0) + 1
      payment.lastReconciledAt = new Date()
      await payment.save().catch(() => {})
    }

    const refreshedOrder = await Order.findById(order._id)
    return {
      success: true,
      reconciled: true,
      order: refreshedOrder,
      classification: GATEWAY_CLASSIFICATION.FAILED_CONFIRMED,
      message: 'Gateway confirmed payment failure; recorded locally.',
    }
  }

  // 8. Check for authorized payment
  const authorizedPayment = rzpPaymentsList.find((p) => p && p.status === 'authorized')
  if (authorizedPayment) {
    if (payment) {
      payment.status = 'PENDING'
      payment.gatewayStatus = 'authorized'
      payment.reconciliationAttempts = (payment.reconciliationAttempts || 0) + 1
      payment.lastReconciledAt = new Date()
      await payment.save().catch(() => {})
    }
    return {
      success: false,
      reconciled: false,
      retryable: true,
      classification: GATEWAY_CLASSIFICATION.AUTHORIZED_UNCONFIRMED,
      message: 'Payment is authorized but not yet captured by Razorpay.',
    }
  }

  // 9. No payments recorded at gateway yet
  if (payment) {
    payment.reconciliationAttempts = (payment.reconciliationAttempts || 0) + 1
    payment.lastReconciledAt = new Date()
    await payment.save().catch(() => {})
  }

  return {
    success: false,
    reconciled: false,
    retryable: true,
    classification: GATEWAY_CLASSIFICATION.UNKNOWN,
    message: 'No confirmed payments found at gateway for this order.',
  }
}

/**
 * Recovers stale payments stuck in CREATED or PENDING states.
 *
 * @param {Object} [options]
 * @param {number} [options.staleThresholdMs=15*60*1000] - Age in ms to consider stale (default: 15 min)
 * @param {number} [options.limit=20] - Maximum payments to scan per cycle
 * @returns {Promise<{scanned: number, reconciled: number, retryable: number, failed: number, results: Array}>}
 */
export async function recoverStalePayments({
  staleThresholdMs = 15 * 60 * 1000,
  limit = 20,
} = {}) {
  const staleCutoff = new Date(Date.now() - staleThresholdMs)

  // Find payments stuck in non-terminal states older than staleCutoff
  const stalePayments = await Payment.find({
    status: { $in: ['CREATED', 'PENDING', 'REQUIRES_RECONCILIATION'] },
    razorpayOrderId: { $exists: true, $ne: null, $not: /^CREATING_/ },
    updatedAt: { $lt: staleCutoff },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)

  const summary = {
    scanned: stalePayments.length,
    reconciled: 0,
    retryable: 0,
    failed: 0,
    results: [],
  }

  for (const payment of stalePayments) {
    try {
      const res = await reconcileOrderPayment({
        orderId: payment.orderId,
        razorpayOrderId: payment.razorpayOrderId,
      })

      if (res.reconciled) {
        summary.reconciled++
      } else if (res.retryable) {
        summary.retryable++
      } else {
        summary.failed++
      }

      summary.results.push({
        paymentId: String(payment._id),
        orderId: String(payment.orderId),
        classification: res.classification,
        reconciled: res.reconciled,
      })
    } catch (err) {
      summary.failed++
      summary.results.push({
        paymentId: String(payment._id),
        error: err.message,
      })
    }
  }

  return summary
}

/**
 * Recovers stuck or retryable webhook events.
 * Uses atomic DB-level locking (`findOneAndUpdate` on `lockedAt`) to prevent double-processing.
 *
 * @param {Object} [options]
 * @param {number} [options.staleThresholdMs=5*60*1000] - Lock expiration in ms (default: 5 min)
 * @param {number} [options.limit=20]
 * @param {string} [options.ownerId='recovery-worker']
 * @returns {Promise<{claimed: number, processed: number, retryable: number, permanent: number, results: Array}>}
 */
export async function recoverStuckWebhookEvents({
  staleThresholdMs = 5 * 60 * 1000,
  limit = 20,
  ownerId = 'recovery-worker',
} = {}) {
  const staleLockCutoff = new Date(Date.now() - staleThresholdMs)
  const now = new Date()

  // Find candidate events:
  // 1. Stuck in PROCESSING with expired lock (process crashed)
  // 2. In FAILED_RETRYABLE whose nextRetryAt has arrived
  const candidates = await WebhookEvent.find({
    $or: [
      {
        status: 'PROCESSING',
        $or: [{ lockedAt: { $lt: staleLockCutoff } }, { lockedAt: null }],
      },
      {
        status: 'FAILED_RETRYABLE',
        $or: [{ nextRetryAt: { $lte: now } }, { nextRetryAt: null }],
        $or: [{ lockedAt: { $lt: staleLockCutoff } }, { lockedAt: null }],
      },
    ],
  })
    .sort({ receivedAt: 1 })
    .limit(limit)

  const summary = {
    claimed: 0,
    processed: 0,
    retryable: 0,
    permanent: 0,
    results: [],
  }

  for (const candidate of candidates) {
    // Atomic Claim using findOneAndUpdate with lock conditional
    const claimedEvent = await WebhookEvent.findOneAndUpdate(
      {
        _id: candidate._id,
        status: { $in: ['PROCESSING', 'FAILED_RETRYABLE'] },
        $or: [{ lockedAt: { $lt: staleLockCutoff } }, { lockedAt: null }],
      },
      {
        $set: {
          status: 'PROCESSING',
          lockedAt: new Date(),
          lockOwner: ownerId,
          lastAttemptAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    )

    if (!claimedEvent) {
      // Another worker/thread claimed this event; safely skip
      continue
    }

    summary.claimed++

    try {
      const payload = claimedEvent.payloadSummary || {}
      const eventType = claimedEvent.eventType

      if (eventType === 'payment.captured') {
        const rzpPaymentId = claimedEvent.razorpayPaymentId || payload.razorpayPaymentId
        const rzpOrderId = claimedEvent.razorpayOrderId || payload.razorpayOrderId

        if (!rzpOrderId || !rzpPaymentId) {
          claimedEvent.status = 'FAILED_PERMANENT'
          claimedEvent.error = 'Missing payment or order IDs in webhook event'
          claimedEvent.lockedAt = null
          await claimedEvent.save()
          summary.permanent++
          continue
        }

        const fulfillRes = await fulfillRazorpayPayment({
          orderId: claimedEvent.orderId,
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: rzpPaymentId,
          isWebhook: true,
          gatewayPayment: payload,
        })

        if (fulfillRes.success) {
          claimedEvent.status = 'PROCESSED'
          claimedEvent.processedAt = new Date()
          claimedEvent.error = null
          claimedEvent.lockedAt = null
          await claimedEvent.save()
          summary.processed++
        } else if (
          fulfillRes.errorCode === 'order_state_conflict' ||
          fulfillRes.errorCode === 'inventory_conflict'
        ) {
          claimedEvent.status = 'REQUIRES_RECONCILIATION'
          claimedEvent.reconciliationReason = fulfillRes.message
          claimedEvent.lockedAt = null
          await claimedEvent.save()
          summary.processed++
        } else {
          // Bounded retry
          if (claimedEvent.attempts >= 5) {
            claimedEvent.status = 'FAILED_PERMANENT'
            claimedEvent.error = `Max retry attempts (5) reached: ${fulfillRes.message}`
          } else {
            claimedEvent.status = 'FAILED_RETRYABLE'
            claimedEvent.nextRetryAt = new Date(Date.now() + calculateBackoff(claimedEvent.attempts))
            claimedEvent.error = fulfillRes.message
          }
          claimedEvent.lockedAt = null
          await claimedEvent.save()
          if (claimedEvent.status === 'FAILED_PERMANENT') summary.permanent++
          else summary.retryable++
        }
      } else if (eventType === 'payment.failed') {
        await recordWebhookPaymentFailure({
          razorpayOrderId: claimedEvent.razorpayOrderId,
          razorpayPaymentId: claimedEvent.razorpayPaymentId,
          errorReason: claimedEvent.error || 'Payment failed webhook recovery',
        })
        claimedEvent.status = 'PROCESSED'
        claimedEvent.processedAt = new Date()
        claimedEvent.lockedAt = null
        await claimedEvent.save()
        summary.processed++
      } else {
        claimedEvent.status = 'IGNORED'
        claimedEvent.lockedAt = null
        await claimedEvent.save()
        summary.processed++
      }

      summary.results.push({
        eventId: claimedEvent.eventId,
        status: claimedEvent.status,
      })
    } catch (processErr) {
      if (claimedEvent.attempts >= 5) {
        claimedEvent.status = 'FAILED_PERMANENT'
        claimedEvent.error = `Permanent failure after max attempts: ${processErr.message}`
        summary.permanent++
      } else {
        claimedEvent.status = 'FAILED_RETRYABLE'
        claimedEvent.nextRetryAt = new Date(Date.now() + calculateBackoff(claimedEvent.attempts))
        claimedEvent.error = processErr.message
        summary.retryable++
      }
      claimedEvent.lockedAt = null
      await claimedEvent.save().catch(() => {})

      summary.results.push({
        eventId: claimedEvent.eventId,
        error: processErr.message,
      })
    }
  }

  return summary
}

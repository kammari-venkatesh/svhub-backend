import { WebhookEvent } from '../models/WebhookEvent.js'
import {
  verifyRazorpayWebhookSignature,
} from '../config/razorpay.js'
import {
  fulfillRazorpayPayment,
  recordWebhookPaymentFailure,
} from '../services/paymentFulfillmentService.js'
import { processRefundWebhook } from '../services/refundReconciliationService.js'
import { recordAuditLog } from '../services/auditLogger.js'

/**
 * Controller for handling incoming Razorpay Webhooks (POST /api/payments/razorpay/webhook).
 *
 * Requirements:
 * - Does NOT require customer JWT authentication.
 * - Authenticated strictly via HMAC-SHA256 signature on the raw request body.
 * - Durable idempotency via WebhookEvent model.
 * - Reuses the shared paymentFulfillmentService for exact-once stock deduction,
 *   order confirmation, cart clearing, and reconciliation.
 */
export async function handleRazorpayWebhook(req, res, next) {
  try {
    const signature = req.headers['x-razorpay-signature']
    if (!signature) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'missing_webhook_signature',
          message: 'X-Razorpay-Signature header is required.',
        },
      })
    }

    // 1. Resolve Raw Body Bytes
    const rawBody =
      req.rawBody ||
      (Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === 'string'
        ? Buffer.from(req.body, 'utf8')
        : null)

    if (!rawBody) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'missing_raw_body',
          message: 'Raw request body is required for webhook signature verification.',
        },
      })
    }

    // 2. Timing-Safe Cryptographic Signature Verification
    const isSignatureValid = verifyRazorpayWebhookSignature({
      rawBody,
      signature,
    })

    if (!isSignatureValid) {
      recordAuditLog({
        action: 'INVALID_WEBHOOK_SIGNATURE',
        actorType: 'GATEWAY',
        resourceType: 'WEBHOOK',
        result: 'FAILURE',
        reason: 'HMAC signature verification failed for webhook payload',
        metadata: {
          signatureSnippet: signature ? `${signature.slice(0, 8)}...` : null,
        },
        req,
      })
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_webhook_signature',
          message: 'Webhook signature verification failed.',
        },
      })
    }

    // 3. Safe JSON Parsing (Never crash Express process)
    let payload = null
    try {
      if (Buffer.isBuffer(req.body)) {
        payload = JSON.parse(req.body.toString('utf8'))
      } else if (typeof req.body === 'string') {
        payload = JSON.parse(req.body)
      } else if (req.body && typeof req.body === 'object') {
        payload = req.body
      } else {
        payload = JSON.parse(rawBody.toString('utf8'))
      }
    } catch {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_json',
          message: 'Malformed JSON payload in webhook body.',
        },
      })
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_payload',
          message: 'Webhook payload must be a valid JSON object.',
        },
      })
    }

    const eventType = payload.event
    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'missing_event_type',
          message: 'Webhook event type ("event") is required.',
        },
      })
    }

    // 4. Resolve Durable Event ID
    const eventId =
      payload.id ||
      req.headers['x-razorpay-event-id'] ||
      `evt_${payload.created_at || Date.now()}_${payload.payload?.payment?.entity?.id || 'unknown'}`

    const rzpOrderId =
      payload.payload?.payment?.entity?.order_id ||
      payload.payload?.order?.entity?.id ||
      null

    const rzpRefundId = payload.payload?.refund?.entity?.id || null

    const rzpPaymentId =
      payload.payload?.payment?.entity?.id ||
      payload.payload?.refund?.entity?.payment_id ||
      null

    // 5. Database-Level Idempotency Registration
    let webhookDoc = null
    try {
      webhookDoc = await WebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType,
        status: 'PROCESSING',
        attempts: 1,
        lockedAt: new Date(),
        lockOwner: 'webhook-handler',
        lastAttemptAt: new Date(),
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpayRefundId: rzpRefundId,
        payloadSummary: {
          event: eventType,
          amount:
            payload.payload?.payment?.entity?.amount ||
            payload.payload?.refund?.entity?.amount,
          currency:
            payload.payload?.payment?.entity?.currency ||
            payload.payload?.refund?.entity?.currency,
          paymentStatus: payload.payload?.payment?.entity?.status,
          refundStatus: payload.payload?.refund?.entity?.status,
          paymentId: rzpPaymentId,
          refundId: rzpRefundId,
          orderId: rzpOrderId,
        },
        receivedAt: new Date(),
      })
    } catch (dbErr) {
      if (dbErr.code === 11000 || dbErr.name === 'MongoServerError') {
        // Event already received
        const existing = await WebhookEvent.findOne({ provider: 'razorpay', eventId })
        if (existing) {
          existing.attempts = (existing.attempts || 1) + 1
          await existing.save().catch(() => {})

          if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') {
            recordAuditLog({
              action: 'WEBHOOK_DUPLICATE',
              actorType: 'GATEWAY',
              resourceType: 'WEBHOOK',
              resourceId: eventId,
              webhookEventId: eventId,
              result: 'SUCCESS',
              reason: 'Duplicate webhook event received and acknowledged idempotently',
              metadata: { eventType, status: existing.status },
              req,
            })
            return res.status(200).json({
              success: true,
              message: 'Webhook event already processed (idempotent response).',
              eventId,
              status: existing.status,
            })
          }

          if (existing.status === 'REQUIRES_RECONCILIATION') {
            return res.status(200).json({
              success: true,
              message: 'Webhook event previously placed into reconciliation.',
              eventId,
              status: existing.status,
            })
          }

          if (existing.status === 'PROCESSING') {
            // Concurrent execution already in flight
            return res.status(200).json({
              success: true,
              message: 'Webhook event is actively being processed.',
              eventId,
              status: 'PROCESSING',
            })
          }

          webhookDoc = existing
          webhookDoc.status = 'PROCESSING'
          await webhookDoc.save().catch(() => {})
        }
      } else {
        throw dbErr
      }
    }

    // 6. Route Event Processing
    switch (eventType) {
      case 'payment.captured': {
        const paymentEntity = payload.payload?.payment?.entity
        if (!paymentEntity) {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_PERMANENT'
            webhookDoc.error = 'Missing payment entity in payload'
            await webhookDoc.save().catch(() => {})
          }
          return res.status(400).json({
            success: false,
            error: {
              code: 'missing_payment_entity',
              message: 'Payload does not contain payment entity.',
            },
          })
        }

        if (!paymentEntity.id || !paymentEntity.order_id) {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_PERMANENT'
            webhookDoc.error = 'Missing payment ID or order ID in payment entity'
            await webhookDoc.save().catch(() => {})
          }
          return res.status(400).json({
            success: false,
            error: {
              code: 'missing_payment_identifiers',
              message: 'Payment entity must contain id and order_id.',
            },
          })
        }

        // Currency Validation
        if (paymentEntity.currency && paymentEntity.currency.toUpperCase() !== 'INR') {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_PERMANENT'
            webhookDoc.error = `Invalid currency: ${paymentEntity.currency}`
            await webhookDoc.save().catch(() => {})
          }
          return res.status(400).json({
            success: false,
            error: {
              code: 'invalid_currency',
              message: 'Payment currency must be INR.',
            },
          })
        }

        // Amount Validation (must be positive number)
        if (typeof paymentEntity.amount !== 'number' || paymentEntity.amount <= 0) {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_PERMANENT'
            webhookDoc.error = `Invalid amount: ${paymentEntity.amount}`
            await webhookDoc.save().catch(() => {})
          }
          return res.status(400).json({
            success: false,
            error: {
              code: 'invalid_amount',
              message: 'Payment amount must be a positive integer in paise.',
            },
          })
        }

        // Delegate to Shared Payment Fulfillment Engine
        const fulfillRes = await fulfillRazorpayPayment({
          razorpayOrderId: paymentEntity.order_id,
          razorpayPaymentId: paymentEntity.id,
          amount: paymentEntity.amount,
          isWebhook: true,
          gatewayPayment: paymentEntity,
          rawWebhookPayload: payload,
        })

        if (fulfillRes.success) {
          if (webhookDoc) {
            webhookDoc.status = 'PROCESSED'
            webhookDoc.processedAt = new Date()
            webhookDoc.lockedAt = null
            webhookDoc.orderId = fulfillRes.order?._id || null
            await webhookDoc.save().catch(() => {})
          }
          return res.status(200).json({
            success: true,
            message: fulfillRes.idempotent
              ? 'Payment was already fulfilled (idempotent acknowledge).'
              : 'Payment fulfilled successfully via webhook.',
            orderId: fulfillRes.order?._id,
            orderNumber: fulfillRes.order?.orderNumber,
          })
        }

        // Duplicate payment/order identity conflict
        if (fulfillRes.errorCode === 'duplicate_payment_id' || fulfillRes.errorCode === 'duplicate_razorpay_order') {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_PERMANENT'
            webhookDoc.lockedAt = null
            webhookDoc.error = fulfillRes.message
            await webhookDoc.save().catch(() => {})
          }
          return res.status(409).json({
            success: false,
            error: {
              code: fulfillRes.errorCode,
              message: fulfillRes.message,
            },
          })
        }

        // Business Reconciliation Handling (e.g. stock exhausted, order cancelled)
        if (fulfillRes.statusCode === 409) {
          if (webhookDoc) {
            webhookDoc.status = 'REQUIRES_RECONCILIATION'
            webhookDoc.processedAt = new Date()
            webhookDoc.lockedAt = null
            webhookDoc.reconciliationReason = fulfillRes.message
            await webhookDoc.save().catch(() => {})
          }
          return res.status(200).json({
            success: true,
            message: 'Payment received but order entered reconciliation.',
            reason: fulfillRes.message,
            errorCode: fulfillRes.errorCode,
          })
        }

        // Temporary or Gateway Error (Retryable)
        if (fulfillRes.statusCode === 502) {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_RETRYABLE'
            webhookDoc.lockedAt = null
            webhookDoc.error = fulfillRes.message
            await webhookDoc.save().catch(() => {})
          }
          return res.status(502).json({
            success: false,
            error: {
              code: fulfillRes.errorCode,
              message: fulfillRes.message,
            },
          })
        }

        // Permanent Error (e.g. order not found, mismatched order)
        if (webhookDoc) {
          webhookDoc.status = 'FAILED_PERMANENT'
          webhookDoc.lockedAt = null
          webhookDoc.error = fulfillRes.message
          await webhookDoc.save().catch(() => {})
        }
        return res.status(fulfillRes.statusCode || 400).json({
          success: false,
          error: {
            code: fulfillRes.errorCode || 'fulfillment_error',
            message: fulfillRes.message,
          },
        })
      }

      case 'payment.failed': {
        const paymentEntity = payload.payload?.payment?.entity
        if (!paymentEntity?.order_id) {
          if (webhookDoc) {
            webhookDoc.status = 'FAILED_PERMANENT'
            webhookDoc.error = 'Missing order_id in failed payment payload'
            await webhookDoc.save().catch(() => {})
          }
          return res.status(400).json({
            success: false,
            error: {
              code: 'missing_order_id',
              message: 'Failed payment entity must contain order_id.',
            },
          })
        }

        const failRes = await recordWebhookPaymentFailure({
          razorpayOrderId: paymentEntity.order_id,
          razorpayPaymentId: paymentEntity.id,
          errorReason: paymentEntity.error_description,
          errorCode: paymentEntity.error_code,
          rawWebhookPayload: payload,
        })

        if (webhookDoc) {
          webhookDoc.status = 'PROCESSED'
          webhookDoc.processedAt = new Date()
          webhookDoc.lockedAt = null
          if (failRes.order?._id) webhookDoc.orderId = failRes.order._id
          await webhookDoc.save().catch(() => {})
        }

        return res.status(200).json({
          success: true,
          message: failRes.ignored
            ? 'Order already confirmed; failure ignored.'
            : 'Payment failure recorded successfully.',
        })
      }

      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed':
      case 'refund.speed_changed': {
        const refundRes = await processRefundWebhook({
          eventType,
          payload,
          webhookDoc,
        })
        return res.status(refundRes.statusCode || 200).json(refundRes)
      }

      default: {
        // Unknown or non-fulfillment events (e.g. order.paid, payment.authorized)
        if (webhookDoc) {
          webhookDoc.status = 'IGNORED'
          webhookDoc.processedAt = new Date()
          webhookDoc.lockedAt = null
          await webhookDoc.save().catch(() => {})
        }
        return res.status(200).json({
          success: true,
          message: `Webhook event "${eventType}" acknowledged and ignored.`,
        })
      }
    }
  } catch (err) {
    next(err)
  }
}

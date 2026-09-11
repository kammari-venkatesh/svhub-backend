import mongoose from 'mongoose'
import { Refund } from '../models/Refund.js'
import { initiateRefund } from '../services/refundReconciliationService.js'

/**
 * Customer Initiated Refund Endpoint (POST /api/orders/:id/refund)
 */
export async function requestCustomerRefund(req, res, next) {
  try {
    const rawOrderId = String(req.params.id || '').trim()
    const { amount, reason, idempotencyKey, items, speed } = req.body || {}

    if (!mongoose.isValidObjectId(rawOrderId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_id',
          message: 'Invalid MongoDB ObjectId specified.',
        },
      })
    }

    const clientKey =
      typeof idempotencyKey === 'string' && idempotencyKey.trim()
        ? idempotencyKey.trim()
        : req.headers['x-idempotency-key'] || null

    const result = await initiateRefund({
      orderId: rawOrderId,
      amount,
      reason,
      user: req.user,
      role: 'customer',
      source: 'customer_request',
      idempotencyKey: clientKey,
      items: Array.isArray(items) ? items : [],
      speed: speed === 'optimum' ? 'optimum' : 'normal',
    })

    if (!result || !result.success) {
      return res.status(result?.statusCode || 400).json({
        success: false,
        error: {
          code: result?.errorCode || 'refund_failed',
          message: result?.message || 'Refund request could not be completed.',
        },
      })
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      idempotent: Boolean(result.idempotent),
      data: {
        id: result.refund?._id,
        orderId: result.refund?.orderId,
        amount: result.refund?.amount,
        currency: result.refund?.currency,
        status: result.refund?.status,
        reason: result.refund?.reason,
        razorpayRefundId: result.refund?.razorpayRefundId || null,
        isFullRefund: result.refund?.isFullRefund,
        inventoryRestorationStatus: result.refund?.inventoryRestorationStatus,
        createdAt: result.refund?.createdAt,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Retrieve Refund Details (GET /api/refunds/:id)
 */
export async function getRefundDetails(req, res, next) {
  try {
    const rawRefundId = String(req.params.id || '').trim()

    if (!mongoose.isValidObjectId(rawRefundId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_refund_id',
          message: 'Invalid MongoDB ObjectId specified.',
        },
      })
    }

    const refund = await Refund.findById(rawRefundId)
    if (!refund) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'refund_not_found',
          message: 'Refund record not found.',
        },
      })
    }

    // Customer can only view their own refund
    if (req.user.role !== 'admin' && refund.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'forbidden_resource',
          message: 'You are not authorized to view this refund record.',
        },
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        id: refund._id,
        orderId: refund.orderId,
        paymentId: refund.paymentId,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        reason: refund.reason,
        requestedByRole: refund.requestedByRole,
        razorpayRefundId: refund.razorpayRefundId || null,
        isFullRefund: refund.isFullRefund,
        inventoryRestorationStatus: refund.inventoryRestorationStatus,
        processedAt: refund.processedAt,
        failedAt: refund.failedAt,
        safeFailureReason: refund.safeFailureReason,
        createdAt: refund.createdAt,
        updatedAt: refund.updatedAt,
      },
    })
  } catch (err) {
    next(err)
  }
}

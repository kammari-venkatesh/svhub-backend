import { Order } from '../models/Order.js'
import { Payment } from '../models/Payment.js'
import { Cart } from '../models/Cart.js'
import {
  getRazorpayClient,
  getRazorpayKeyId,
  verifyRazorpaySignature,
  isRazorpayConfigured,
} from '../config/razorpay.js'
import { deductOrderInventory } from '../utils/inventory.js'
import { formatPublicOrder } from './orderController.js'

/**
 * 1. Create Razorpay Order (POST /api/payments/razorpay/create-order)
 * Protected by requireAuth.
 * Resolves authoritative SV Hub Order, verifies ownership, and creates a Razorpay order in INR paise.
 */
export async function createRazorpayOrder(req, res, next) {
  try {
    const { orderId } = req.body || {}

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_id',
          message: 'SV Hub Order ID is required.',
        },
      })
    }

    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'order_not_found',
          message: 'Order not found.',
        },
      })
    }

    // Access Control: Customer can only pay for their own order
    if (String(order.userId) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'forbidden_order',
          message: 'You do not have permission to pay for this order.',
        },
      })
    }

    // Status Validation: Order must be payable and still pending payment
    if (order.status !== 'PENDING_PAYMENT') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'order_not_payable',
          message: `Order status is ${order.status}. Only PENDING_PAYMENT orders can initiate payment.`,
        },
      })
    }

    if (order.paymentStatus === 'SUCCESS' || order.paymentStatus === 'PAID') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'already_paid',
          message: 'Order has already been paid.',
        },
      })
    }

    // Authoritative Amount Validation: Must come from MongoDB record
    if (typeof order.totalAmount !== 'number' || order.totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_total',
          message: 'Order total is invalid.',
        },
      })
    }

    const amountInPaise = Math.round(order.totalAmount * 100)

    // Check if an existing valid payment record can be safely reused
    let payment = await Payment.findOne({
      orderId: order._id,
      status: { $in: ['CREATED', 'PENDING'] },
    }).sort({ createdAt: -1 })

    let razorpayOrderId = payment?.razorpayOrderId || null

    if (!razorpayOrderId) {
      const razorpay = getRazorpayClient()
      const options = {
        amount: amountInPaise,
        currency: 'INR',
        receipt: String(order.orderNumber).slice(0, 40),
        notes: {
          svHubOrderId: String(order._id),
          orderNumber: order.orderNumber,
          userId: String(req.user._id),
        },
      }

      const rzpOrder = await razorpay.orders.create(options)
      razorpayOrderId = rzpOrder.id

      payment = await Payment.create({
        orderId: order._id,
        userId: req.user._id,
        amount: order.totalAmount,
        currency: 'INR',
        gateway: 'razorpay',
        status: 'CREATED',
        razorpayOrderId,
      })

      order.razorpayOrderId = razorpayOrderId
      order.paymentMethod = 'razorpay'
      await order.save()
    }

    return res.status(200).json({
      success: true,
      data: {
        keyId: getRazorpayKeyId(),
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        razorpayOrderId,
        amount: amountInPaise,
        currency: 'INR',
        customer: {
          name: order.customerName,
          email: order.email,
          phone: order.phone,
        },
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 2. Verify Razorpay Payment (POST /api/payments/razorpay/verify)
 * Protected by requireAuth.
 * Validates HMAC SHA-256 signature, matches server-stored order ID, enforces amount authority,
 * applies atomic inventory deduction, marks Payment PAID, marks Order CONFIRMED, and clears cart.
 */
export async function verifyRazorpayPayment(req, res, next) {
  try {
    const {
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
    } = req.body || {}

    if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'missing_payment_fields',
          message: 'orderId, razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.',
        },
      })
    }

    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'order_not_found',
          message: 'Order not found.',
        },
      })
    }

    // Access Control: Verify authenticated user owns the order
    if (String(order.userId) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'forbidden_order',
          message: 'You do not have permission to verify payment for this order.',
        },
      })
    }

    // Find server-side payment record
    const payment = await Payment.findOne({
      orderId: order._id,
      razorpayOrderId: razorpay_order_id,
    }) || await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 })

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'payment_record_not_found',
          message: 'Server-side payment record not found for this order.',
        },
      })
    }

    // Section 17: Match client razorpay_order_id with server-stored Razorpay Order ID
    if (payment.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'mismatched_razorpay_order_id',
          message: 'Razorpay order ID does not match the server-stored payment record.',
        },
      })
    }

    // Section 20: Idempotency & Duplicate Payment Protection
    if (
      order.status === 'CONFIRMED' &&
      (order.paymentStatus === 'SUCCESS' || order.paymentStatus === 'PAID') &&
      payment.verified === true &&
      payment.razorpayPaymentId === razorpay_payment_id
    ) {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and order confirmed.',
        data: {
          order: formatPublicOrder(order),
          payment: {
            id: String(payment._id),
            status: payment.status,
            gateway: payment.gateway,
            razorpayOrderId: payment.razorpayOrderId,
            razorpayPaymentId: payment.razorpayPaymentId,
            amount: payment.amount,
            currency: payment.currency,
          },
          idempotent: true,
        },
      })
    }

    if (order.status === 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'order_already_confirmed',
          message: 'This order is already confirmed.',
        },
      })
    }

    // Section 18: Verify Payment Amount Authority (Total in Paise)
    const expectedPaise = Math.round(order.totalAmount * 100)
    if (amount !== undefined && amount !== null) {
      const submitted = Number(amount)
      if (submitted !== expectedPaise && submitted !== order.totalAmount) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'amount_mismatch',
            message: 'Submitted payment amount does not match authoritative order total.',
          },
        })
      }
    }

    // Section 16: Cryptographic HMAC SHA256 Signature Verification
    // Use the SERVER-STORED razorpayOrderId + '|' + razorpay_payment_id
    const isSignatureValid = verifyRazorpaySignature({
      serverOrderId: payment.razorpayOrderId,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })

    if (!isSignatureValid) {
      payment.status = 'FAILED'
      payment.razorpayPaymentId = razorpay_payment_id
      payment.razorpaySignature = razorpay_signature
      payment.errorReason = 'Cryptographic signature verification failed'
      await payment.save()

      order.paymentStatus = 'FAILED'
      await order.save()

      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_signature',
          message: 'Cryptographic signature verification failed.',
        },
      })
    }

    // Section 19: Verify Payment Status with Razorpay API where appropriate
    if (isRazorpayConfigured() && process.env.SKIP_RZP_FETCH !== 'true') {
      try {
        const razorpay = getRazorpayClient()
        const rzpPayment = await razorpay.payments.fetch(razorpay_payment_id)
        if (rzpPayment) {
          if (rzpPayment.order_id && rzpPayment.order_id !== payment.razorpayOrderId) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'order_id_mismatch',
                message: 'Razorpay payment record does not match the server order ID.',
              },
            })
          }
          if (rzpPayment.amount && rzpPayment.amount !== expectedPaise) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'amount_mismatch',
                message: 'Razorpay payment amount does not match authoritative order amount.',
              },
            })
          }
        }
      } catch (rzpErr) {
        if (process.env.STRICT_RZP_FETCH === 'true') {
          return res.status(400).json({
            success: false,
            error: {
              code: 'razorpay_api_error',
              message: `Razorpay API verification failed: ${rzpErr.message}`,
            },
          })
        }
      }
    }

    // Section 21: Atomic Inventory Deduction
    const invResult = await deductOrderInventory(order.items)
    if (!invResult.success) {
      payment.status = 'FAILED'
      payment.errorReason = `Inventory deduction failed: ${invResult.error}`
      payment.razorpayPaymentId = razorpay_payment_id
      payment.razorpaySignature = razorpay_signature
      payment.verified = true
      await payment.save()

      order.status = 'REQUIRES_RECONCILIATION'
      order.paymentStatus = 'SUCCESS'
      order.paymentId = razorpay_payment_id
      order.history.push({
        status: 'REQUIRES_RECONCILIATION',
        at: new Date(),
        note: `Payment verified (${razorpay_payment_id}), but inventory deduction failed: ${invResult.error}. Manual reconciliation required.`,
      })
      await order.save()

      return res.status(409).json({
        success: false,
        error: {
          code: 'inventory_conflict',
          message: 'Payment received, but items are out of stock. Order requires reconciliation.',
        },
        data: {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          orderStatus: order.status,
        },
      })
    }

    // Section 22: Atomic Payment Completion
    payment.status = 'SUCCESS'
    payment.razorpayPaymentId = razorpay_payment_id
    payment.razorpaySignature = razorpay_signature
    payment.verified = true
    payment.errorReason = null
    await payment.save()

    order.status = 'CONFIRMED'
    order.paymentStatus = 'SUCCESS'
    order.paymentId = razorpay_payment_id
    order.paymentMethod = 'razorpay'
    order.history.push({
      status: 'CONFIRMED',
      at: new Date(),
      note: `Payment verified via Razorpay (${razorpay_payment_id}); stock deducted and order confirmed.`,
    })
    await order.save()

    // Section 23: Cart Clearing strictly on successful verification and order confirmation
    await Cart.updateOne({ userId: order.userId }, { $set: { items: [] } })

    return res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed successfully.',
      data: {
        order: formatPublicOrder(order),
        payment: {
          id: String(payment._id),
          status: payment.status,
          gateway: payment.gateway,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          amount: payment.amount,
          currency: payment.currency,
        },
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Record payment failure / checkout cancellation from client (POST /api/payments/razorpay/record-failure)
 */
export async function recordPaymentFailure(req, res, next) {
  try {
    const { orderId, razorpay_order_id, errorReason } = req.body || {}

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: { code: 'missing_order_id', message: 'Order ID is required.' },
      })
    }

    const order = await Order.findById(orderId)
    if (!order || String(order.userId) !== String(req.user._id)) {
      return res.status(404).json({
        success: false,
        error: { code: 'order_not_found', message: 'Order not found.' },
      })
    }

    if (order.status !== 'CONFIRMED') {
      order.paymentStatus = 'FAILED'
      order.history.push({
        status: order.status,
        at: new Date(),
        note: `Payment attempt failed or cancelled: ${errorReason || 'Checkout cancelled by customer'}`,
      })
      await order.save()
    }

    if (razorpay_order_id) {
      await Payment.updateOne(
        { orderId: order._id, razorpayOrderId: razorpay_order_id },
        { $set: { status: 'FAILED', errorReason: errorReason || 'Payment failed or cancelled' } },
      )
    }

    return res.status(200).json({
      success: true,
      message: 'Payment failure recorded.',
    })
  } catch (err) {
    next(err)
  }
}

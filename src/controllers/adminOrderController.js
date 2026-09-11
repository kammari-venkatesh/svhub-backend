import mongoose from 'mongoose'
import { Order } from '../models/Order.js'
import { Payment } from '../models/Payment.js'
import { Refund } from '../models/Refund.js'
import { restoreOrderInventory } from '../utils/inventory.js'
import { reconcileOrderPayment } from '../services/paymentReconciliationService.js'
import {
  initiateRefund,
  reconcileRefundRecord,
} from '../services/refundReconciliationService.js'
import { recordAuditLog } from '../services/auditLogger.js'

const ORDER_STATUS_MAP = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PENDING: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
}

const PAYMENT_STATUS_MAP = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  PAID: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
}

const ALLOWED_ORDER_TRANSITIONS = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REQUIRES_RECONCILIATION'],
  PROCESSING: ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REQUIRES_RECONCILIATION: ['CANCELLED'],
}

function normalizeOrderStatus(val) {
  if (!val || typeof val !== 'string') return null
  const cleaned = val.trim().toUpperCase().replace(/\s+/g, '_')
  return ORDER_STATUS_MAP[cleaned] || null
}

function normalizePaymentStatus(val) {
  if (!val || typeof val !== 'string') return null
  const cleaned = val.trim().toUpperCase()
  return PAYMENT_STATUS_MAP[cleaned] || null
}

function escapeRegex(text) {
  return String(text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}

export function formatAdminOrder(order) {
  const doc = order.toObject ? order.toObject() : order

  // Sanitize user object - strictly remove sensitive authentication credentials
  let safeUser = null
  if (doc.userId && typeof doc.userId === 'object') {
    safeUser = {
      id: String(doc.userId._id || doc.userId.id || ''),
      _id: String(doc.userId._id || doc.userId.id || ''),
      name: doc.userId.name || doc.customerName,
      email: doc.userId.email || doc.email,
      phone: doc.userId.phone || doc.phone,
      role: doc.userId.role,
      isActive: doc.userId.isActive,
    }
  } else if (doc.userId) {
    safeUser = {
      id: String(doc.userId),
      _id: String(doc.userId),
      name: doc.customerName,
      email: doc.email,
      phone: doc.phone,
    }
  }

  const statusTitleMap = {
    PENDING_PAYMENT: 'Pending',
    CONFIRMED: 'Confirmed',
    PROCESSING: 'Processing',
    SHIPPED: 'Shipped',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    REQUIRES_RECONCILIATION: 'Pending',
  }

  const paymentTitleMap = {
    PENDING: 'Pending',
    SUCCESS: 'Paid',
    PAID: 'Paid',
    FAILED: 'Failed',
    REFUNDED: 'Refunded',
  }

  const canonicalPaymentStatus = doc.paymentStatus === 'SUCCESS' ? 'PAID' : doc.paymentStatus

  const items = (doc.items || []).map((item) => ({
    id: item.variantId || String(item.productId),
    productId: String(item.productId),
    variantId: item.variantId,
    name: item.productName,
    productName: item.productName,
    variantLabel: item.variantLabel,
    weight: item.weight || item.variantLabel || '',
    sku: item.sku,
    price: item.unitPrice,
    unitPrice: item.unitPrice,
    originalPrice: item.originalPrice ?? null,
    discount: item.discount ?? null,
    quantity: item.quantity,
    restoredQuantity: item.restoredQuantity || 0,
    lineTotal: item.lineTotal,
    image: item.image || '',
    storefront: item.storefront || '',
  }))

  const addressLines = doc.shippingAddress?.lines?.length
    ? doc.shippingAddress.lines
    : [
        doc.shippingAddress?.street,
        `${doc.shippingAddress?.city || ''}, ${doc.shippingAddress?.state || ''} - ${doc.shippingAddress?.pin || ''}`.trim().replace(/^,\s*|-\s*$/g, ''),
      ].filter(Boolean)

  const shippingAddress = doc.shippingAddress
    ? {
        name: doc.shippingAddress.name,
        phone: doc.shippingAddress.phone,
        street: doc.shippingAddress.street,
        city: doc.shippingAddress.city,
        state: doc.shippingAddress.state,
        pin: doc.shippingAddress.pin,
        country: doc.shippingAddress.country || 'India',
        lines: addressLines,
      }
    : null

  const history = (doc.history || []).map((h) => ({
    status: h.status,
    at: h.at,
    note: h.note || '',
  }))

  return {
    id: String(doc._id),
    _id: String(doc._id),
    orderNumber: doc.orderNumber,
    number: doc.orderNumber,
    user: safeUser,
    userId: safeUser,
    customer: safeUser || {
      id: String(doc.userId || ''),
      name: doc.customerName,
      email: doc.email,
      phone: doc.phone,
    },
    customerName: doc.customerName,
    email: doc.email,
    phone: doc.phone,
    shippingAddress,
    address: shippingAddress,
    items,
    subtotal: doc.subtotal,
    shippingFee: doc.shippingFee,
    shipping: doc.shippingFee,
    discount: doc.discount || 0,
    tax: 0,
    totalAmount: doc.totalAmount,
    total: doc.totalAmount,
    amount: doc.totalAmount,
    status: doc.status,
    displayStatus: statusTitleMap[doc.status] || doc.status,
    paymentStatus: canonicalPaymentStatus,
    rawPaymentStatus: doc.paymentStatus,
    displayPaymentStatus: paymentTitleMap[doc.paymentStatus] || doc.paymentStatus,
    paymentMethod: doc.paymentMethod || null,
    payment: doc.paymentMethod ? `Paid via ${doc.paymentMethod}` : 'Online Payment',
    paymentId: doc.paymentId || null,
    razorpayOrderId: doc.razorpayOrderId || null,
    courier: doc.courier || null,
    trackingNumber: doc.trackingNumber || null,
    notes: doc.notes || '',
    expectedDeliveryDate:
      doc.expectedDeliveryDate ||
      (doc.createdAt
        ? new Date(new Date(doc.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000)
        : null),
    history,
    statusHistory: history,
    storefronts: Array.from(new Set(items.map((i) => i.storefront).filter(Boolean))),
    date: doc.createdAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

// 1. GET /api/admin/orders
export async function getAdminOrders(req, res, next) {
  try {
    const {
      page: rawPage,
      limit: rawLimit,
      search,
      status,
      paymentStatus,
      storefront,
      dateRange,
      dateFrom,
      dateTo,
      sort,
    } = req.query

    const page = Math.max(1, parseInt(rawPage, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit, 10) || 10))
    const skip = (page - 1) * limit

    const query = {}

    // Search filter across orderNumber, customerName, email, phone
    if (search && typeof search === 'string' && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i')
      query.$or = [
        { orderNumber: regex },
        { customerName: regex },
        { email: regex },
        { phone: regex },
      ]
    }

    // Status filter
    if (status && status !== 'all') {
      const normalized = normalizeOrderStatus(status)
      if (normalized) {
        query.status = normalized
      }
    }

    // Payment status filter
    if (paymentStatus && paymentStatus !== 'all') {
      const normalized = normalizePaymentStatus(paymentStatus)
      if (normalized) {
        query.paymentStatus = normalized
      }
    }

    // Storefront filter
    if (storefront && storefront !== 'all') {
      query['items.storefront'] = storefront
    }

    // Date range filter
    if (dateRange && dateRange !== 'all') {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (dateRange === '7d') {
        query.createdAt = { $gte: new Date(today.getTime() - 6 * 86400000) }
      } else if (dateRange === '30d') {
        query.createdAt = { $gte: new Date(today.getTime() - 29 * 86400000) }
      } else if (dateRange === 'month') {
        query.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }
      } else if (dateRange === 'custom') {
        const dateQuery = {}
        if (dateFrom) dateQuery.$gte = new Date(`${dateFrom}T00:00:00.000Z`)
        if (dateTo) dateQuery.$lte = new Date(`${dateTo}T23:59:59.999Z`)
        if (Object.keys(dateQuery).length > 0) query.createdAt = dateQuery
      }
    } else if (dateFrom || dateTo) {
      const dateQuery = {}
      if (dateFrom) dateQuery.$gte = new Date(`${dateFrom}T00:00:00.000Z`)
      if (dateTo) dateQuery.$lte = new Date(`${dateTo}T23:59:59.999Z`)
      if (Object.keys(dateQuery).length > 0) query.createdAt = dateQuery
    }

    // Sort order
    let sortOption = { createdAt: -1 }
    if (sort === 'date_asc' || sort === 'oldest') {
      sortOption = { createdAt: 1 }
    } else if (sort === 'total_desc' || sort === 'amount_desc') {
      sortOption = { totalAmount: -1 }
    } else if (sort === 'total_asc' || sort === 'amount_asc') {
      sortOption = { totalAmount: 1 }
    }

    const [total, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .populate('userId', 'name email phone role isActive')
        .sort(sortOption)
        .skip(skip)
        .limit(limit),
    ])

    const totalPages = Math.ceil(total / limit) || 0

    res.json({
      success: true,
      orders: orders.map(formatAdminOrder),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    })
  } catch (err) {
    next(err)
  }
}

// 2. GET /api/admin/orders/:id
export async function getAdminOrderById(req, res, next) {
  try {
    const rawId = String(req.params.id || '').trim()

    let order = null
    if (mongoose.isValidObjectId(rawId)) {
      order = await Order.findById(rawId).populate('userId', 'name email phone role isActive')
    }

    if (!order) {
      const cleanNumber = rawId.startsWith('#') ? rawId : `#${rawId}`
      order = await Order.findOne({
        $or: [{ orderNumber: rawId }, { orderNumber: cleanNumber }],
      }).populate('userId', 'name email phone role isActive')
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'order_not_found',
          message: 'Order not found.',
        },
      })
    }

    res.json({
      success: true,
      order: formatAdminOrder(order),
    })
  } catch (err) {
    next(err)
  }
}

// 3. PATCH /api/admin/orders/:id
export async function updateAdminOrder(req, res, next) {
  try {
    const rawId = String(req.params.id || '').trim()

    if (!mongoose.isValidObjectId(rawId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_id',
          message: 'Invalid MongoDB ObjectId provided.',
        },
      })
    }

    const order = await Order.findById(rawId).populate('userId', 'name email phone role isActive')
    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'order_not_found',
          message: 'Order not found.',
        },
      })
    }

    const { status, paymentStatus, courier, trackingNumber, notes, expectedDeliveryDate } = req.body || {}

    // Whitelist and validate Order Status
    if (status !== undefined) {
      const targetStatus = normalizeOrderStatus(status)
      if (!targetStatus) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_order_status',
            message: `Invalid order status: "${status}". Supported values are PENDING_PAYMENT, CONFIRMED, PROCESSING, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED.`,
          },
        })
      }

      // Append status history only when status has actually changed
      if (order.status !== targetStatus) {
        // Phase 2.4H Order State Machine Invariant Protection
        const allowedTransitions = ALLOWED_ORDER_TRANSITIONS[order.status] || []
        if (!allowedTransitions.includes(targetStatus)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'invalid_order_transition',
              message: `Illegal state transition: order in state "${order.status}" cannot transition to "${targetStatus}".`,
            },
          })
        }

        // Unpaid order cannot be moved to CONFIRMED without valid payment
        if (targetStatus === 'CONFIRMED' && order.paymentStatus !== 'SUCCESS' && order.paymentStatus !== 'PAID') {
          const targetPayment = paymentStatus !== undefined ? normalizePaymentStatus(paymentStatus) : null
          if (targetPayment !== 'SUCCESS' && targetPayment !== 'PAID') {
            return res.status(400).json({
              success: false,
              error: {
                code: 'unpaid_order_confirmation',
                message: 'Cannot confirm order without valid successful payment.',
              },
            })
          }
        }

        order.history = order.history || []
        order.history.push({
          status: targetStatus,
          at: new Date(),
          note: typeof notes === 'string' && notes.trim()
            ? notes.trim()
            : `Order status changed to ${targetStatus} by admin (${req.user?.email || 'Admin'})`,
        })
        order.status = targetStatus
      }
    }

    // Whitelist and validate Payment Status
    if (paymentStatus !== undefined) {
      const targetPayment = normalizePaymentStatus(paymentStatus)
      if (!targetPayment) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_payment_status',
            message: `Invalid payment status: "${paymentStatus}". Supported values are PENDING, PAID, SUCCESS, FAILED, REFUNDED.`,
          },
        })
      }
      if ((order.paymentStatus === 'SUCCESS' || order.paymentStatus === 'PAID') && targetPayment === 'PENDING') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_payment_transition',
            message: 'Cannot revert captured or successful payment back to PENDING.',
          },
        })
      }
      order.paymentStatus = targetPayment
    }

    // Whitelist and validate Expected Delivery Date
    if (expectedDeliveryDate !== undefined) {
      if (expectedDeliveryDate === null || expectedDeliveryDate === '') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_expected_delivery_date',
            message: 'Expected delivery date cannot be empty.',
          },
        })
      }
      const parsedDate = new Date(expectedDeliveryDate)
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_expected_delivery_date',
            message: 'Invalid expected delivery date format.',
          },
        })
      }

      // Check: Reject dates earlier than order creation day for active (non-delivered, non-cancelled) orders
      const orderCreatedDay = new Date(order.createdAt)
      orderCreatedDay.setHours(0, 0, 0, 0)
      if (order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && parsedDate < orderCreatedDay) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_expected_delivery_date',
            message: 'Expected delivery date cannot be earlier than order creation date for active orders.',
          },
        })
      }

      // Audit trail in order history if date actually changed
      const currentExpected = order.expectedDeliveryDate
        ? new Date(order.expectedDeliveryDate).getTime()
        : (order.createdAt ? new Date(order.createdAt).getTime() + 7 * 86400000 : null)

      if (!currentExpected || parsedDate.getTime() !== currentExpected) {
        const oldStr = currentExpected
          ? new Date(currentExpected).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'Initial default'
        const newStr = parsedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        order.history = order.history || []
        order.history.push({
          status: order.status,
          at: new Date(),
          note: `Expected delivery changed: ${oldStr} → ${newStr} by admin (${req.user?.email || 'Admin'})`,
        })
        order.expectedDeliveryDate = parsedDate
      }
    }

    // Whitelist and sanitize Courier
    if (courier !== undefined) {
      if (courier === null || courier === '') {
        order.courier = null
      } else if (typeof courier === 'string') {
        order.courier = courier.trim()
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_courier',
            message: 'Courier must be a string or null.',
          },
        })
      }
    }

    // Whitelist and sanitize Tracking Number
    if (trackingNumber !== undefined) {
      if (trackingNumber === null || trackingNumber === '') {
        order.trackingNumber = null
      } else if (typeof trackingNumber === 'string') {
        order.trackingNumber = trackingNumber.trim()
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_tracking_number',
            message: 'Tracking number must be a string or null.',
          },
        })
      }
    }

    // Whitelist and sanitize Notes
    if (notes !== undefined) {
      if (typeof notes === 'string') {
        order.notes = notes.trim()
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_notes',
            message: 'Notes must be a string.',
          },
        })
      }
    }

    // STRICT IMMUTABILITY:
    // Any other properties in req.body (items, shippingAddress, subtotal, totalAmount, etc.) are ignored.

    await order.save()

    recordAuditLog({
      action: 'ADMIN_ORDER_STATUS_CHANGE',
      actorType: 'ADMIN',
      actorId: req.user._id,
      actorEmail: req.user.email,
      resourceType: 'ORDER',
      resourceId: String(order._id),
      orderId: order._id,
      result: 'SUCCESS',
      metadata: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        courier: order.courier,
        trackingNumber: order.trackingNumber,
      },
      req,
    })

    res.json({
      success: true,
      message: 'Order updated successfully.',
      order: formatAdminOrder(order),
    })
  } catch (err) {
    next(err)
  }
}

// 4. POST /api/admin/orders/:id/cancel
export async function cancelAdminOrder(req, res, next) {
  try {
    const rawId = String(req.params.id || '').trim()

    if (!mongoose.isValidObjectId(rawId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_id',
          message: 'Invalid MongoDB ObjectId provided.',
        },
      })
    }

    const order = await Order.findById(rawId).populate('userId', 'name email phone role isActive')
    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'order_not_found',
          message: 'Order not found.',
        },
      })
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'cancellation_reason_required',
          message: 'A cancellation reason is required.',
        },
      })
    }

    if (order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'order_already_cancelled',
          message: 'This order is already cancelled.',
        },
      })
    }

    if (order.status === 'DELIVERED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'cannot_cancel_delivered',
          message: 'Delivered orders cannot be cancelled.',
        },
      })
    }

    // Transactional, safe cancellation with inventory restoration and retry loop for WriteConflict
    let attempt = 0
    const maxAttempts = 3
    let liveOrder = null
    let wasPaid = false

    while (attempt < maxAttempts) {
      attempt++
      const session = await mongoose.startSession()
      try {
        session.startTransaction()

        liveOrder = await Order.findById(order._id).session(session)
        if (!liveOrder) {
          await session.abortTransaction()
          return res.status(404).json({
            success: false,
            error: { code: 'order_not_found', message: 'Order not found.' },
          })
        }

        if (liveOrder.status === 'CANCELLED') {
          await session.abortTransaction()
          return res.status(400).json({
            success: false,
            error: {
              code: 'order_already_cancelled',
              message: 'This order is already cancelled.',
            },
          })
        }

        if (liveOrder.status === 'DELIVERED') {
          await session.abortTransaction()
          return res.status(400).json({
            success: false,
            error: {
              code: 'cannot_cancel_delivered',
              message: 'Delivered orders cannot be cancelled.',
            },
          })
        }

        // Safe Inventory Restoration Logic (Durable per-line accounting):
        // Only restore stock if inventory was actually deducted.
        // Compute remaining restorable quantity per line item to strictly prevent double-restoration.
        if (liveOrder.inventoryDeducted === true) {
          const itemsToRestore = []
          for (const item of (liveOrder.items || [])) {
            const ordered = Number(item.quantity) || 0
            const alreadyRestored = Number(item.restoredQuantity) || 0
            const remainingRestorable = Math.max(0, ordered - alreadyRestored)
            if (remainingRestorable > 0) {
              itemsToRestore.push({
                productId: item.productId,
                variantId: item.variantId,
                quantity: remainingRestorable,
              })
              item.restoredQuantity = ordered
            }
          }

          if (itemsToRestore.length > 0) {
            const restoreRes = await restoreOrderInventory(itemsToRestore, session)
            if (!restoreRes.success) {
              throw new Error(`Inventory restoration failed: ${restoreRes.error}`)
            }
          }
          liveOrder.inventoryRestored = true
        }

        // Payment Reconciliation Note (Phase 2.4B requirement):
        // If money was captured, record reconciliation requirement without faking a refund.
        wasPaid =
          liveOrder.paymentStatus === 'SUCCESS' ||
          liveOrder.paymentStatus === 'PAID' ||
          liveOrder.paymentStatus === 'PARTIALLY_REFUNDED'
        if (wasPaid) {
          await Payment.updateOne(
            { orderId: liveOrder._id },
            {
              $set: {
                reconciliationReason:
                  'Order cancelled by admin after payment capture; refund pending',
              },
            },
            { session },
          )
        }

        liveOrder.status = 'CANCELLED'
        liveOrder.history = liveOrder.history || []
        liveOrder.history.push({
          status: 'CANCELLED',
          at: new Date(),
          note: reason,
        })

        await liveOrder.save({ session })
        await session.commitTransaction()
        break
      } catch (txErr) {
        await session.abortTransaction().catch(() => {})
        const isTransient =
          txErr.code === 112 ||
          txErr.codeName === 'WriteConflict' ||
          txErr.name === 'WriteConflict' ||
          txErr.message?.includes('Write conflict') ||
          txErr.errorLabels?.has?.('TransientTransactionError') ||
          (Array.isArray(txErr.errorLabels) && txErr.errorLabels.includes('TransientTransactionError'))

        if (isTransient && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 40 * attempt))
          continue
        }
        throw txErr
      } finally {
        await session.endSession().catch(() => {})
      }
    }

    // Phase 2.4F Unified Paid Order Cancellation:
    // If payment was captured and autoRefund is enabled (req.body.autoRefund === true || req.body.refund === true),
    // execute unified initiateRefund via refundReconciliationService with source: 'cancellation'
    let refundResult = null
    const shouldAutoRefund = req.body?.autoRefund === true || req.body?.refund === true
    if (wasPaid && shouldAutoRefund) {
      const livePayment = await Payment.findOne({ orderId: liveOrder._id })
      if (livePayment && livePayment.refundableAmount > 0) {
        refundResult = await initiateRefund({
          orderId: liveOrder._id,
          amount: livePayment.refundableAmount,
          reason: `Order cancelled by admin: ${reason}`,
          user: req.user,
          role: 'admin',
          source: 'cancellation',
          idempotencyKey: `cancel_rfnd_${liveOrder._id}`,
        })
      }
    }

    const populated = await Order.findById(liveOrder._id).populate(
      'userId',
      'name email phone role isActive',
    )

    recordAuditLog({
      action: 'ADMIN_ORDER_CANCEL',
      actorType: 'ADMIN',
      actorId: req.user._id,
      actorEmail: req.user.email,
      resourceType: 'ORDER',
      resourceId: String(liveOrder._id),
      orderId: liveOrder._id,
      result: 'SUCCESS',
      reason,
      metadata: {
        orderNumber: liveOrder.orderNumber,
        wasPaid,
        refundInitiated: Boolean(refundResult),
      },
      req,
    })

    return res.json({
      success: true,
      message: 'Order cancelled successfully.',
      order: formatAdminOrder(populated || liveOrder),
      refund: refundResult?.refundDoc || refundResult?.refund || null,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Administrative Payment Reconciliation (POST /api/admin/orders/:id/reconcile)
 * Allows administrators to safely trigger an authoritative reconciliation against Razorpay.
 */
export async function reconcileAdminOrder(req, res, next) {
  try {
    const { id } = req.params
    if (!id || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_id',
          message: 'Valid order ID is required.',
        },
      })
    }

    const order = await Order.findById(id)
    if (!order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'order_not_found',
          message: 'Order not found.',
        },
      })
    }

    const reconResult = await reconcileOrderPayment({
      orderId: order._id,
      razorpayOrderId: order.razorpayOrderId,
      force: true,
    })

    const refreshedOrder = await Order.findById(order._id).populate(
      'userId',
      'name email phone role isActive',
    )
    const payment = await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 })

    // Safe sanitized payment details (zero secrets)
    const safePayment = payment
      ? {
          id: String(payment._id),
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          gateway: payment.gateway,
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          verified: payment.verified,
          gatewayStatus: payment.gatewayStatus,
          errorReason: payment.errorReason,
          reconciliationReason: payment.reconciliationReason,
          reconciliationAttempts: payment.reconciliationAttempts,
          lastReconciledAt: payment.lastReconciledAt,
        }
      : null

    return res.status(200).json({
      success: true,
      message: reconResult.message,
      reconciled: reconResult.reconciled,
      classification: reconResult.classification,
      data: {
        order: formatAdminOrder(refreshedOrder || order),
        payment: safePayment,
      },
    })
  } catch (err) {
    next(err)
  }
}

// 7. POST /api/admin/orders/:id/refund (Phase 2.4E)
export async function refundAdminOrder(req, res, next) {
  try {
    const rawId = String(req.params.id || '').trim()

    if (!mongoose.isValidObjectId(rawId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_order_id',
          message: 'Invalid MongoDB ObjectId provided.',
        },
      })
    }

    const { amount, reason, idempotencyKey, items, speed } = req.body || {}
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'refund_reason_required',
          message: 'A refund reason is required for administrative refunds.',
        },
      })
    }

    const clientKey =
      typeof idempotencyKey === 'string' && idempotencyKey.trim()
        ? idempotencyKey.trim()
        : req.headers['x-idempotency-key'] || null

    const result = await initiateRefund({
      orderId: rawId,
      amount,
      reason,
      user: req.user,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: clientKey,
      items: Array.isArray(items) ? items : [],
      speed: speed === 'optimum' ? 'optimum' : 'normal',
    })

    if (!result || !result.success) {
      return res.status(result?.statusCode || 400).json({
        success: false,
        error: {
          code: result?.errorCode || 'refund_failed',
          message: result?.message || 'Refund could not be initiated.',
        },
      })
    }

    const refreshedOrder = await Order.findById(rawId)

    return res.status(200).json({
      success: true,
      message: result.message,
      idempotent: Boolean(result.idempotent),
      data: {
        refund: {
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
        order: formatAdminOrder(refreshedOrder),
      },
    })
  } catch (err) {
    next(err)
  }
}

// 8. POST /api/admin/orders/:id/refunds/:refundId/reconcile (Phase 2.4E)
export async function reconcileAdminRefund(req, res, next) {
  try {
    const rawRefundId = String(req.params.refundId || '').trim()

    if (!mongoose.isValidObjectId(rawRefundId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_refund_id',
          message: 'Invalid MongoDB ObjectId provided.',
        },
      })
    }

    const result = await reconcileRefundRecord({ refundId: rawRefundId, force: true })
    if (!result.success) {
      return res.status(result.statusCode || 500).json({
        success: false,
        error: {
          code: 'reconciliation_failed',
          message: result.message || 'Failed to reconcile refund record.',
        },
      })
    }

    return res.status(200).json({
      success: true,
      data: result.refund,
    })
  } catch (err) {
    next(err)
  }
}



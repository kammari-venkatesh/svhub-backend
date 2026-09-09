import mongoose from 'mongoose'
import { Order } from '../models/Order.js'

const ORDER_STATUS_MAP = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PENDING: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
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

    const { status, paymentStatus, courier, trackingNumber, notes } = req.body || {}

    // Whitelist and validate Order Status
    if (status !== undefined) {
      const targetStatus = normalizeOrderStatus(status)
      if (!targetStatus) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_order_status',
            message: `Invalid order status: "${status}". Supported values are PENDING_PAYMENT, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED.`,
          },
        })
      }

      // Append status history only when status has actually changed
      if (order.status !== targetStatus) {
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
      order.paymentStatus = targetPayment
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

    order.status = 'CANCELLED'
    order.history = order.history || []
    order.history.push({
      status: 'CANCELLED',
      at: new Date(),
      note: reason,
    })

    // INVENTORY CRITICAL INSTRUCTION:
    // Do NOT automatically restore inventory. Phase 1.5 order creation did NOT deduct
    // stock from Products, so cancelling must NOT artificially increment product inventory.

    await order.save()

    res.json({
      success: true,
      message: 'Order cancelled successfully.',
      order: formatAdminOrder(order),
    })
  } catch (err) {
    next(err)
  }
}

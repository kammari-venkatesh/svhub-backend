/**
 * verify-processing-refund-cancel-interaction.js
 *
 * Production Audit: PROCESSING-refund + autoRefund=true Cancel Interaction
 *
 * Scenario:
 *   1. A payment has an existing PROCESSING refund (gateway call timed out).
 *      The refundable balance was already atomically reserved to 0.
 *   2. The order is then cancelled with autoRefund=true (the default).
 *
 * Verifies that the system NEVER produces:
 *   - A duplicate refund record
 *   - An over-refund (refundedAmount > capturedAmount)
 *   - Incorrect payment.refundedAmount
 *   - Incorrect payment.refundableAmount
 *   - Duplicate inventory restoration
 *   - Inconsistent Refund status
 *   - Inconsistent Order status
 *
 * Also covers:
 *   - PROCESSING refund completing via webhook after cancellation
 *   - Payment balance release when PROCESSING refund fails at gateway
 *   - Repeated cancel calls stay idempotent with no side effects
 */

import mongoose from 'mongoose'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import { setRazorpayClient, resetRazorpayClient, getRazorpayWebhookSecret } from '../src/config/razorpay.js'
import { cancelOrder } from '../src/services/orderCancellationService.js'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { jwtSecret } from '../src/utils/auth.js'

const PORT = 5097
const BASE_URL = `http://localhost:${PORT}`
let server

let passed = 0
let failed = 0
const failures = []

function assert(condition, label, detail = '') {
  if (condition) {
    passed++
    console.log(`  [PASS] ${label}`)
  } else {
    failed++
    const msg = `  [FAIL] ${label}${detail ? ' — ' + detail : ''}`
    console.error(msg)
    failures.push(msg)
  }
}

async function httpReq(path, options = {}) {
  const url = `${BASE_URL}/api${path}`
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const fetchOptions = { method: options.method || 'GET', headers }
  if (options.body !== undefined) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  }
  const res = await fetch(url, fetchOptions)
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

async function createFixtures(runId) {
  const admin = await User.create({
    name: 'Audit Admin',
    email: `audit_admin_${runId}@svhub.local`,
    role: 'ADMIN',
    isActive: true,
  })
  const customer = await User.create({
    name: 'Audit Customer',
    email: `audit_cust_${runId}@svhub.local`,
    role: 'CUSTOMER',
    isActive: true,
  })
  const product = await Product.create({
    name: `Audit Product ${runId}`,
    slug: `audit-product-${runId}`,
    type: 'Oil',
    storefront: 'nutri-hub',
    category: 'cooking-oil',
    description: 'Audit test product',
    image: 'https://example.com/img.jpg',
    price: 600,
    weight: '1L',
    sku: `AUDIT-SKU-${runId}`,
    qty: 50,
    isActive: true,
    variants: [{
      variantId: `var_${runId}`,
      sku: `AUDIT-VAR-${runId}`,
      label: '1L Bottle',
      weight: '1L',
      price: 600,
      qty: 50,
      isActive: true,
    }],
  })
  return { admin, customer, product }
}

async function createOrderFixture({ customer, product, runId, tag }) {
  const rzpOrderId = `rzpord_${runId}_${tag}_${Date.now()}`
  const rzpPayId = `pay_audit_${runId}_${tag}_${Date.now()}`

  const order = await Order.create({
    orderNumber: `AUDIT-${Date.now()}-${tag}`,
    userId: customer._id,
    customerName: customer.name,
    email: customer.email,
    phone: '9876543210',
    shippingAddress: { name: customer.name, phone: '9876543210', street: '1 Test St', city: 'Coimbatore', state: 'Tamil Nadu', pin: '641001', country: 'India' },
    items: [{
      productId: product._id,
      variantId: `var_${runId}`,
      productName: product.name,
      variantLabel: '1L Bottle',
      weight: '1L',
      sku: `AUDIT-VAR-${runId}`,
      unitPrice: 600,
      quantity: 2,
      lineTotal: 1200,
      restoredQuantity: 0,
    }],
    subtotal: 1200,
    shippingFee: 0,
    discount: 0,
    totalAmount: 1200,
    status: 'CONFIRMED',
    paymentStatus: 'SUCCESS',
    paymentMethod: 'razorpay',
    razorpayOrderId: rzpOrderId,
    inventoryDeducted: true,
    inventoryRestored: false,
  })

  // Deduct inventory
  await Product.updateOne(
    { _id: product._id, 'variants.variantId': `var_${runId}` },
    { $inc: { 'variants.$.qty': -2, qty: -2 } },
  )

  const payment = await Payment.create({
    orderId: order._id,
    userId: customer._id,
    amount: 1200,
    capturedAmount: 1200,
    refundedAmount: 0,
    refundableAmount: 1200,
    currency: 'INR',
    gateway: 'razorpay',
    status: 'SUCCESS',
    razorpayOrderId: rzpOrderId,
    razorpayPaymentId: rzpPayId,
  })

  return { order, payment }
}

function signWebhook(body) {
  const secret = getRazorpayWebhookSecret()
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

async function run() {
  console.log('\n=======================================================================')
  console.log('PROCESSING-REFUND + autoRefund=true CANCEL — PRODUCTION AUDIT SUITE')
  console.log('=======================================================================\n')

  await connectDb()
  server = app.listen(PORT)
  await new Promise((r) => setTimeout(r, 500))

  const cleanupUserIds = []
  const cleanupProductIds = []
  const cleanupOrderIds = []
  const cleanupPaymentIds = []
  const cleanupRefundIds = []

  const mockRzp = {
    orders: { create: async (p) => ({ id: `order_mock_${Date.now()}`, amount: p.amount, currency: 'INR', status: 'created' }) },
    payments: {
      refund: async (payId, params) => ({
        id: `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        entity: 'refund',
        amount: params.amount,
        currency: 'INR',
        payment_id: payId,
        status: 'processed',
        created_at: Math.floor(Date.now() / 1000),
      }),
    },
    refunds: { fetch: async (id) => ({ id, entity: 'refund', amount: 120000, status: 'processed' }) },
  }
  setRazorpayClient(mockRzp)

  try {
    const runId = `prc_${Date.now()}`
    const { admin, customer, product } = await createFixtures(runId)
    cleanupUserIds.push(admin._id, customer._id)
    cleanupProductIds.push(product._id)

    const adminUser = { _id: admin._id, email: admin.email, role: 'ADMIN' }

    // =======================================================================
    // SCENARIO 1
    // A PROCESSING refund has already reserved refundableAmount to 0.
    // Cancel with autoRefund=true fires.
    // Guard on line 275: refundableAmount > 0 is FALSE → no auto-refund.
    // =======================================================================
    console.log('--- Scenario 1: PROCESSING refund exists → cancel(autoRefund=true) skips auto-refund ---')

    const { order: o1, payment: p1 } = await createOrderFixture({ customer, product, runId, tag: 's1' })
    cleanupOrderIds.push(o1._id)
    cleanupPaymentIds.push(p1._id)

    const stock0 = (await Product.findById(product._id)).variants[0].qty

    // Simulate initiateRefund reserving the balance (step 6, line 244)
    await Payment.updateOne({ _id: p1._id }, { $set: { refundableAmount: 0 } })

    // Simulate the PROCESSING refund doc created before gateway call timed out
    const processingRefund = await Refund.create({
      orderId: o1._id,
      paymentId: p1._id,
      userId: customer._id,
      razorpayPaymentId: p1.razorpayPaymentId,
      amount: 1200,
      amountInPaise: 120000,
      currency: 'INR',
      status: 'PROCESSING',
      reason: 'Customer refund (gateway timeout)',
      requestedBy: customer._id,
      requestedByRole: 'customer',
      source: 'customer_request',
      idempotencyKey: `prc_ext_${o1._id}_${Date.now()}`,
      isFullRefund: true,
      inventoryRestorationStatus: 'NOT_RESTORED',
    })
    cleanupRefundIds.push(processingRefund._id)

    const cancelR1 = await cancelOrder({ orderId: o1._id, user: adminUser, role: 'admin', reason: 'Cancel while processing refund', autoRefund: true })

    assert(cancelR1.success === true, 'S1.1: cancelOrder returns success=true')
    assert(cancelR1.idempotent !== true, 'S1.2: Not flagged idempotent (first cancel)')

    const o1Doc = await Order.findById(o1._id)
    assert(o1Doc.status === 'CANCELLED', 'S1.3: Order.status = CANCELLED')
    assert(o1Doc.inventoryRestored === true, 'S1.4: Order.inventoryRestored = true')

    const allRefunds1 = await Refund.find({ orderId: o1._id })
    assert(allRefunds1.length === 1, `S1.5: Exactly 1 Refund doc (found ${allRefunds1.length}) — no duplicate created`)

    const p1Doc = await Payment.findById(p1._id)
    assert(p1Doc.refundedAmount === 0, `S1.6: refundedAmount = 0 (PROCESSING not yet complete) — got ${p1Doc.refundedAmount}`)
    assert(p1Doc.refundableAmount === 0, `S1.7: refundableAmount = 0 (reservation intact) — got ${p1Doc.refundableAmount}`)
    assert(p1Doc.refundedAmount <= p1Doc.capturedAmount, 'S1.8: Hard invariant: refundedAmount ≤ capturedAmount')

    const refund1Doc = await Refund.findById(processingRefund._id)
    assert(refund1Doc.status === 'PROCESSING', `S1.9: Existing refund.status still PROCESSING (not mutated by cancel) — got ${refund1Doc.status}`)

    const stock1 = (await Product.findById(product._id)).variants[0].qty
    assert(stock1 === stock0 + 2, `S1.10: Stock restored exactly once (+2) by cancellation. ${stock0} → ${stock1}`)

    console.log()

    // =======================================================================
    // SCENARIO 2
    // The PROCESSING refund from S1 later completes via refund.processed webhook.
    // Expected: Refund→PROCESSED, payment.refundedAmount=1200, refundableAmount=0,
    // inventoryRestorationStatus=NOT_APPLICABLE, no extra stock restored.
    // =======================================================================
    console.log('--- Scenario 2: PROCESSING refund completes via webhook after cancellation ---')

    const stockBefore2 = (await Product.findById(product._id)).variants[0].qty

    const wbPayload2 = JSON.stringify({
      id: `evt_audit_s2_${Date.now()}`,
      entity: 'event',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: `rfnd_late_s2_${Date.now()}`,
            payment_id: p1.razorpayPaymentId,
            amount: 120000,
            currency: 'INR',
            status: 'processed',
            receipt: String(processingRefund._id),
          },
        },
      },
    })
    const webhookRes2 = await httpReq('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': signWebhook(wbPayload2) },
      body: wbPayload2,
    })

    assert(webhookRes2.status === 200, `S2.1: Webhook returns 200 (got ${webhookRes2.status})`)

    const refund2Doc = await Refund.findById(processingRefund._id)
    assert(refund2Doc.status === 'PROCESSED', `S2.2: Refund status = PROCESSED (got ${refund2Doc.status})`)
    assert(
      refund2Doc.inventoryRestorationStatus === 'NOT_APPLICABLE',
      `S2.3: inventoryRestorationStatus = NOT_APPLICABLE (order already restored by cancel) — got ${refund2Doc.inventoryRestorationStatus}`,
    )

    const p2Doc = await Payment.findById(p1._id)
    assert(p2Doc.refundedAmount === 1200, `S2.4: refundedAmount = 1200 after webhook (got ${p2Doc.refundedAmount})`)
    assert(p2Doc.refundableAmount === 0, `S2.5: refundableAmount = 0 (got ${p2Doc.refundableAmount})`)
    assert(p2Doc.refundedAmount <= p2Doc.capturedAmount, 'S2.6: Hard invariant: refundedAmount ≤ capturedAmount')
    assert(p2Doc.status === 'REFUNDED', `S2.7: Payment.status = REFUNDED (got ${p2Doc.status})`)

    const stockAfter2 = (await Product.findById(product._id)).variants[0].qty
    assert(stockAfter2 === stockBefore2, `S2.8: No additional stock restored by webhook (${stockBefore2} → ${stockAfter2})`)

    console.log()

    // =======================================================================
    // SCENARIO 3
    // Repeated cancel after full refund completes. Must stay idempotent.
    // =======================================================================
    console.log('--- Scenario 3: Repeated cancel after full refund — idempotent ---')

    const stockBefore3 = (await Product.findById(product._id)).variants[0].qty
    const refundsBefore3 = await Refund.countDocuments({ orderId: o1._id })

    const cancelR3 = await cancelOrder({ orderId: o1._id, user: adminUser, role: 'admin', reason: 'Repeated cancel', autoRefund: true })

    assert(cancelR3.success === true, 'S3.1: Returns success=true')
    assert(cancelR3.idempotent === true, 'S3.2: Returns idempotent=true')
    assert(
      await Refund.countDocuments({ orderId: o1._id }) === refundsBefore3,
      `S3.3: No new refund created (still ${refundsBefore3} refund docs)`,
    )

    const p3Doc = await Payment.findById(p1._id)
    assert(p3Doc.refundedAmount === 1200, `S3.4: refundedAmount unchanged at 1200 (got ${p3Doc.refundedAmount})`)
    assert(p3Doc.refundableAmount === 0, `S3.5: refundableAmount unchanged at 0 (got ${p3Doc.refundableAmount})`)

    const stockAfter3 = (await Product.findById(product._id)).variants[0].qty
    assert(stockAfter3 === stockBefore3, `S3.6: Stock unchanged on idempotent cancel`)

    console.log()

    // =======================================================================
    // SCENARIO 4
    // PROCESSING refund fails permanently at gateway → balance released back.
    // Then order is cancelled with autoRefund=true.
    // Cancel SHOULD detect refundableAmount=1200 and create the auto-refund.
    // =======================================================================
    console.log('--- Scenario 4: PROCESSING refund FAILS → balance released → cancel creates auto-refund ---')

    const { order: o4, payment: p4 } = await createOrderFixture({ customer, product, runId, tag: 's4' })
    cleanupOrderIds.push(o4._id)
    cleanupPaymentIds.push(p4._id)

    const stockBefore4 = (await Product.findById(product._id)).variants[0].qty

    // Simulate reserve
    await Payment.updateOne({ _id: p4._id }, { $set: { refundableAmount: 0 } })
    const failedRefund = await Refund.create({
      orderId: o4._id,
      paymentId: p4._id,
      userId: customer._id,
      razorpayPaymentId: p4.razorpayPaymentId,
      amount: 1200,
      amountInPaise: 120000,
      currency: 'INR',
      status: 'FAILED',
      reason: 'Customer refund request (gateway rejected)',
      requestedBy: customer._id,
      requestedByRole: 'customer',
      source: 'customer_request',
      idempotencyKey: `prc_fail_${o4._id}`,
      isFullRefund: true,
      inventoryRestorationStatus: 'NOT_RESTORED',
      failureCode: 'GATEWAY_ERROR',
      safeFailureReason: 'Permanent gateway rejection',
    })
    cleanupRefundIds.push(failedRefund._id)

    // Simulate gateway failure releasing the balance (initiateRefund line 356-359)
    await Payment.updateOne({ _id: p4._id }, { $inc: { refundableAmount: 1200 } })

    const p4released = await Payment.findById(p4._id)
    assert(p4released.refundableAmount === 1200, `S4.1: Balance released to 1200 after gateway failure (got ${p4released.refundableAmount})`)

    const cancelR4 = await cancelOrder({ orderId: o4._id, user: adminUser, role: 'admin', reason: 'Admin cancel post-failure', autoRefund: true })
    assert(cancelR4.success === true, 'S4.2: Cancel succeeds after refund failure')

    const allRefunds4 = await Refund.find({ orderId: o4._id })
    assert(allRefunds4.length === 2, `S4.3: 2 refund docs: original FAILED + auto-refund (found ${allRefunds4.length})`)

    const autoRef4 = allRefunds4.find((r) => String(r._id) !== String(failedRefund._id))
    assert(Boolean(autoRef4), 'S4.4: Auto-refund doc exists')
    assert(['PROCESSED', 'CREATED', 'PROCESSING'].includes(autoRef4?.status), `S4.5: Auto-refund in valid active status (got ${autoRef4?.status})`)
    assert(autoRef4?.source === 'cancellation', `S4.6: Auto-refund source = cancellation (got ${autoRef4?.source})`)
    if (autoRef4?._id) cleanupRefundIds.push(autoRef4._id)

    const p4Final = await Payment.findById(p4._id)
    assert(p4Final.refundedAmount <= p4Final.capturedAmount, 'S4.7: Hard invariant: refundedAmount ≤ capturedAmount')
    assert(p4Final.refundableAmount >= 0, 'S4.8: Hard invariant: refundableAmount ≥ 0')

    const o4Doc = await Order.findById(o4._id)
    assert(o4Doc.status === 'CANCELLED', 'S4.9: Order.status = CANCELLED')
    assert(o4Doc.inventoryRestored === true, 'S4.10: Order.inventoryRestored = true')

    const stockAfter4 = (await Product.findById(product._id)).variants[0].qty
    assert(stockAfter4 === stockBefore4 + 2, `S4.11: Stock restored exactly once (+2). ${stockBefore4} → ${stockAfter4}`)

    console.log()

    // =======================================================================
    // SCENARIO 5: Global financial invariants across all test payments
    // =======================================================================
    console.log('--- Scenario 5: Global financial invariant scan ---')

    const allPayments = await Payment.find({ _id: { $in: cleanupPaymentIds } })
    for (const pmt of allPayments) {
      const cap = pmt.capturedAmount ?? pmt.amount
      assert(pmt.refundedAmount >= 0, `S5: Payment ${pmt._id} refundedAmount >= 0 (${pmt.refundedAmount})`)
      assert(pmt.refundableAmount >= 0, `S5: Payment ${pmt._id} refundableAmount >= 0 (${pmt.refundableAmount})`)
      assert(pmt.refundedAmount <= cap + 0.01, `S5: Payment ${pmt._id} refundedAmount (${pmt.refundedAmount}) <= capturedAmount (${cap})`)
    }

    const allOrders = await Order.find({ _id: { $in: cleanupOrderIds } })
    for (const ord of allOrders) {
      for (const item of ord.items || []) {
        const restoredQty = Number(item.restoredQuantity) || 0
        const orderedQty = Number(item.quantity) || 0
        assert(restoredQty <= orderedQty, `S5: Order ${ord._id} item restoredQty (${restoredQty}) <= orderedQty (${orderedQty})`)
      }
    }

  } finally {
    console.log('\n--- Cleaning up ---')
    await Refund.deleteMany({ _id: { $in: cleanupRefundIds.filter(Boolean) } }).catch(() => {})
    await Payment.deleteMany({ _id: { $in: cleanupPaymentIds } }).catch(() => {})
    await Order.deleteMany({ _id: { $in: cleanupOrderIds } }).catch(() => {})
    await Product.deleteMany({ _id: { $in: cleanupProductIds } }).catch(() => {})
    await User.deleteMany({ _id: { $in: cleanupUserIds } }).catch(() => {})
    resetRazorpayClient()
    if (server) server.close()
  }

  console.log('\n=======================================================================')
  if (failed === 0) {
    console.log(`PROCESSING-REFUND AUDIT: ALL ${passed} ASSERTIONS PASSED`)
  } else {
    console.log(`PROCESSING-REFUND AUDIT: ${passed} PASSED | ${failed} FAILED`)
    console.log('\nFAILURES:')
    failures.forEach((f) => console.error(f))
  }
  console.log('=======================================================================\n')
}

run().then(() => process.exit(failed > 0 ? 1 : 0)).catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})

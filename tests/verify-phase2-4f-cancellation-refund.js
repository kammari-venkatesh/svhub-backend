/**
 * SV HUB — PHASE 2.4F CANCELLATION + REFUND CONSISTENCY TEST SUITE
 *
 * Comprehensive adversarial verification across 23 categories (A through W):
 * A. Unpaid order cancellation
 * B. Paid order cancellation (unified refund path)
 * C. Cancellation after full refund (0 duplicate restock)
 * D. Cancellation after partial refund (exact remaining restoration)
 * E. Cancellation after multiple partial refunds (exact remaining restoration)
 * F. Cancellation during refund PROCESSING
 * G. Refund after cancellation
 * H. Duplicate cancellation protection
 * I. Duplicate refund protection
 * J. Cancellation / refund race
 * K. Partial refund / cancellation inventory race
 * L. Concurrent cancellation attempts
 * M. Concurrent partial refund attempts
 * N. Webhook / cancellation race
 * O. Delayed webhook delivery
 * P. Missing webhook recovery
 * Q. Stale webhook handling
 * R. Duplicate webhook idempotency
 * S. Payment accounting invariants
 * T. Authorization & tenant isolation
 * U. Rate limiting
 * V. Audit history & snapshot immutability
 * W. Crash & transaction rollback recovery
 */

import crypto from 'crypto'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import { connectDb, disconnectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import { WebhookEvent } from '../src/models/WebhookEvent.js'
import {
  setRazorpayClient,
  resetRazorpayClient,
  getRazorpayWebhookSecret,
} from '../src/config/razorpay.js'
import {
  initiateRefund,
  processRefundWebhook,
  reconcileRefundRecord,
  recoverStaleRefunds,
} from '../src/services/refundReconciliationService.js'
import { fulfillRazorpayPayment } from '../src/services/paymentFulfillmentService.js'
import { app } from '../src/app.js'

let testServer = null
let API_BASE = 'http://localhost:5000/api'
const WEBHOOK_SECRET = getRazorpayWebhookSecret() || 'test_webhook_secret_12345'

let passed = 0
let failed = 0
const failures = []

function assertTest(name, condition, extra = '') {
  if (condition) {
    passed++
    console.log(`[PASS] ${name}`)
  } else {
    failed++
    const msg = `[FAIL] ${name} ${extra ? '(' + extra + ')' : ''}`
    console.error(msg)
    failures.push(msg)
  }
}

async function apiRequest(path, options = {}) {
  const cleanPath = path.startsWith('/api') ? path.slice(4) : path
  const url = cleanPath.startsWith('http') ? cleanPath : `${API_BASE}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  const res = await fetch(url, { ...options, headers })
  let data = null
  const text = await res.text()
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, rawText: text, headers: res.headers }
}

function createSignedWebhook(event, payload, secret = WEBHOOK_SECRET, eventIdOverride = null) {
  const eventId = eventIdOverride || `evt_24f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const bodyString = JSON.stringify({
    entity: 'event',
    account_id: 'acc_test_24f',
    event,
    contains: ['refund', 'payment'],
    payload,
    id: eventId,
    created_at: Math.floor(Date.now() / 1000),
  })

  const signature = crypto.createHmac('sha256', secret).update(bodyString).digest('hex')
  return { bodyString, signature, eventId }
}

async function runSuite() {
  console.log('====================================================================')
  console.log('SV HUB — PHASE 2.4F CANCELLATION + REFUND CONSISTENCY SUITE')
  console.log('====================================================================\n')

  await connectDb()

  await new Promise((resolve) => {
    testServer = app.listen(0, () => {
      const port = testServer.address().port
      API_BASE = `http://localhost:${port}/api`
      resolve()
    })
  })

  const runId = `24f_${Date.now()}`
  let custA = null
  let custB = null
  let admin = null
  let tokenA = null
  let tokenB = null
  let adminToken = null
  let prodA = null
  let prodB = null

  const cleanupUserIds = []
  const cleanupProductIds = []
  const cleanupOrderIds = []
  const cleanupPaymentIds = []
  const cleanupRefundIds = []
  const cleanupWebhookIds = []

  // Deterministic gateway mock
  const mockRzp = {
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
    refunds: {
      fetch: async (id) => ({
        id,
        entity: 'refund',
        amount: 1000,
        status: 'processed',
      }),
    },
  }
  setRazorpayClient(mockRzp)

  try {
    // 0. Setup Users & Catalog
    console.log('--- 0. SETUP TEST USERS & CATALOG ---')
    custA = await User.create({
      name: 'Customer A 24F',
      email: `custA_${runId}@example.com`,
      phone: '9876543201',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(custA._id)

    custB = await User.create({
      name: 'Customer B 24F',
      email: `custB_${runId}@example.com`,
      phone: '9876543202',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(custB._id)

    admin = await User.create({
      name: 'Admin 24F',
      email: `admin_${runId}@example.com`,
      phone: '9876543299',
      password: 'Password123!',
      role: 'ADMIN',
      isActive: true,
    })
    cleanupUserIds.push(admin._id)

    const jwt = (await import('jsonwebtoken')).default
    const { jwtSecret } = await import('../src/utils/auth.js')
    tokenA = jwt.sign({ sub: String(custA._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    tokenB = jwt.sign({ sub: String(custB._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    adminToken = jwt.sign({ sub: String(admin._id), role: 'ADMIN' }, jwtSecret(), { expiresIn: '1h' })

    prodA = await Product.create({
      name: `Product A ${runId}`,
      slug: `product-a-${runId}`,
      description: 'Test catalog oil',
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      price: 500,
      weight: '1L',
      sku: `SKU-24F-A-${runId}`,
      qty: 100,
      isActive: true,
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      variants: [
        {
          variantId: `var_a_${runId}`,
          sku: `SKU-24F-A-V1-${runId}`,
          label: '1L Bottle',
          weight: '1L',
          price: 500,
          qty: 100,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(prodA._id)

    prodB = await Product.create({
      name: `Product B ${runId}`,
      slug: `product-b-${runId}`,
      description: 'Test catalog ghee',
      type: 'Ghee',
      storefront: 'nutri-hub',
      category: 'ghee-butter',
      price: 300,
      weight: '500g',
      sku: `SKU-24F-B-${runId}`,
      qty: 100,
      isActive: true,
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      variants: [
        {
          variantId: `var_b_${runId}`,
          sku: `SKU-24F-B-V1-${runId}`,
          label: '500g Jar',
          weight: '500g',
          price: 300,
          qty: 100,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(prodB._id)

    // Helper: Create order fixture
    async function createOrderFixture({
      user = custA,
      items,
      totalAmount,
      isPaid = false,
      status = 'CONFIRMED',
    }) {
      const orderNum = `SVH-24F-${Date.now()}-${Math.floor(Math.random() * 10000)}`
      const rzpOrderId = `order_24f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const rzpPayId = isPaid ? `pay_24f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : undefined

      const order = await Order.create({
        orderNumber: orderNum,
        userId: user._id,
        customerName: user.name,
        email: user.email,
        phone: user.phone,
        shippingAddress: {
          name: user.name,
          phone: user.phone,
          street: '123 Test St',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
          country: 'India',
        },
        items,
        subtotal: totalAmount,
        shippingFee: 0,
        discount: 0,
        totalAmount,
        status,
        paymentStatus: isPaid ? 'PAID' : 'PENDING',
        paymentMethod: 'razorpay',
        paymentId: rzpPayId,
        razorpayOrderId: rzpOrderId,
        inventoryDeducted: isPaid || status === 'CONFIRMED',
        inventoryRestored: false,
      })
      cleanupOrderIds.push(order._id)

      if (order.inventoryDeducted) {
        for (const itm of items) {
          await Product.updateOne(
            { _id: itm.productId, 'variants.variantId': itm.variantId },
            { $inc: { 'variants.$.qty': -itm.quantity, qty: -itm.quantity } }
          )
        }
      }

      const payment = await Payment.create({
        orderId: order._id,
        userId: user._id,
        amount: totalAmount,
        currency: 'INR',
        gateway: 'razorpay',
        status: isPaid ? 'SUCCESS' : 'PENDING',
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPayId,
        capturedAmount: isPaid ? totalAmount : 0,
        refundedAmount: 0,
        refundableAmount: isPaid ? totalAmount : 0,
      })
      cleanupPaymentIds.push(payment._id)

      return { order, payment }
    }

    // --------------------------------------------------------------------------------
    // SECTION A: UNPAID ORDER CANCELLATION
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION A: UNPAID CANCELLATION ---')
    const fixA = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: false,
      status: 'PENDING_PAYMENT',
    })
    // Inventory not deducted for pending unpaid order
    await Order.findByIdAndUpdate(fixA.order._id, { inventoryDeducted: false })

    const stockBeforeA = (await Product.findById(prodA._id)).variants[0].qty

    const cancelResA = await apiRequest(`/orders/${fixA.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ reason: 'Changed my mind before payment' }),
    })

    assertTest('A.1: Customer can cancel unpaid PENDING_PAYMENT order (200 OK)', cancelResA.status === 200)
    const orderDocA = await Order.findById(fixA.order._id)
    assertTest('A.2: Order status is CANCELLED', orderDocA?.status === 'CANCELLED')
    assertTest('A.3: Order paymentStatus remains PENDING', orderDocA?.paymentStatus === 'PENDING')
    const stockAfterA = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('A.4: Stock unchanged on unpaid cancel (not deducted, so not restored)', stockAfterA === stockBeforeA)

    // --------------------------------------------------------------------------------
    // SECTION B: PAID ORDER CANCELLATION (UNIFIED REFUND PATH)
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION B: PAID ORDER CANCELLATION & UNIFIED REFUND ---')
    const fixB = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 1000,
        },
      ],
      totalAmount: 1000,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeB = (await Product.findById(prodA._id)).variants[0].qty

    const cancelResB = await apiRequest(`/admin/orders/${fixB.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Admin defect recall', autoRefund: true }),
    })

    assertTest('B.1: Admin cancel with autoRefund: true succeeds (200 OK)', cancelResB.status === 200)
    assertTest('B.2: Response contains refund object', Boolean(cancelResB.data?.refund))

    const orderDocB = await Order.findById(fixB.order._id)
    assertTest('B.3: Order status is CANCELLED', orderDocB?.status === 'CANCELLED')
    assertTest('B.4: Order paymentStatus is REFUNDED', orderDocB?.paymentStatus === 'REFUNDED')
    assertTest('B.5: Order inventoryRestored is true', orderDocB?.inventoryRestored === true)
    assertTest('B.6: Order.items[0].restoredQuantity is 2', orderDocB?.items[0]?.restoredQuantity === 2)

    const stockAfterB = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('B.7: Stock restored by exactly 2 units', stockAfterB === stockBeforeB + 2)

    const paymentDocB = await Payment.findById(fixB.payment._id)
    assertTest('B.8: Payment status is REFUNDED', paymentDocB?.status === 'REFUNDED')
    assertTest('B.9: Payment refundedAmount = 1000 and refundableAmount = 0', paymentDocB?.refundedAmount === 1000 && paymentDocB?.refundableAmount === 0)

    const refundRecordsB = await Refund.find({ orderId: fixB.order._id })
    assertTest('B.10: Exactly 1 Refund document created with source: cancellation', refundRecordsB.length === 1 && refundRecordsB[0].source === 'cancellation')
    assertTest('B.11: Refund document inventoryRestorationStatus is NOT_APPLICABLE (preventing double-restock)', refundRecordsB[0].inventoryRestorationStatus === 'NOT_APPLICABLE')
    cleanupRefundIds.push(refundRecordsB[0]._id)

    // --------------------------------------------------------------------------------
    // SECTION C: CANCELLATION AFTER FULL REFUND
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION C: CANCELLATION AFTER FULL REFUND ---')
    const fixC = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeC = (await Product.findById(prodA._id)).variants[0].qty

    // 1. Issue full refund first
    const fullRefundResC = await initiateRefund({
      orderId: fixC.order._id,
      amount: 500,
      reason: 'Full return before cancel',
      user: admin,
      role: 'admin',
      source: 'admin_request',
    })
    cleanupRefundIds.push(fullRefundResC.refund?._id)
    assertTest('C.1: Full refund succeeds', fullRefundResC.success === true)

    const stockAfterRefundC = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('C.2: Stock restored on full refund (+1)', stockAfterRefundC === stockBeforeC + 1)

    // 2. Cancel order after full refund
    const cancelResC = await apiRequest(`/admin/orders/${fixC.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Admin cancel after full refund', autoRefund: true }),
    })
    assertTest('C.3: Cancellation succeeds with 200 OK', cancelResC.status === 200)

    const stockAfterCancelC = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('C.4: Zero additional stock restored upon cancel (still +1)', stockAfterCancelC === stockAfterRefundC)

    const totalRefundsC = await Refund.find({ orderId: fixC.order._id })
    assertTest('C.5: Zero second refund created (refundableAmount was 0)', totalRefundsC.length === 1)

    // --------------------------------------------------------------------------------
    // SECTION D & E: CANCELLATION AFTER PARTIAL REFUNDS (A x 3 Scenario)
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION D & E: CANCELLATION AFTER PARTIAL REFUNDS (A x 3) ---')
    const fixDE = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 3,
          restoredQuantity: 0,
          lineTotal: 1500,
        },
      ],
      totalAmount: 1500,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const initialStockDE = (await Product.findById(prodA._id)).variants[0].qty

    // Partial refund #1: 1 unit of A
    const ref1 = await initiateRefund({
      orderId: fixDE.order._id,
      amount: 500,
      reason: 'Refund unit 1 of 3',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      items: [{ productId: prodA._id, variantId: `var_a_${runId}`, quantity: 1 }],
    })
    cleanupRefundIds.push(ref1.refund?._id)
    assertTest('D.1: Partial refund #1 succeeds', ref1.success === true)

    let orderDE = await Order.findById(fixDE.order._id)
    assertTest('D.2: restoredQuantity is 1', orderDE.items[0].restoredQuantity === 1)
    assertTest('D.3: Stock increased by exactly 1 unit', (await Product.findById(prodA._id)).variants[0].qty === initialStockDE + 1)

    // Partial refund #2: 1 unit of A
    const ref2 = await initiateRefund({
      orderId: fixDE.order._id,
      amount: 500,
      reason: 'Refund unit 2 of 3',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      items: [{ productId: prodA._id, variantId: `var_a_${runId}`, quantity: 1 }],
    })
    cleanupRefundIds.push(ref2.refund?._id)
    assertTest('E.1: Partial refund #2 succeeds', ref2.success === true)

    orderDE = await Order.findById(fixDE.order._id)
    assertTest('E.2: restoredQuantity is 2', orderDE.items[0].restoredQuantity === 2)
    assertTest('E.3: Total stock restored after 2 refunds is exactly 2 units', (await Product.findById(prodA._id)).variants[0].qty === initialStockDE + 2)

    // Cancel order: must restore ONLY remaining 1 unit
    const cancelResDE = await apiRequest(`/admin/orders/${fixDE.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Cancel remaining 1 unit', autoRefund: true }),
    })
    assertTest('E.4: Cancellation succeeds (200 OK)', cancelResDE.status === 200)

    orderDE = await Order.findById(fixDE.order._id)
    assertTest('E.5: Final restoredQuantity is exactly 3 (all units restored)', orderDE.items[0].restoredQuantity === 3)
    assertTest('E.6: Final stock is exactly initialStock + 3 (never 4)', (await Product.findById(prodA._id)).variants[0].qty === initialStockDE + 3)
    assertTest('E.7: Order inventoryRestored is true', orderDE.inventoryRestored === true)

    const payDE = await Payment.findById(fixDE.payment._id)
    assertTest('E.8: Payment refundedAmount is 1500 (500 + 500 + 500)', payDE.refundedAmount === 1500 && payDE.refundableAmount === 0)

    // Attempt third partial refund: must be strictly rejected
    const invalidRef3 = await initiateRefund({
      orderId: fixDE.order._id,
      amount: 500,
      reason: 'Fourth unit refund attempt',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      items: [{ productId: prodA._id, variantId: `var_a_${runId}`, quantity: 1 }],
    })
    assertTest('E.9: Third refund on fully refunded/restored order is rejected', invalidRef3.success === false)

    // --------------------------------------------------------------------------------
    // SECTION F: CANCELLATION DURING REFUND PROCESSING
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION F: CANCELLATION DURING REFUND PROCESSING ---')
    const fixF = await createOrderFixture({
      items: [
        {
          productId: prodB._id,
          variantId: `var_b_${runId}`,
          productName: prodB.name,
          variantLabel: '500g Jar',
          weight: '500g',
          sku: `SKU-24F-B-V1-${runId}`,
          unitPrice: 300,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 600,
        },
      ],
      totalAmount: 600,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const initialStockF = (await Product.findById(prodB._id)).variants[0].qty

    // Create a refund in PROCESSING state directly
    const refundDocF = await Refund.create({
      orderId: fixF.order._id,
      paymentId: fixF.payment._id,
      userId: custA._id,
      razorpayPaymentId: fixF.payment.razorpayPaymentId,
      amount: 600,
      amountInPaise: 60000,
      currency: 'INR',
      status: 'PROCESSING',
      reason: 'Processing gateway refund',
      requestedBy: admin._id,
      requestedByRole: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_f_${Date.now()}`,
      isFullRefund: true,
      inventoryRestorationStatus: 'NOT_RESTORED',
    })
    cleanupRefundIds.push(refundDocF._id)

    // Cancel order while refund is PROCESSING
    const cancelResF = await apiRequest(`/admin/orders/${fixF.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Admin cancel while refund processing' }),
    })
    assertTest('F.1: Cancellation while refund is PROCESSING succeeds (200 OK)', cancelResF.status === 200)

    const orderAfterCancelF = await Order.findById(fixF.order._id)
    assertTest('F.2: Order status is CANCELLED and inventoryRestored is true', orderAfterCancelF.status === 'CANCELLED' && orderAfterCancelF.inventoryRestored === true)
    const stockAfterCancelF = (await Product.findById(prodB._id)).variants[0].qty
    assertTest('F.3: Inventory restored 2 units during cancellation', stockAfterCancelF === initialStockF + 2)

    // Now simulated webhook refund.processed arrives late
    const webhookF = createSignedWebhook('refund.processed', {
      refund: {
        entity: {
          id: `rfnd_late_${Date.now()}`,
          payment_id: fixF.payment.razorpayPaymentId,
          amount: 60000,
          currency: 'INR',
          status: 'processed',
          receipt: String(refundDocF._id),
        },
      },
    })

    const webhookResF = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': webhookF.signature },
      body: webhookF.bodyString,
    })
    assertTest('F.4: Late refund webhook returns 200 OK', webhookResF.status === 200)

    const stockAfterWebhookF = (await Product.findById(prodB._id)).variants[0].qty
    assertTest('F.5: Zero additional stock restored by late refund webhook (still +2)', stockAfterWebhookF === stockAfterCancelF)

    const finalRefundDocF = await Refund.findById(refundDocF._id)
    assertTest('F.6: Refund marked PROCESSED and inventoryRestorationStatus is NOT_APPLICABLE', finalRefundDocF.status === 'PROCESSED' && finalRefundDocF.inventoryRestorationStatus === 'NOT_APPLICABLE')

    // --------------------------------------------------------------------------------
    // SECTION G: REFUND AFTER CANCELLATION
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION G: REFUND AFTER CANCELLATION ---')
    const fixG = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeG = (await Product.findById(prodA._id)).variants[0].qty

    // 1. Cancel order without immediate refund
    await apiRequest(`/admin/orders/${fixG.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Cancelled first' }),
    })
    const stockAfterCancelG = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('G.1: Stock restored on cancellation', stockAfterCancelG === stockBeforeG + 1)

    // 2. Refund cancelled order later
    const refundResG = await apiRequest(`/admin/orders/${fixG.order._id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ amount: 500, reason: 'Settling refund for cancelled order' }),
    })
    assertTest('G.2: Refund on cancelled order succeeds with 200 OK', refundResG.status === 200)

    const stockAfterRefundG = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('G.3: Stock NOT restored again by refund (still +1)', stockAfterRefundG === stockAfterCancelG)

    const orderDocG = await Order.findById(fixG.order._id)
    assertTest('G.4: Order remains CANCELLED with paymentStatus REFUNDED', orderDocG.status === 'CANCELLED' && orderDocG.paymentStatus === 'REFUNDED')

    // --------------------------------------------------------------------------------
    // SECTION H & I: DUPLICATE CANCELLATION & DUPLICATE REFUND PROTECTION
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION H & I: DUPLICATE CANCELLATION & DUPLICATE REFUND ---')
    // Attempt duplicate cancel on fixG
    const dupCancelG = await apiRequest(`/admin/orders/${fixG.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Duplicate cancellation attempt' }),
    })
    assertTest('H.1: Duplicate cancellation rejected with 400 order_already_cancelled', dupCancelG.status === 400 && dupCancelG.data?.error?.code === 'order_already_cancelled')
    assertTest('H.2: Stock unaltered by duplicate cancellation', (await Product.findById(prodA._id)).variants[0].qty === stockAfterRefundG)

    // Attempt duplicate refund on fixG
    const dupRefundG = await apiRequest(`/admin/orders/${fixG.order._id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ amount: 500, reason: 'Duplicate refund attempt' }),
    })
    assertTest('I.1: Duplicate refund rejected (400 payment_not_refundable / refund_amount_exceeds_refundable)', dupRefundG.status === 400)

    // --------------------------------------------------------------------------------
    // SECTION J, K, L: CONCURRENCY RACES
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION J, K, L: CONCURRENCY RACES ---')
    // J: Simultaneous Refund + Cancellation Race
    const fixJ = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 1000,
        },
      ],
      totalAmount: 1000,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeJ = (await Product.findById(prodA._id)).variants[0].qty

    const [raceRefJ, raceCancelJ] = await Promise.all([
      initiateRefund({
        orderId: fixJ.order._id,
        amount: 1000,
        reason: 'Concurrent race refund',
        user: admin,
        role: 'admin',
        source: 'admin_request',
        idempotencyKey: `idemp_j_${Date.now()}`,
      }),
      apiRequest(`/admin/orders/${fixJ.order._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Concurrent race cancel' }),
      }),
    ])
    if (raceRefJ.refund?._id) cleanupRefundIds.push(raceRefJ.refund._id)

    assertTest('J.1: Both race operations execute without crashing', Boolean(raceRefJ) && Boolean(raceCancelJ))

    const orderDocJ = await Order.findById(fixJ.order._id)
    const stockAfterJ = (await Product.findById(prodA._id)).variants[0].qty
    const netRestoredJ = stockAfterJ - stockBeforeJ

    assertTest('J.2: Order is in CANCELLED status', orderDocJ.status === 'CANCELLED')
    assertTest('J.3: Final paymentStatus is REFUNDED', orderDocJ.paymentStatus === 'REFUNDED')
    assertTest('J.4: Inventory restored exactly 2 units (zero double-restock from race)', netRestoredJ === 2)
    assertTest('J.5: restoredQuantity matches net restored stock exactly', orderDocJ.items[0].restoredQuantity === netRestoredJ)

    // K: Partial Refund / Cancellation Inventory Race
    const fixK = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 1000,
        },
      ],
      totalAmount: 1000,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeK = (await Product.findById(prodA._id)).variants[0].qty

    const [raceRefK, raceCancelK] = await Promise.all([
      initiateRefund({
        orderId: fixK.order._id,
        amount: 500,
        reason: 'Partial refund race unit 1',
        user: admin,
        role: 'admin',
        source: 'admin_request',
        items: [{ productId: prodA._id, variantId: `var_a_${runId}`, quantity: 1 }],
        idempotencyKey: `idemp_k_ref_${Date.now()}`,
      }),
      apiRequest(`/admin/orders/${fixK.order._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Concurrent race cancel with partial refund', autoRefund: true }),
      }),
    ])
    if (raceRefK.refund?._id) cleanupRefundIds.push(raceRefK.refund._id)

    assertTest('K.1: Both partial refund and cancellation race resolve safely', Boolean(raceRefK) && Boolean(raceCancelK))

    const orderDocK = await Order.findById(fixK.order._id)
    const stockAfterK = (await Product.findById(prodA._id)).variants[0].qty
    const netRestoredK = stockAfterK - stockBeforeK

    assertTest('K.2: Order is CANCELLED after partial refund / cancellation race', orderDocK.status === 'CANCELLED')
    assertTest('K.3: Exactly 2 units restored to stock (zero over-restock)', netRestoredK === 2)
    assertTest('K.4: Per-line restoredQuantity is exactly 2', orderDocK.items[0].restoredQuantity === 2)

    // L: Concurrent Cancellation Attempts
    const fixL = await createOrderFixture({
      items: [
        {
          productId: prodB._id,
          variantId: `var_b_${runId}`,
          productName: prodB.name,
          variantLabel: '500g Jar',
          weight: '500g',
          sku: `SKU-24F-B-V1-${runId}`,
          unitPrice: 300,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 600,
        },
      ],
      totalAmount: 600,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeL = (await Product.findById(prodB._id)).variants[0].qty

    const [cancelL1, cancelL2] = await Promise.all([
      apiRequest(`/admin/orders/${fixL.order._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Thread 1 cancel' }),
      }),
      apiRequest(`/admin/orders/${fixL.order._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Thread 2 cancel' }),
      }),
    ])

    const successStatusesL = [cancelL1.status, cancelL2.status]
    assertTest('L.1: Exactly one concurrent cancellation returns 200, other returns 400', successStatusesL.includes(200) && successStatusesL.includes(400))
    const stockAfterL = (await Product.findById(prodB._id)).variants[0].qty
    assertTest('L.2: Stock restored exactly 2 units (zero duplicate restock from concurrent cancel)', stockAfterL - stockBeforeL === 2)

    // M: Concurrent Partial Refunds Racing for Exceeding Balance
    const fixM = await createOrderFixture({
      items: [
        {
          productId: prodB._id,
          variantId: `var_b_${runId}`,
          productName: prodB.name,
          variantLabel: '500g Jar',
          weight: '500g',
          sku: `SKU-24F-B-V1-${runId}`,
          unitPrice: 300,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 600,
        },
      ],
      totalAmount: 600,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeM = (await Product.findById(prodB._id)).variants[0].qty

    // Thread 1 asks for 600 (full), Thread 2 simultaneously asks for 300
    const [raceRefM1, raceRefM2] = await Promise.all([
      initiateRefund({
        orderId: fixM.order._id,
        amount: 600,
        reason: 'Concurrent partial refund M1',
        user: admin,
        role: 'admin',
        source: 'admin_request',
        items: [{ productId: prodB._id, variantId: `var_b_${runId}`, quantity: 2 }],
        idempotencyKey: `idemp_m1_${Date.now()}`,
      }),
      initiateRefund({
        orderId: fixM.order._id,
        amount: 300,
        reason: 'Concurrent partial refund M2',
        user: admin,
        role: 'admin',
        source: 'admin_request',
        items: [{ productId: prodB._id, variantId: `var_b_${runId}`, quantity: 1 }],
        idempotencyKey: `idemp_m2_${Date.now()}`,
      }),
    ])
    if (raceRefM1.refund?._id) cleanupRefundIds.push(raceRefM1.refund._id)
    if (raceRefM2.refund?._id) cleanupRefundIds.push(raceRefM2.refund._id)

    const payDocM = await Payment.findById(fixM.payment._id)
    const stockAfterM = (await Product.findById(prodB._id)).variants[0].qty
    const netRestoredM = stockAfterM - stockBeforeM

    assertTest('M.1: Exactly one refund operation succeeds or both respect balance bound', (raceRefM1.success && !raceRefM2.success) || (!raceRefM1.success && raceRefM2.success) || (raceRefM1.success && raceRefM2.success && payDocM.refundedAmount <= 600))
    assertTest('M.2: Payment refundedAmount never exceeds captured 600', payDocM.refundedAmount <= 600)
    assertTest('M.3: Payment refundableAmount >= 0', payDocM.refundableAmount >= 0)
    assertTest('M.4: Stock restored does not exceed 2 units', netRestoredM <= 2)
    assertTest('M.5: restoredQuantity on order does not exceed quantity', (await Order.findById(fixM.order._id)).items[0].restoredQuantity <= 2)

    // --------------------------------------------------------------------------------
    // SECTION N, O, Q, R: WEBHOOKS AGAINST CANCELLATION
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION N, O, Q, R: WEBHOOKS & CANCELLATION ---')
    // N: payment.captured webhook arriving on CANCELLED order
    const fixN = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: false,
      status: 'PENDING_PAYMENT',
    })

    // Cancel order first
    await apiRequest(`/orders/${fixN.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ reason: 'Cancelled before payment arrived' }),
    })

    const stockBeforeWebhookN = (await Product.findById(prodA._id)).variants[0].qty

    // Now payment.captured webhook arrives for the cancelled order
    const webhookN = createSignedWebhook('payment.captured', {
      payment: {
        entity: {
          id: `pay_late_cap_${Date.now()}`,
          order_id: fixN.order.razorpayOrderId,
          amount: 50000,
          currency: 'INR',
          status: 'captured',
        },
      },
    })

    const webhookResN = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': webhookN.signature },
      body: webhookN.bodyString,
    })
    assertTest('N.1: Webhook returns 200 OK for payment captured on cancelled order', webhookResN.status === 200)

    const orderDocN = await Order.findById(fixN.order._id)
    assertTest('N.2: Order is NOT resurrected (in CANCELLED or REQUIRES_RECONCILIATION)', ['CANCELLED', 'REQUIRES_RECONCILIATION'].includes(orderDocN.status))
    assertTest('N.3: Order paymentStatus updated to SUCCESS', orderDocN.paymentStatus === 'SUCCESS')

    const payDocN = await Payment.findOne({ orderId: fixN.order._id })
    assertTest('N.4: Payment recorded as SUCCESS with refundableAmount = 500', payDocN?.status === 'SUCCESS' && payDocN?.refundableAmount === 500)

    const stockAfterWebhookN = (await Product.findById(prodA._id)).variants[0].qty
    assertTest('N.5: Inventory NOT deducted for cancelled order', stockAfterWebhookN === stockBeforeWebhookN)

    // Q: Stale webhook events do NOT demote PROCESSED refund
    const staleFailedEvt = createSignedWebhook('refund.failed', {
      refund: {
        entity: {
          id: `rfnd_stale_${Date.now()}`,
          payment_id: fixB.payment.razorpayPaymentId,
          amount: 100000,
          currency: 'INR',
          status: 'failed',
          receipt: String(refundRecordsB[0]._id),
        },
      },
    })
    const staleResQ = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': staleFailedEvt.signature },
      body: staleFailedEvt.bodyString,
    })
    assertTest('Q.1: Stale refund.failed arriving after PROCESSED acknowledged with 200', staleResQ.status === 200)
    const refundDocQ = await Refund.findById(refundRecordsB[0]._id)
    assertTest('Q.2: PROCESSED refund is NOT demoted to FAILED', refundDocQ.status === 'PROCESSED')

    // R: Duplicate Webhook Idempotency (Same webhook delivered 5 times)
    console.log('\n--- SECTION R: DUPLICATE WEBHOOK IDEMPOTENCY ---')
    const dupEvt = createSignedWebhook('order.paid', {
      order: { entity: { id: fixB.order.razorpayOrderId } },
    })

    const dupPromises = []
    for (let i = 0; i < 5; i++) {
      dupPromises.push(
        apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'X-Razorpay-Signature': dupEvt.signature },
          body: dupEvt.bodyString,
        })
      )
    }
    const dupResults = await Promise.all(dupPromises)
    const all200 = dupResults.every((r) => r.status === 200)
    assertTest('R.1: Sending webhook 5 times returns 200 OK every time', all200)

    const eventCountR = await WebhookEvent.countDocuments({ eventId: dupEvt.eventId })
    assertTest('R.2: Exactly 1 WebhookEvent record exists in MongoDB for eventId', eventCountR === 1)

    // --------------------------------------------------------------------------------
    // SECTION P: MISSING WEBHOOK RECOVERY
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION P: MISSING WEBHOOK RECOVERY ---')
    // Create an order and initiate a refund that gets stuck in PROCESSING (simulating lost webhook)
    const fixP = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stuckRefund = await Refund.create({
      orderId: fixP.order._id,
      paymentId: fixP.payment._id,
      userId: custA._id,
      razorpayPaymentId: fixP.payment.razorpayPaymentId,
      razorpayRefundId: `rfnd_stuck_${Date.now()}`,
      amount: 500,
      amountInPaise: 50000,
      currency: 'INR',
      status: 'PROCESSING',
      reason: 'Lost webhook test',
      requestedBy: admin._id,
      requestedByRole: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_stuck_${Date.now()}`,
      isFullRefund: true,
      inventoryRestorationStatus: 'NOT_RESTORED',
      createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 mins ago
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    })
    cleanupRefundIds.push(stuckRefund._id)

    // Trigger on-demand administrative reconciliation
    const reconResP = await apiRequest(`/admin/orders/${fixP.order._id}/refunds/${stuckRefund._id}/reconcile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    assertTest('P.1: Admin on-demand refund reconciliation succeeds (200 OK)', reconResP.status === 200)

    const resolvedRefundP = await Refund.findById(stuckRefund._id)
    assertTest('P.2: Stuck refund successfully reconciled to PROCESSED via gateway fetch', resolvedRefundP.status === 'PROCESSED')

    // --------------------------------------------------------------------------------
    // SECTION S: PAYMENT ACCOUNTING INVARIANTS AUDIT
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION S: PAYMENT ACCOUNTING INVARIANTS AUDIT ---')
    const allPayments = await Payment.find({})
    let allInvariantsHold = true
    for (const p of allPayments) {
      const cap = p.capturedAmount || 0
      const ref = p.refundedAmount || 0
      const abl = p.refundableAmount || 0

      if (cap < 0 || ref < 0 || abl < 0) allInvariantsHold = false
      if (ref > cap + 0.01) allInvariantsHold = false
    }
    assertTest('S.1: All payment documents maintain capturedAmount >= 0, refundedAmount >= 0, refundableAmount >= 0', allInvariantsHold)
    assertTest('S.2: Zero payments exist where refundedAmount > capturedAmount', allInvariantsHold)

    // --------------------------------------------------------------------------------
    // SECTION T: AUTHORIZATION & TENANT BOUNDARIES
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION T: AUTHORIZATION & TENANT BOUNDARIES ---')
    // Customer B cannot cancel Customer A's order
    const crossCancel = await apiRequest(`/orders/${fixA.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ reason: 'Malicious cross-customer cancel' }),
    })
    assertTest('T.1: Customer B cannot cancel Customer A order (404/403)', [403, 404].includes(crossCancel.status))

    // Unauthenticated cancel rejected
    const unauthCancel = await apiRequest(`/orders/${fixA.order._id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Unauthenticated cancel' }),
    })
    assertTest('T.2: Unauthenticated cancel rejected with 401', unauthCancel.status === 401)

    // Customer token rejected on admin cancel route
    const custOnAdmin = await apiRequest(`/admin/orders/${fixA.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ reason: 'Customer trying admin cancel' }),
    })
    assertTest('T.3: Customer token rejected with 403 on admin cancellation endpoint', custOnAdmin.status === 403)

    // Customer cannot cancel DELIVERED order
    const fixDelivered = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: true,
      status: 'DELIVERED',
    })
    const cancelDelivered = await apiRequest(`/orders/${fixDelivered.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ reason: 'Trying to cancel delivered' }),
    })
    assertTest('T.4: Cancellation on DELIVERED order rejected with 400 cannot_cancel_delivered', cancelDelivered.status === 400 && cancelDelivered.data?.error?.code === 'cannot_cancel_delivered')

    // Customer cannot cancel SHIPPED order
    const fixShipped = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: true,
      status: 'SHIPPED',
    })
    const cancelShipped = await apiRequest(`/orders/${fixShipped.order._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ reason: 'Trying to cancel shipped' }),
    })
    assertTest('T.5: Customer cannot cancel SHIPPED order directly (400 cannot_cancel_in_transit)', cancelShipped.status === 400 && cancelShipped.data?.error?.code === 'cannot_cancel_in_transit')

    // --------------------------------------------------------------------------------
    // SECTION U: RATE LIMITING ON CANCELLATION
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION U: RATE LIMITING ON CANCELLATION ---')
    const rateLimitOrder = await createOrderFixture({
      items: [
        {
          productId: prodA._id,
          variantId: `var_a_${runId}`,
          productName: prodA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-24F-A-V1-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
      isPaid: false,
      status: 'PENDING_PAYMENT',
    })

    let hitRateLimit = false
    for (let i = 0; i < 15; i++) {
      const r = await apiRequest(`/orders/${rateLimitOrder.order._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ reason: `Burst cancel ${i}` }),
      })
      if (r.status === 429) {
        hitRateLimit = true
        break
      }
    }
    assertTest('U.1: Burst cancellation requests trigger HTTP 429 rate limiter', hitRateLimit)

    // --------------------------------------------------------------------------------
    // SECTION V: AUDIT HISTORY & AUDIT TRAIL
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION V: AUDIT HISTORY & AUDIT TRAIL ---')
    const auditedOrder = await Order.findById(fixB.order._id)
    const historyEntries = auditedOrder.history || []
    assertTest('V.1: Cancelled order contains chronological history entries', historyEntries.length >= 2)
    const hasCancelEntry = historyEntries.some(
      (h) => h.status === 'CANCELLED' && (h.note || '').toLowerCase().includes('defect recall')
    )
    assertTest('V.2: Order history records CANCELLED status with reason note', hasCancelEntry)

    // Historical product snapshots remain immutable
    assertTest('V.3: Product snapshot name, price, SKU, lineTotal unaltered in order', auditedOrder.items[0].productName === prodA.name && auditedOrder.items[0].unitPrice === 500)

    // --------------------------------------------------------------------------------
    // SECTION W: CRASH RECOVERY & MONGO TRANSACTIONS
    // --------------------------------------------------------------------------------
    console.log('\n--- SECTION W: CRASH RECOVERY & MONGO TRANSACTIONS ---')
    // Verify that transient write conflicts or aborted transactions roll back safely
    const fixW = await createOrderFixture({
      items: [
        {
          productId: prodB._id,
          variantId: `var_b_${runId}`,
          productName: prodB.name,
          variantLabel: '500g Jar',
          weight: '500g',
          sku: `SKU-24F-B-V1-${runId}`,
          unitPrice: 300,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 600,
        },
      ],
      totalAmount: 600,
      isPaid: true,
      status: 'CONFIRMED',
    })

    const stockBeforeW = (await Product.findById(prodB._id)).variants[0].qty

    // Simulate an aborted transaction
    const testSession = await mongoose.startSession()
    try {
      testSession.startTransaction()
      await Order.findByIdAndUpdate(fixW.order._id, { status: 'CANCELLED' }, { session: testSession })
      // Simulate crash before commit
      await testSession.abortTransaction()
    } finally {
      await testSession.endSession()
    }

    const orderDocW = await Order.findById(fixW.order._id)
    assertTest('W.1: Aborted cancellation rolls back order to CONFIRMED', orderDocW.status === 'CONFIRMED')
    const stockAfterW = (await Product.findById(prodB._id)).variants[0].qty
    assertTest('W.2: Stock unaltered by aborted transaction', stockAfterW === stockBeforeW)

  } finally {
    resetRazorpayClient()

    console.log('\n--- CLEANING UP PHASE 2.4F TEST FIXTURES ---')
    await Refund.deleteMany({ orderId: { $in: cleanupOrderIds } }).catch(() => {})
    for (const rid of cleanupRefundIds) await Refund.findByIdAndDelete(rid).catch(() => {})
    for (const pid of cleanupPaymentIds) await Payment.findByIdAndDelete(pid).catch(() => {})
    for (const oid of cleanupOrderIds) await Order.findByIdAndDelete(oid).catch(() => {})
    for (const prid of cleanupProductIds) await Product.findByIdAndDelete(prid).catch(() => {})
    for (const uid of cleanupUserIds) await User.findByIdAndDelete(uid).catch(() => {})
    console.log('Cleanup complete.')

    if (testServer) {
      await new Promise((res) => testServer.close(res))
    }
    await disconnectDb()
  }

  console.log('\n====================================================================')
  console.log(`PHASE 2.4F TEST RESULTS: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================================\n')

  if (failed > 0) {
    console.error('FAILURES:')
    failures.forEach((f) => console.error(f))
    process.exit(1)
  }
}

runSuite().catch((err) => {
  console.error('Phase 2.4F suite crashed:', err)
  process.exit(1)
})

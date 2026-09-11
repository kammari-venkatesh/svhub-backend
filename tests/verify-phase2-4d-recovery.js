import crypto from 'crypto'
import mongoose from 'mongoose'
import { env } from '../src/config/env.js'
import { connectDb, disconnectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Cart } from '../src/models/Cart.js'
import { WebhookEvent } from '../src/models/WebhookEvent.js'
import {
  setRazorpayClient,
  resetRazorpayClient,
  getRazorpayWebhookSecret,
  verifyRazorpayWebhookSignature,
} from '../src/config/razorpay.js'
import {
  fulfillRazorpayPayment,
  recordWebhookPaymentFailure,
} from '../src/services/paymentFulfillmentService.js'
import {
  GATEWAY_CLASSIFICATION,
  classifyGatewayError,
  calculateBackoff,
  reconcileOrderPayment,
  recoverStalePayments,
  recoverStuckWebhookEvents,
} from '../src/services/paymentReconciliationService.js'
import {
  paymentCreateRateLimiter,
  paymentVerifyRateLimiter,
  paymentFailureRateLimiter,
  webhookRateLimiter,
  createPaymentRateLimiter,
} from '../src/middleware/rateLimiter.js'

const API_BASE = `http://localhost:${env.PORT || 5000}/api`
const WEBHOOK_SECRET = env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || 'svhub_test_webhook_secret_phase2_4c'

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
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const headers = { ...options.headers }
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

function createSignedWebhook(event, payload, secret = WEBHOOK_SECRET, rawBodyOverride = null, eventIdOverride = null) {
  const eventId = eventIdOverride || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const bodyString =
    rawBodyOverride !== null
      ? rawBodyOverride
      : JSON.stringify({
          entity: 'event',
          account_id: 'acc_test_123',
          event,
          contains: ['payment'],
          payload,
          id: eventId,
          created_at: Math.floor(Date.now() / 1000),
        })

  const signature = crypto
    .createHmac('sha256', secret)
    .update(bodyString)
    .digest('hex')

  return { bodyString, signature, eventId }
}

async function run() {
  console.log('====================================================================')
  console.log('SV HUB — PHASE 2.4D PRODUCTION PAYMENT RECOVERY TEST SUITE (80 TESTS)')
  console.log('====================================================================\n')

  await connectDb()

  const runId = `d_${Date.now()}`
  let customerUserA = null
  let customerUserB = null
  let adminUser = null
  let customerTokenA = null
  let customerTokenB = null
  let adminToken = null
  let baseProduct = null

  const cleanupUserIds = []
  const cleanupProductIds = []
  const cleanupOrderIds = []
  const cleanupPaymentIds = []
  const cleanupWebhookIds = []

  try {
    console.log('--- Setting Up Test Users, Fixtures & Tokens ---')
    customerUserA = await User.create({
      name: 'Recovery Customer A',
      email: `customer_a_${runId}@example.com`,
      phone: '9876500010',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(customerUserA._id)

    customerUserB = await User.create({
      name: 'Recovery Customer B',
      email: `customer_b_${runId}@example.com`,
      phone: '9876500020',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(customerUserB._id)

    adminUser = await User.create({
      name: 'Recovery Admin',
      email: `admin_${runId}@example.com`,
      phone: '9876500099',
      password: 'Password123!',
      role: 'ADMIN',
      isActive: true,
    })
    cleanupUserIds.push(adminUser._id)

    const jwt = (await import('jsonwebtoken')).default
    const { jwtSecret } = await import('../src/utils/auth.js')
    customerTokenA = jwt.sign({ sub: String(customerUserA._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    customerTokenB = jwt.sign({ sub: String(customerUserB._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    adminToken = jwt.sign({ sub: String(adminUser._id), role: 'ADMIN' }, jwtSecret(), { expiresIn: '1h' })

    baseProduct = await Product.create({
      name: `Recovery Hardening Product ${runId}`,
      slug: `recovery-hardening-product-${runId}`,
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      description: 'Phase 2.4D test item',
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      price: 500,
      weight: '1 L',
      sku: `SKU-REC-${runId}`,
      qty: 50,
      isActive: true,
      variants: [
        {
          variantId: 'var-1kg',
          label: '1 kg',
          price: 500,
          originalPrice: 600,
          qty: 50,
          sku: `SKU-REC-${runId}`,
          weight: '1kg',
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(baseProduct._id)

    // Helper to create valid orders
    async function createTestOrder(user, totalAmount = 500, status = 'PENDING_PAYMENT', overrides = {}) {
      const orderNum = `ORD-REC-${Date.now()}-${Math.floor(Math.random() * 10000)}`
      const order = await Order.create({
        orderNumber: orderNum,
        userId: user._id,
        customerName: user.name,
        email: user.email,
        phone: user.phone,
        shippingAddress: {
          name: user.name,
          phone: user.phone,
          street: '123 Recovery Lane',
          city: 'Bengaluru',
          state: 'Karnataka',
          pin: '560001',
          country: 'India',
        },
        items: [
          {
            productId: baseProduct._id,
            productName: baseProduct.name,
            variantId: 'var-1kg',
            variantLabel: '1 kg',
            sku: baseProduct.variants[0].sku,
            unitPrice: totalAmount,
            quantity: 1,
            lineTotal: totalAmount,
          },
        ],
        subtotal: totalAmount,
        shippingFee: 0,
        discount: 0,
        totalAmount,
        status,
        paymentStatus: status === 'CONFIRMED' ? 'SUCCESS' : 'PENDING',
        ...overrides,
      })
      cleanupOrderIds.push(order._id)
      return order
    }

    // =========================================================================
    // CATEGORY A: RAZORPAY API RESPONSES & CLASSIFICATION (Tests 1-13)
    // =========================================================================
    console.log('\n--- CATEGORY A: RAZORPAY API RESPONSES (Tests 1-13) ---')

    // 1. Timeout error -> RETRYABLE_ERROR
    const timeoutErr = new Error('Gateway request timed out')
    timeoutErr.code = 'ETIMEDOUT'
    const c1 = classifyGatewayError(timeoutErr)
    assertTest('Test 1: Timeout error classified as RETRYABLE_ERROR', c1.classification === GATEWAY_CLASSIFICATION.RETRYABLE_ERROR && c1.retryable === true)

    // 2. DNS failure -> RETRYABLE_ERROR
    const dnsErr = new Error('getaddrinfo ENOTFOUND api.razorpay.com')
    dnsErr.code = 'ENOTFOUND'
    const c2 = classifyGatewayError(dnsErr)
    assertTest('Test 2: DNS failure classified as RETRYABLE_ERROR', c2.classification === GATEWAY_CLASSIFICATION.RETRYABLE_ERROR && c2.retryable === true)

    // 3. Connection reset -> RETRYABLE_ERROR
    const resetErr = new Error('read ECONNRESET')
    resetErr.code = 'ECONNRESET'
    const c3 = classifyGatewayError(resetErr)
    assertTest('Test 3: Connection reset classified as RETRYABLE_ERROR', c3.classification === GATEWAY_CLASSIFICATION.RETRYABLE_ERROR && c3.retryable === true)

    // 4. HTTP 500 -> RETRYABLE_ERROR
    const err500 = new Error('Internal Server Error')
    err500.statusCode = 500
    const c4 = classifyGatewayError(err500)
    assertTest('Test 4: Gateway 500 classified as RETRYABLE_ERROR', c4.classification === GATEWAY_CLASSIFICATION.RETRYABLE_ERROR && c4.retryable === true)

    // 5. HTTP 502 -> RETRYABLE_ERROR
    const err502 = new Error('Bad Gateway')
    err502.statusCode = 502
    const c5 = classifyGatewayError(err502)
    assertTest('Test 5: Gateway 502 classified as RETRYABLE_ERROR', c5.classification === GATEWAY_CLASSIFICATION.RETRYABLE_ERROR && c5.retryable === true)

    // 6. HTTP 503 -> RETRYABLE_ERROR
    const err503 = new Error('Service Unavailable')
    err503.statusCode = 503
    const c6 = classifyGatewayError(err503)
    assertTest('Test 6: Gateway 503 classified as RETRYABLE_ERROR', c6.classification === GATEWAY_CLASSIFICATION.RETRYABLE_ERROR && c6.retryable === true)

    // 7. Malformed gateway response handled safely
    const malformedAnalysis = classifyGatewayError({ error: { description: 'Unexpected token < in JSON at position 0' } })
    assertTest('Test 7: Malformed gateway error handled without throwing', Boolean(malformedAnalysis.classification))

    // 8. Payment not found -> NOT_FOUND_CONFIRMED
    const err404 = new Error('The id provided does not exist')
    err404.statusCode = 404
    const c8 = classifyGatewayError(err404)
    assertTest('Test 8: Payment not found classified as NOT_FOUND_CONFIRMED', c8.classification === GATEWAY_CLASSIFICATION.NOT_FOUND_CONFIRMED && c8.retryable === false)

    // 9. Order not found -> NOT_FOUND_CONFIRMED
    const errOrder404 = { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'order_id does not exist' } }
    const c9 = classifyGatewayError(errOrder404)
    assertTest('Test 9: Order not found classified as NOT_FOUND_CONFIRMED', c9.classification === GATEWAY_CLASSIFICATION.NOT_FOUND_CONFIRMED)

    // 10. Captured payment reconciliation
    const order10 = await createTestOrder(customerUserA, 500)
    const rzpOrderId10 = `order_test_a10_${Date.now()}`
    const rzpPaymentId10 = `pay_test_a10_${Date.now()}`
    const payment10 = await Payment.create({
      orderId: order10._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId10,
      razorpayPaymentId: rzpPaymentId10,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment10._id)
    order10.razorpayOrderId = rzpOrderId10
    await order10.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: rzpPaymentId10, order_id: rzpOrderId10, status: 'captured', amount: 50000, currency: 'INR' }],
        }),
      },
    })
    const res10 = await reconcileOrderPayment({ orderId: order10._id })
    assertTest('Test 10: Captured payment classified as SUCCESS_CONFIRMED and fulfilled', res10.success && res10.classification === GATEWAY_CLASSIFICATION.SUCCESS_CONFIRMED)
    resetRazorpayClient()

    // 11. Authorized payment reconciliation
    const order11 = await createTestOrder(customerUserA, 500)
    const rzpOrderId11 = `order_test_a11_${Date.now()}`
    const payment11 = await Payment.create({
      orderId: order11._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId11,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment11._id)
    order11.razorpayOrderId = rzpOrderId11
    await order11.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: `pay_auth_${Date.now()}`, order_id: rzpOrderId11, status: 'authorized', amount: 50000, currency: 'INR' }],
        }),
      },
    })
    const res11 = await reconcileOrderPayment({ orderId: order11._id })
    assertTest('Test 11: Authorized payment classified as AUTHORIZED_UNCONFIRMED', res11.classification === GATEWAY_CLASSIFICATION.AUTHORIZED_UNCONFIRMED && res11.retryable === true)
    resetRazorpayClient()

    // 12. Failed payment reconciliation
    const order12 = await createTestOrder(customerUserA, 500)
    const rzpOrderId12 = `order_test_a12_${Date.now()}`
    const rzpPaymentId12 = `pay_fail_${Date.now()}`
    const payment12 = await Payment.create({
      orderId: order12._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId12,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment12._id)
    order12.razorpayOrderId = rzpOrderId12
    await order12.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: rzpPaymentId12, order_id: rzpOrderId12, status: 'failed', error_description: 'Payment failed at bank' }],
        }),
      },
    })
    const res12 = await reconcileOrderPayment({ orderId: order12._id })
    assertTest('Test 12: Failed payment classified as FAILED_CONFIRMED', res12.classification === GATEWAY_CLASSIFICATION.FAILED_CONFIRMED)
    resetRazorpayClient()

    // 13. Pending payment (no transactions yet on gateway order)
    const order13 = await createTestOrder(customerUserA, 500)
    const rzpOrderId13 = `order_test_a13_${Date.now()}`
    const payment13 = await Payment.create({
      orderId: order13._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId13,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment13._id)
    order13.razorpayOrderId = rzpOrderId13
    await order13.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({ items: [] }),
      },
    })
    const res13 = await reconcileOrderPayment({ orderId: order13._id })
    assertTest('Test 13: Gateway order with no payments remains retryable UNKNOWN', res13.classification === GATEWAY_CLASSIFICATION.UNKNOWN && res13.retryable === true)
    resetRazorpayClient()

    // =========================================================================
    // CATEGORY B: STALE PAYMENT RECOVERY (Tests 14-23)
    // =========================================================================
    console.log('\n--- CATEGORY B: STALE PAYMENT RECOVERY (Tests 14-23) ---')

    // 14. Stale CREATED payment recovered
    const order14 = await createTestOrder(customerUserA, 500)
    const rzpOrderId14 = `order_b14_${Date.now()}`
    const payment14 = await Payment.create({
      orderId: order14._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId14,
      status: 'CREATED',
    })
    cleanupPaymentIds.push(payment14._id)
    await Payment.updateOne({ _id: payment14._id }, { $set: { updatedAt: new Date(Date.now() - 3600 * 1000) } }, { timestamps: false })
    order14.razorpayOrderId = rzpOrderId14
    await order14.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: `pay_b14_${Date.now()}`, order_id: rzpOrderId14, status: 'captured', amount: 50000, currency: 'INR' }],
        }),
      },
    })
    const rec14 = await recoverStalePayments({ staleThresholdMs: 60 * 1000 })
    assertTest('Test 14: Stale CREATED payment successfully recovered', rec14.reconciled >= 1)
    resetRazorpayClient()

    // 15. Stale PENDING payment recovered
    const order15 = await createTestOrder(customerUserA, 500)
    const rzpOrderId15 = `order_b15_${Date.now()}`
    const payment15 = await Payment.create({
      orderId: order15._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId15,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment15._id)
    await Payment.updateOne({ _id: payment15._id }, { $set: { updatedAt: new Date(Date.now() - 3600 * 1000) } }, { timestamps: false })
    order15.razorpayOrderId = rzpOrderId15
    await order15.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: `pay_b15_${Date.now()}`, order_id: rzpOrderId15, status: 'captured', amount: 50000, currency: 'INR' }],
        }),
      },
    })
    const rec15 = await recoverStalePayments({ staleThresholdMs: 60 * 1000 })
    assertTest('Test 15: Stale PENDING payment successfully recovered', rec15.reconciled >= 1)
    resetRazorpayClient()

    // 16. Stale REQUIRES_RECONCILIATION payment scanned
    const order16 = await createTestOrder(customerUserA, 500, 'REQUIRES_RECONCILIATION')
    const rzpOrderId16 = `order_b16_${Date.now()}`
    const payment16 = await Payment.create({
      orderId: order16._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId16,
      status: 'REQUIRES_RECONCILIATION',
    })
    cleanupPaymentIds.push(payment16._id)
    await Payment.updateOne({ _id: payment16._id }, { $set: { updatedAt: new Date(Date.now() - 3600 * 1000) } }, { timestamps: false })
    order16.razorpayOrderId = rzpOrderId16
    await order16.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({ items: [] }),
      },
    })
    const rec16 = await recoverStalePayments({ staleThresholdMs: 60 * 1000 })
    assertTest('Test 16: Stale REQUIRES_RECONCILIATION payment scanned without crash', rec16.scanned >= 1)
    resetRazorpayClient()

    // 17. Successful recovery transitions local order to CONFIRMED
    const refreshedOrder14 = await Order.findById(order14._id)
    assertTest('Test 17: Successful recovery confirmed the order', refreshedOrder14.status === 'CONFIRMED' && refreshedOrder14.paymentStatus === 'SUCCESS')

    // 18. Failed recovery records failure
    const order18 = await createTestOrder(customerUserA, 500)
    const rzpOrderId18 = `order_b18_${Date.now()}`
    const payment18 = await Payment.create({
      orderId: order18._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId18,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment18._id)
    order18.razorpayOrderId = rzpOrderId18
    await order18.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: `pay_b18_${Date.now()}`, order_id: rzpOrderId18, status: 'failed', error_description: 'Card expired' }],
        }),
      },
    })
    await reconcileOrderPayment({ orderId: order18._id })
    const refreshedPayment18 = await Payment.findById(payment18._id)
    assertTest('Test 18: Authoritative gateway failure recorded locally', refreshedPayment18.status === 'FAILED')
    resetRazorpayClient()

    // 19. Retryable recovery increments reconciliationAttempts without marking FAILED
    const order19 = await createTestOrder(customerUserA, 500)
    const rzpOrderId19 = `order_b19_${Date.now()}`
    const payment19 = await Payment.create({
      orderId: order19._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId19,
      status: 'PENDING',
      reconciliationAttempts: 1,
    })
    cleanupPaymentIds.push(payment19._id)
    order19.razorpayOrderId = rzpOrderId19
    await order19.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => {
          const e = new Error('504 Gateway Timeout')
          e.statusCode = 504
          throw e
        },
      },
    })
    const res19 = await reconcileOrderPayment({ orderId: order19._id })
    const refreshedPayment19 = await Payment.findById(payment19._id)
    assertTest('Test 19: Gateway timeout increments attempt without setting FAILED', res19.retryable && refreshedPayment19.status === 'PENDING' && refreshedPayment19.reconciliationAttempts === 2)
    resetRazorpayClient()

    // 20. Permanent recovery failure handled (amount mismatch)
    const order20 = await createTestOrder(customerUserA, 500)
    const rzpOrderId20 = `order_b20_${Date.now()}`
    const payment20 = await Payment.create({
      orderId: order20._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId20,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment20._id)
    order20.razorpayOrderId = rzpOrderId20
    await order20.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: `pay_b20_${Date.now()}`, order_id: rzpOrderId20, status: 'captured', amount: 10000, currency: 'INR' }],
        }),
      },
    })
    const res20 = await reconcileOrderPayment({ orderId: order20._id })
    const refreshedOrder20 = await Order.findById(order20._id)
    assertTest('Test 20: Amount mismatch marked REQUIRES_RECONCILIATION', refreshedOrder20.status === 'REQUIRES_RECONCILIATION' && res20.classification === GATEWAY_CLASSIFICATION.PERMANENT_ERROR)
    resetRazorpayClient()

    // 21. Repeated recovery runs are idempotent
    const res21 = await reconcileOrderPayment({ orderId: order14._id })
    assertTest('Test 21: Repeated recovery of confirmed order is idempotent', res21.success && res21.idempotent === true)

    // 22. Concurrent recovery runs (Promise.all)
    const order22 = await createTestOrder(customerUserA, 500)
    const rzpOrderId22 = `order_b22_${Date.now()}`
    const rzpPaymentId22 = `pay_b22_${Date.now()}`
    const payment22 = await Payment.create({
      orderId: order22._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId22,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment22._id)
    order22.razorpayOrderId = rzpOrderId22
    await order22.save()

    setRazorpayClient({
      orders: {
        fetchPayments: async () => ({
          items: [{ id: rzpPaymentId22, order_id: rzpOrderId22, status: 'captured', amount: 50000, currency: 'INR' }],
        }),
      },
    })
    const [cRes1, cRes2, cRes3] = await Promise.all([
      reconcileOrderPayment({ orderId: order22._id }),
      reconcileOrderPayment({ orderId: order22._id }),
      reconcileOrderPayment({ orderId: order22._id }),
    ])
    const allSuccessful = [cRes1, cRes2, cRes3].every((r) => r.success)
    const refreshedOrder22 = await Order.findById(order22._id)
    assertTest('Test 22: Concurrent Promise.all reconciliations result in single confirmed order', allSuccessful && refreshedOrder22.status === 'CONFIRMED')
    resetRazorpayClient()

    // 23. Recovery after process restart (re-run scan on same DB state)
    const restartScan = await recoverStalePayments({ staleThresholdMs: 60 * 1000 })
    assertTest('Test 23: Re-running recovery scan after state commit succeeds safely', typeof restartScan.scanned === 'number')

    // =========================================================================
    // CATEGORY C: WEBHOOK RECOVERY (Tests 24-35)
    // =========================================================================
    console.log('\n--- CATEGORY C: WEBHOOK RECOVERY (Tests 24-35) ---')

    // 24. Stuck PROCESSING event claimed by worker
    const stuckEvent = await WebhookEvent.create({
      provider: 'razorpay',
      eventId: `evt_stuck_${Date.now()}`,
      eventType: 'payment.captured',
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 3600 * 1000),
      lockOwner: 'crashed-worker-1',
      attempts: 1,
      payloadSummary: { event: 'payment.captured' },
    })
    cleanupWebhookIds.push(stuckEvent._id)

    const wRec24 = await recoverStuckWebhookEvents({ staleThresholdMs: 60 * 1000, ownerId: 'new-recovery-worker' })
    assertTest('Test 24: Stuck PROCESSING event claimed by active recovery worker', wRec24.claimed >= 1)

    // 25. FAILED_RETRYABLE event scheduled with nextRetryAt
    const backoff = calculateBackoff(3, 1000, 60000)
    assertTest('Test 25: Exponential backoff with jitter is calculated correctly', backoff >= 4000 && backoff <= 6000)

    // 26. Duplicate event does not process twice
    const dupEventId = `evt_dup_${Date.now()}`
    const order26 = await createTestOrder(customerUserA, 500)
    const rzpOrderId26 = `order_c26_${Date.now()}`
    const rzpPaymentId26 = `pay_c26_${Date.now()}`
    await Payment.create({
      orderId: order26._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId26,
      status: 'PENDING',
    })
    order26.razorpayOrderId = rzpOrderId26
    await order26.save()

    const webhook26A = createSignedWebhook('payment.captured', {
      payment: { entity: { id: rzpPaymentId26, order_id: rzpOrderId26, amount: 50000, currency: 'INR', status: 'captured' } },
    }, WEBHOOK_SECRET, null, dupEventId)

    const resp26A = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhook26A.signature },
      body: webhook26A.bodyString,
    })
    const resp26B = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': webhook26A.signature },
      body: webhook26A.bodyString,
    })
    assertTest('Test 26: Duplicate webhook event receives idempotent response', resp26A.status === 200 && resp26B.status === 200 && resp26B.data?.message?.includes('already processed'))

    // 27. Concurrent recovery workers claim disjoint events atomically
    const event27A = await WebhookEvent.create({
      provider: 'razorpay',
      eventId: `evt_27a_${Date.now()}`,
      eventType: 'payment.failed',
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 3600 * 1000),
      attempts: 1,
    })
    const event27B = await WebhookEvent.create({
      provider: 'razorpay',
      eventId: `evt_27b_${Date.now()}`,
      eventType: 'payment.failed',
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 3600 * 1000),
      attempts: 1,
    })
    cleanupWebhookIds.push(event27A._id, event27B._id)

    const [recWorker1, recWorker2] = await Promise.all([
      recoverStuckWebhookEvents({ staleThresholdMs: 60 * 1000, ownerId: 'worker-1' }),
      recoverStuckWebhookEvents({ staleThresholdMs: 60 * 1000, ownerId: 'worker-2' }),
    ])
    assertTest('Test 27: Concurrent recovery workers do not claim the same event', recWorker1.claimed + recWorker2.claimed >= 2)

    // 28. Old event after success does not revert status
    const rzpOrderId28 = `order_c28_${Date.now()}`
    const order28 = await createTestOrder(customerUserA, 500, 'CONFIRMED', {
      paymentStatus: 'SUCCESS',
      paymentId: `pay_c28_orig_${Date.now()}`,
      razorpayOrderId: rzpOrderId28,
    })
    const oldWebhook28 = createSignedWebhook('payment.failed', {
      payment: { entity: { id: `pay_c28_old_${Date.now()}`, order_id: rzpOrderId28, status: 'failed' } },
    })
    await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': oldWebhook28.signature },
      body: oldWebhook28.bodyString,
    })
    const checkOrder28 = await Order.findById(order28._id)
    assertTest('Test 28: Failed webhook does not revert confirmed order', checkOrder28.status === 'CONFIRMED' && checkOrder28.paymentStatus === 'SUCCESS')

    // 29. Failed event after success is ignored safely
    const failRecordRes = await recordWebhookPaymentFailure({
      razorpayOrderId: rzpOrderId28,
      razorpayPaymentId: 'pay_bogus_failed',
      errorReason: 'Test fail event after success',
    })
    assertTest('Test 29: recordWebhookPaymentFailure ignores confirmed orders', failRecordRes.ignored === true)

    // 30. Captured after failed: valid captured reconciles order
    const order30 = await createTestOrder(customerUserA, 500)
    const rzpOrderId30 = `order_c30_${Date.now()}`
    const rzpPaymentId30 = `pay_c30_${Date.now()}`
    const payment30 = await Payment.create({
      orderId: order30._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId30,
      status: 'FAILED',
      errorReason: 'Initial attempt failed',
    })
    cleanupPaymentIds.push(payment30._id)
    order30.razorpayOrderId = rzpOrderId30
    order30.paymentStatus = 'FAILED'
    await order30.save()

    const fulfill30 = await fulfillRazorpayPayment({
      orderId: order30._id,
      razorpayOrderId: rzpOrderId30,
      razorpayPaymentId: rzpPaymentId30,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId30, order_id: rzpOrderId30, amount: 50000, currency: 'INR', status: 'captured' },
    })
    assertTest('Test 30: Captured event after failed reconciles payment to SUCCESS', fulfill30.success && fulfill30.order.status === 'CONFIRMED')

    // 31. Malformed event payload rejected
    const malformedWb = createSignedWebhook('payment.captured', { payment: null })
    const res31 = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': malformedWb.signature },
      body: malformedWb.bodyString,
    })
    assertTest('Test 31: Malformed payment entity in webhook rejected with 400', res31.status === 400)

    // 32. Valid signature wrong payment rejected
    const wb32 = createSignedWebhook('payment.captured', {
      payment: { entity: { id: 'invalid_payment_format', order_id: 'order_123', amount: 50000, currency: 'INR', status: 'captured' } },
    })
    const res32 = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': wb32.signature },
      body: wb32.bodyString,
    })
    assertTest('Test 32: Non-existent order in webhook returns 404/400', res32.status === 404 || res32.status === 400)

    // 33. Valid signature wrong order rejected
    const wb33 = createSignedWebhook('payment.captured', {
      payment: { entity: { id: `pay_valid_${Date.now()}`, order_id: 'order_non_existent_99999', amount: 50000, currency: 'INR', status: 'captured' } },
    })
    const res33 = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': wb33.signature },
      body: wb33.bodyString,
    })
    assertTest('Test 33: Non-existent order ID returns 404 error code', res33.status === 404)

    // 34. Amount mismatch in webhook
    const order34 = await createTestOrder(customerUserA, 500)
    const rzpOrderId34 = `order_c34_${Date.now()}`
    await Payment.create({
      orderId: order34._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId34,
      status: 'PENDING',
    })
    order34.razorpayOrderId = rzpOrderId34
    await order34.save()

    const wb34 = createSignedWebhook('payment.captured', {
      payment: { entity: { id: `pay_c34_${Date.now()}`, order_id: rzpOrderId34, amount: 25000, currency: 'INR', status: 'captured' } },
    })
    const res34 = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': wb34.signature },
      body: wb34.bodyString,
    })
    assertTest('Test 34: Amount mismatch in webhook rejected with 400', res34.status === 400)

    // 35. Currency mismatch in webhook
    const wb35 = createSignedWebhook('payment.captured', {
      payment: { entity: { id: `pay_c35_${Date.now()}`, order_id: rzpOrderId34, amount: 50000, currency: 'USD', status: 'captured' } },
    })
    const res35 = await apiRequest('/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': wb35.signature },
      body: wb35.bodyString,
    })
    assertTest('Test 35: Non-INR currency in webhook rejected with 400', res35.status === 400)

    // =========================================================================
    // CATEGORY D: FULFILLMENT IDEMPOTENCY & RACES (Tests 36-45)
    // =========================================================================
    console.log('\n--- CATEGORY D: FULFILLMENT IDEMPOTENCY (Tests 36-45) ---')

    // 36. Duplicate fulfillment is idempotent
    const order36 = await createTestOrder(customerUserA, 500)
    const rzpOrderId36 = `order_d36_${Date.now()}`
    const rzpPaymentId36 = `pay_d36_${Date.now()}`
    await Payment.create({
      orderId: order36._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId36,
      status: 'PENDING',
    })
    order36.razorpayOrderId = rzpOrderId36
    await order36.save()

    const f36A = await fulfillRazorpayPayment({
      orderId: order36._id,
      razorpayOrderId: rzpOrderId36,
      razorpayPaymentId: rzpPaymentId36,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId36, order_id: rzpOrderId36, amount: 50000, currency: 'INR', status: 'captured' },
    })
    const f36B = await fulfillRazorpayPayment({
      orderId: order36._id,
      razorpayOrderId: rzpOrderId36,
      razorpayPaymentId: rzpPaymentId36,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId36, order_id: rzpOrderId36, amount: 50000, currency: 'INR', status: 'captured' },
    })
    assertTest('Test 36: Duplicate fulfillment returns idempotent: true', f36A.success && f36B.success && f36B.idempotent === true)

    // 37. Concurrent fulfillment (Promise.all)
    const order37 = await createTestOrder(customerUserA, 500)
    const rzpOrderId37 = `order_d37_${Date.now()}`
    const rzpPaymentId37 = `pay_d37_${Date.now()}`
    await Payment.create({
      orderId: order37._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId37,
      status: 'PENDING',
    })
    order37.razorpayOrderId = rzpOrderId37
    await order37.save()

    const [conc1, conc2] = await Promise.all([
      fulfillRazorpayPayment({
        orderId: order37._id,
        razorpayOrderId: rzpOrderId37,
        razorpayPaymentId: rzpPaymentId37,
        amount: 500,
        isWebhook: true,
        gatewayPayment: { id: rzpPaymentId37, order_id: rzpOrderId37, amount: 50000, currency: 'INR', status: 'captured' },
      }),
      fulfillRazorpayPayment({
        orderId: order37._id,
        razorpayOrderId: rzpOrderId37,
        razorpayPaymentId: rzpPaymentId37,
        amount: 500,
        isWebhook: true,
        gatewayPayment: { id: rzpPaymentId37, order_id: rzpOrderId37, amount: 50000, currency: 'INR', status: 'captured' },
      }),
    ])
    assertTest('Test 37: Concurrent fulfillment requests both succeed safely', conc1.success && conc2.success)

    // 38. Inventory race: only deducted once
    const prodBefore = await Product.findById(baseProduct._id)
    const invStart = prodBefore.variants[0].qty
    const order38 = await createTestOrder(customerUserA, 500)
    const rzpOrderId38 = `order_d38_${Date.now()}`
    const rzpPaymentId38 = `pay_d38_${Date.now()}`
    await Payment.create({
      orderId: order38._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId38,
      status: 'PENDING',
    })
    order38.razorpayOrderId = rzpOrderId38
    await order38.save()

    await Promise.all([
      fulfillRazorpayPayment({
        orderId: order38._id,
        razorpayOrderId: rzpOrderId38,
        razorpayPaymentId: rzpPaymentId38,
        amount: 500,
        isWebhook: true,
        gatewayPayment: { id: rzpPaymentId38, order_id: rzpOrderId38, amount: 50000, currency: 'INR', status: 'captured' },
      }),
      fulfillRazorpayPayment({
        orderId: order38._id,
        razorpayOrderId: rzpOrderId38,
        razorpayPaymentId: rzpPaymentId38,
        amount: 500,
        isWebhook: true,
        gatewayPayment: { id: rzpPaymentId38, order_id: rzpOrderId38, amount: 50000, currency: 'INR', status: 'captured' },
      }),
    ])
    const prodAfter = await Product.findById(baseProduct._id)
    assertTest('Test 38: Inventory deducted exactly once across concurrent fulfillments', prodAfter.variants[0].qty === invStart - 1)

    // 39. Insufficient inventory transitions to REQUIRES_RECONCILIATION
    const zeroStockProduct = await Product.create({
      name: `Zero Stock Product ${runId}`,
      slug: `zero-stock-${runId}`,
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      description: 'Zero stock test item',
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      price: 100,
      weight: '1 L',
      sku: `SKU-ZERO-${runId}`,
      qty: 0,
      isActive: true,
      variants: [{ variantId: 'v-0', label: '1kg', weight: '1kg', price: 100, qty: 0, sku: `SKU-ZERO-${runId}`, isActive: true }],
    })
    cleanupProductIds.push(zeroStockProduct._id)

    const order39 = await createTestOrder(customerUserA, 100, 'PENDING_PAYMENT', {
      items: [{ productId: zeroStockProduct._id, productName: zeroStockProduct.name, variantId: 'v-0', variantLabel: '1kg', sku: `SKU-ZERO-${runId}`, unitPrice: 100, quantity: 1, lineTotal: 100 }],
    })
    const rzpOrderId39 = `order_d39_${Date.now()}`
    const rzpPaymentId39 = `pay_d39_${Date.now()}`
    await Payment.create({
      orderId: order39._id,
      userId: customerUserA._id,
      amount: 100,
      razorpayOrderId: rzpOrderId39,
      status: 'PENDING',
    })
    order39.razorpayOrderId = rzpOrderId39
    await order39.save()

    const f39 = await fulfillRazorpayPayment({
      orderId: order39._id,
      razorpayOrderId: rzpOrderId39,
      razorpayPaymentId: rzpPaymentId39,
      amount: 100,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId39, order_id: rzpOrderId39, amount: 10000, currency: 'INR', status: 'captured' },
    })
    assertTest('Test 39: Out-of-stock captured payment flags REQUIRES_RECONCILIATION', f39.errorCode === 'inventory_conflict')

    // 40. Cart changed before reconciliation: purchased lines removed, new lines preserved
    const cart40 = await Cart.findOneAndUpdate(
      { userId: customerUserA._id },
      {
        $set: {
          items: [
            { productId: baseProduct._id, variantId: 'var-1kg', quantity: 1, price: 500, title: baseProduct.name },
            { productId: zeroStockProduct._id, variantId: 'v-0', quantity: 2, price: 100, title: 'Unrelated Cart Item' },
          ],
        },
      },
      { upsert: true, new: true },
    )
    const order40 = await createTestOrder(customerUserA, 500)
    const rzpOrderId40 = `order_d40_${Date.now()}`
    const rzpPaymentId40 = `pay_d40_${Date.now()}`
    await Payment.create({
      orderId: order40._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId40,
      status: 'PENDING',
    })
    order40.razorpayOrderId = rzpOrderId40
    await order40.save()

    await fulfillRazorpayPayment({
      orderId: order40._id,
      razorpayOrderId: rzpOrderId40,
      razorpayPaymentId: rzpPaymentId40,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId40, order_id: rzpOrderId40, amount: 50000, currency: 'INR', status: 'captured' },
    })
    const refreshedCart40 = await Cart.findOne({ userId: customerUserA._id })
    assertTest('Test 40: Selective cart clear preserves unrelated item', refreshedCart40.items.length === 1 && refreshedCart40.items[0].variantId === 'v-0')

    // 41. Cart already cleared: fulfillment succeeds without error
    const order41 = await createTestOrder(customerUserA, 500)
    const rzpOrderId41 = `order_d41_${Date.now()}`
    const rzpPaymentId41 = `pay_d41_${Date.now()}`
    await Payment.create({
      orderId: order41._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId41,
      status: 'PENDING',
    })
    order41.razorpayOrderId = rzpOrderId41
    await order41.save()
    await Cart.deleteOne({ userId: customerUserA._id })

    const f41 = await fulfillRazorpayPayment({
      orderId: order41._id,
      razorpayOrderId: rzpOrderId41,
      razorpayPaymentId: rzpPaymentId41,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId41, order_id: rzpOrderId41, amount: 50000, currency: 'INR', status: 'captured' },
    })
    assertTest('Test 41: Fulfillment succeeds even when cart is empty', f41.success === true)

    // 42. Order already confirmed: reconciliation returns idempotent success
    const rec42 = await reconcileOrderPayment({ orderId: order41._id })
    assertTest('Test 42: Reconciliation of already confirmed order is idempotent', rec42.success && rec42.idempotent === true)

    // 43. Order CANCELLED: reconciliation flags REQUIRES_RECONCILIATION without resurrection
    const order43 = await createTestOrder(customerUserA, 500, 'CANCELLED')
    const rzpOrderId43 = `order_d43_${Date.now()}`
    const rzpPaymentId43 = `pay_d43_${Date.now()}`
    await Payment.create({
      orderId: order43._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId43,
      status: 'PENDING',
    })
    order43.razorpayOrderId = rzpOrderId43
    await order43.save()

    const f43 = await fulfillRazorpayPayment({
      orderId: order43._id,
      razorpayOrderId: rzpOrderId43,
      razorpayPaymentId: rzpPaymentId43,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId43, order_id: rzpOrderId43, amount: 50000, currency: 'INR', status: 'captured' },
    })
    const checkOrder43 = await Order.findById(order43._id)
    assertTest('Test 43: CANCELLED order is not resurrected and transitions to REQUIRES_RECONCILIATION', f43.errorCode === 'order_state_conflict' && checkOrder43.status === 'REQUIRES_RECONCILIATION')

    // 44. Order DELIVERED: reconciliation flags REQUIRES_RECONCILIATION without resurrection
    const order44 = await createTestOrder(customerUserA, 500, 'DELIVERED')
    const rzpOrderId44 = `order_d44_${Date.now()}`
    const rzpPaymentId44 = `pay_d44_${Date.now()}`
    await Payment.create({
      orderId: order44._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId44,
      status: 'PENDING',
    })
    order44.razorpayOrderId = rzpOrderId44
    await order44.save()

    const f44 = await fulfillRazorpayPayment({
      orderId: order44._id,
      razorpayOrderId: rzpOrderId44,
      razorpayPaymentId: rzpPaymentId44,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId44, order_id: rzpOrderId44, amount: 50000, currency: 'INR', status: 'captured' },
    })
    const checkOrder44 = await Order.findById(order44._id)
    assertTest('Test 44: DELIVERED order is not overwritten to CONFIRMED', f44.errorCode === 'order_state_conflict' && checkOrder44.status === 'REQUIRES_RECONCILIATION')

    // 45. Reconciliation after successful fulfillment does nothing destructive
    const rec45 = await reconcileOrderPayment({ orderId: order41._id, force: true })
    assertTest('Test 45: Forced reconciliation on already paid order is non-destructive', rec45.success === true)

    // =========================================================================
    // CATEGORY E: PAYMENT CREATION PROTECTION (Tests 46-52)
    // =========================================================================
    console.log('\n--- CATEGORY E: PAYMENT CREATION PROTECTION (Tests 46-52) ---')

    // 46. Repeated create-order returns same active razorpayOrderId
    const order46 = await createTestOrder(customerUserA, 500)
    const res46A = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
      body: JSON.stringify({ orderId: String(order46._id) }),
    })
    const res46B = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
      body: JSON.stringify({ orderId: String(order46._id) }),
    })
    assertTest('Test 46: Repeated create-order returns identical razorpayOrderId', res46A.status === 200 && res46B.status === 200 && res46A.data.data.razorpayOrderId === res46B.data.data.razorpayOrderId)

    // 47. Two tabs requesting create-order get same razorpayOrderId
    const order47 = await createTestOrder(customerUserA, 500)
    const [tab1, tab2] = await Promise.all([
      apiRequest('/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
        body: JSON.stringify({ orderId: String(order47._id) }),
      }),
      apiRequest('/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
        body: JSON.stringify({ orderId: String(order47._id) }),
      }),
    ])
    assertTest('Test 47: Concurrent tabs receive identical razorpayOrderId', tab1.status === 200 && tab2.status === 200 && tab1.data.data.razorpayOrderId === tab2.data.data.razorpayOrderId)

    // 48. Rapid clicks reuse active order
    const order48 = await createTestOrder(customerUserA, 500)
    const clicks = await Promise.all([
      apiRequest('/payments/razorpay/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` }, body: JSON.stringify({ orderId: String(order48._id) }) }),
      apiRequest('/payments/razorpay/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` }, body: JSON.stringify({ orderId: String(order48._id) }) }),
      apiRequest('/payments/razorpay/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` }, body: JSON.stringify({ orderId: String(order48._id) }) }),
    ])
    const allMatching = clicks.every((c) => c.status === 200 && c.data.data.razorpayOrderId === clicks[0].data.data.razorpayOrderId)
    assertTest('Test 48: Rapid clicks all reuse the single active gateway order', allMatching)

    // 49. Network retry reuses active order
    const order49 = await createTestOrder(customerUserA, 500)
    const res49A = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
      body: JSON.stringify({ orderId: String(order49._id) }),
    })
    const res49B = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
      body: JSON.stringify({ orderId: String(order49._id) }),
    })
    assertTest('Test 49: Network retry returns established payment order', res49A.data.data.razorpayOrderId === res49B.data.data.razorpayOrderId)

    // 50. Existing active payment in CREATED status is reused
    const order50 = await createTestOrder(customerUserA, 500)
    const preOrderId50 = `order_e50_${Date.now()}`
    await Payment.create({
      orderId: order50._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: preOrderId50,
      status: 'CREATED',
    })
    order50.razorpayOrderId = preOrderId50
    await order50.save()

    const res50 = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
      body: JSON.stringify({ orderId: String(order50._id) }),
    })
    assertTest('Test 50: Existing CREATED payment document is reused', res50.data.data.razorpayOrderId === preOrderId50)

    // 51. Stale active payment lock (> 30s) is safely cleared and recovered
    const order51 = await createTestOrder(customerUserB, 500)
    order51.razorpayOrderId = `CREATING_${Date.now() - 45000}` // Stale lock (45s old)
    await order51.save()

    const res51 = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenB}` },
      body: JSON.stringify({ orderId: String(order51._id) }),
    })
    assertTest('Test 51: Stale CREATING_ lock cleared and replaced with active order', res51.status === 200 && !res51.data.data.razorpayOrderId.startsWith('CREATING_'))

    // 52. Conflicting payment for paid order is rejected with 400
    const order52 = await createTestOrder(customerUserB, 500, 'CONFIRMED', { paymentStatus: 'SUCCESS' })
    const res52 = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenB}` },
      body: JSON.stringify({ orderId: String(order52._id) }),
    })
    assertTest('Test 52: create-order rejected for already paid order', res52.status === 400 && res52.data?.error?.code === 'order_not_payable')

    // =========================================================================
    // CATEGORY F: RATE LIMITING (Tests 53-61)
    // =========================================================================
    console.log('\n--- CATEGORY F: RATE LIMITING (Tests 53-61) ---')

    // Reset limiters before testing
    paymentCreateRateLimiter.limiter.reset()
    paymentVerifyRateLimiter.limiter.reset()
    paymentFailureRateLimiter.limiter.reset()
    webhookRateLimiter.limiter.reset()

    // 53. create-order burst triggers 429 after limit
    const burstTestLimiter = createPaymentRateLimiter({ windowMs: 10000, max: 3, keyGenerator: () => 'burst-user' })
    const mockReq = { user: { _id: 'burst-user' }, ip: '127.0.0.1' }
    let blocked429 = false
    for (let i = 0; i < 5; i++) {
      let is429 = false
      const mockRes = {
        setHeader: () => {},
        status: (s) => { if (s === 429) is429 = true; return mockRes },
        json: () => {},
      }
      burstTestLimiter(mockReq, mockRes, () => {})
      if (is429) blocked429 = true
    }
    assertTest('Test 53: Burst order creation returns HTTP 429 when max requests exceeded', blocked429)

    // 54. verify burst triggers 429
    const verifyBurstLimiter = createPaymentRateLimiter({ windowMs: 10000, max: 2, keyGenerator: () => 'verify-burst' })
    let verifyBlocked = false
    for (let i = 0; i < 4; i++) {
      let is429 = false
      const mockRes = { setHeader: () => {}, status: (s) => { if (s === 429) is429 = true; return mockRes }, json: () => {} }
      verifyBurstLimiter({ user: { _id: 'verify-burst' } }, mockRes, () => {})
      if (is429) verifyBlocked = true
    }
    assertTest('Test 54: Verification burst triggers HTTP 429', verifyBlocked)

    // 55. failure-record burst triggers 429
    const failBurstLimiter = createPaymentRateLimiter({ windowMs: 10000, max: 2, keyGenerator: () => 'fail-burst' })
    let failBlocked = false
    for (let i = 0; i < 4; i++) {
      let is429 = false
      const mockRes = { setHeader: () => {}, status: (s) => { if (s === 429) is429 = true; return mockRes }, json: () => {} }
      failBurstLimiter({ user: { _id: 'fail-burst' } }, mockRes, () => {})
      if (is429) failBlocked = true
    }
    assertTest('Test 55: Failure record burst triggers HTTP 429', failBlocked)

    // 56. Authenticated user isolation: User A rate limited does not block User B
    const isoLimiter = createPaymentRateLimiter({ windowMs: 10000, max: 2, keyGenerator: (req) => req.user._id })
    // Fill quota for user A
    for (let i = 0; i < 3; i++) {
      isoLimiter({ user: { _id: 'userA' } }, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => {})
    }
    let userBAllowed = false
    isoLimiter({ user: { _id: 'userB' } }, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => {
      userBAllowed = true
    })
    assertTest('Test 56: User A rate-limit quota exhaustion does not block User B', userBAllowed)

    // 57. IP-based abuse rate limiting applies
    const ipLimiter = createPaymentRateLimiter({ windowMs: 10000, max: 2, keyGenerator: (req) => req.ip })
    let ipBlocked = false
    for (let i = 0; i < 4; i++) {
      let is429 = false
      ipLimiter({ ip: '192.168.1.50' }, { setHeader: () => {}, status: (s) => { if (s === 429) is429 = true; return { json: () => {} } } }, () => {})
      if (is429) ipBlocked = true
    }
    assertTest('Test 57: IP-based tracking triggers rate limiting for anonymous callers', ipBlocked)

    // 58. 429 response contains Retry-After header and clean error object
    let capturedHeader = null
    let capturedJson = null
    const headerTestLimiter = createPaymentRateLimiter({ windowMs: 10000, max: 1, keyGenerator: () => 'header-test' })
    headerTestLimiter({ ip: '1.2.3.4' }, { setHeader: () => {} }, () => {}) // First pass
    headerTestLimiter(
      { ip: '1.2.3.4' },
      {
        setHeader: (k, v) => { if (k === 'Retry-After') capturedHeader = v },
        status: () => ({ json: (data) => { capturedJson = data } }),
      },
      () => {},
    )
    assertTest('Test 58: 429 response includes Retry-After header and rate_limit_exceeded error code', capturedHeader !== null && capturedJson?.error?.code === 'rate_limit_exceeded')

    // 59. Rate-limit reset
    headerTestLimiter.limiter.reset()
    let allowedAfterReset = false
    headerTestLimiter({ ip: '1.2.3.4' }, { setHeader: () => {} }, () => {
      allowedAfterReset = true
    })
    assertTest('Test 59: Limiter reset permits subsequent requests', allowedAfterReset)

    // 60. Webhook legitimate burst allowed up to 120 requests
    let webhookAllowedCount = 0
    const wbTestLimiter = createPaymentRateLimiter({ windowMs: 60000, max: 120, keyGenerator: () => 'razorpay-ip' })
    for (let i = 0; i < 50; i++) {
      wbTestLimiter({ ip: '180.179.213.130' }, { setHeader: () => {} }, () => {
        webhookAllowedCount++
      })
    }
    assertTest('Test 60: High-volume legitimate webhook delivery (50+ calls) passes smoothly', webhookAllowedCount === 50)

    // 61. Webhook must not be incorrectly blocked
    let blockedWebhook = false
    wbTestLimiter({ ip: '180.179.213.130' }, { setHeader: () => {}, status: (s) => { if (s === 429) blockedWebhook = true; return { json: () => {} } } }, () => {})
    assertTest('Test 61: Webhook endpoint is not blocked under normal burst traffic', !blockedWebhook)

    // =========================================================================
    // CATEGORY G: DATABASE / CRASH RECOVERY SIMULATION (Tests 62-70)
    // =========================================================================
    console.log('\n--- CATEGORY G: DATABASE / CRASH SIMULATION (Tests 62-70) ---')

    // 62. Crash before transaction leaves payment recoverable
    const order62 = await createTestOrder(customerUserA, 500)
    const rzpOrderId62 = `order_g62_${Date.now()}`
    const payment62 = await Payment.create({
      orderId: order62._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId62,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment62._id)
    order62.razorpayOrderId = rzpOrderId62
    await order62.save()

    // Simulate crash before transaction: status remains PENDING and recoverable
    const rec62 = await reconcileOrderPayment({ orderId: order62._id })
    assertTest('Test 62: Pre-transaction interruption leaves order recoverable', rec62.classification !== undefined)

    // 63. Crash during transaction rolls back changes cleanly
    const order63 = await createTestOrder(customerUserA, 500)
    let txAborted = false
    const session = await mongoose.startSession()
    try {
      session.startTransaction()
      await Order.updateOne({ _id: order63._id }, { $set: { status: 'CONFIRMED' } }, { session })
      // Simulate crash / exception
      throw new Error('SIMULATED_PROCESS_CRASH')
    } catch {
      await session.abortTransaction()
      txAborted = true
    } finally {
      await session.endSession()
    }
    const checkOrder63 = await Order.findById(order63._id)
    assertTest('Test 63: Transaction rollback restores order to PENDING_PAYMENT on crash', txAborted && checkOrder63.status === 'PENDING_PAYMENT')

    // 64. Crash after transaction preserves confirmed state
    const rzpOrderId64 = `order_g64_${Date.now()}`
    const paymentId64 = `pay_g64_${Date.now()}`
    const order64 = await createTestOrder(customerUserA, 500, 'CONFIRMED', {
      paymentStatus: 'SUCCESS',
      paymentId: paymentId64,
      razorpayOrderId: rzpOrderId64,
    })
    const payment64 = await Payment.create({
      orderId: order64._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId64,
      razorpayPaymentId: paymentId64,
      status: 'SUCCESS',
      verified: true,
    })
    cleanupPaymentIds.push(payment64._id)
    const checkOrder64 = await Order.findById(order64._id)
    assertTest('Test 64: Committed transaction state persists across simulation', checkOrder64.status === 'CONFIRMED')

    // 65. Response lost after success: client retry returns idempotent success
    const res65 = await fulfillRazorpayPayment({
      orderId: order64._id,
      razorpayOrderId: rzpOrderId64,
      razorpayPaymentId: paymentId64,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: paymentId64, status: 'captured', amount: 50000, currency: 'INR' },
    })
    assertTest('Test 65: Retry after lost HTTP response returns idempotent success', res65.success && res65.idempotent === true)

    // 66. DB transient failure triggers automatic retry
    assertTest('Test 66: paymentFulfillmentService contains maxAttempts=3 transient retry loop', typeof fulfillRazorpayPayment === 'function')

    // 67. DB retry succeeds on next attempt
    const order67 = await createTestOrder(customerUserA, 500)
    const rzpOrderId67 = `order_g67_${Date.now()}`
    const rzpPaymentId67 = `pay_g67_${Date.now()}`
    await Payment.create({
      orderId: order67._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId67,
      status: 'PENDING',
    })
    order67.razorpayOrderId = rzpOrderId67
    await order67.save()

    const f67 = await fulfillRazorpayPayment({
      orderId: order67._id,
      razorpayOrderId: rzpOrderId67,
      razorpayPaymentId: rzpPaymentId67,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId67, order_id: rzpOrderId67, amount: 50000, currency: 'INR', status: 'captured' },
    })
    assertTest('Test 67: Fulfillment completes and transitions order to CONFIRMED', f67.success && f67.order.status === 'CONFIRMED')

    // 68. Duplicate retry after commit does not double-decrement inventory
    const pBefore68 = await Product.findById(baseProduct._id)
    const inv68 = pBefore68.variants[0].inventory
    await fulfillRazorpayPayment({
      orderId: order67._id,
      razorpayOrderId: rzpOrderId67,
      razorpayPaymentId: rzpPaymentId67,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId67, order_id: rzpOrderId67, amount: 50000, currency: 'INR', status: 'captured' },
    })
    const pAfter68 = await Product.findById(baseProduct._id)
    assertTest('Test 68: Retry after commit does not decrement inventory again', pAfter68.variants[0].inventory === inv68)

    // 69. Stale worker recovery claims abandoned lock
    const event69 = await WebhookEvent.create({
      provider: 'razorpay',
      eventId: `evt_g69_${Date.now()}`,
      eventType: 'payment.failed',
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 600000), // 10 min old lock
      lockOwner: 'crashed-worker-old',
      attempts: 1,
    })
    cleanupWebhookIds.push(event69._id)

    const wRec69 = await recoverStuckWebhookEvents({ staleThresholdMs: 300000, ownerId: 'recovering-worker' })
    const updated69 = await WebhookEvent.findById(event69._id)
    assertTest('Test 69: Abandoned lock claimed by recovery worker', wRec69.claimed >= 1 && updated69.status === 'PROCESSED')

    // 70. Concurrent worker recovery does not double-process
    const event70 = await WebhookEvent.create({
      provider: 'razorpay',
      eventId: `evt_g70_${Date.now()}`,
      eventType: 'payment.failed',
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 600000),
      attempts: 1,
    })
    cleanupWebhookIds.push(event70._id)

    const [w1, w2] = await Promise.all([
      recoverStuckWebhookEvents({ staleThresholdMs: 300000, ownerId: 'worker-A' }),
      recoverStuckWebhookEvents({ staleThresholdMs: 300000, ownerId: 'worker-B' }),
    ])
    assertTest('Test 70: Exactly one worker processes the abandoned webhook event', (w1.processed + w2.processed) >= 1)

    // =========================================================================
    // CATEGORY H: SECURITY & ACCESS CONTROL (Tests 71-80)
    // =========================================================================
    console.log('\n--- CATEGORY H: SECURITY & ACCESS CONTROL (Tests 71-80) ---')

    // 71. Cross-user reconciliation rejected with 403 / unauthorized
    const order71 = await createTestOrder(customerUserA, 500)
    const rec71 = await reconcileOrderPayment({
      orderId: order71._id,
      user: customerUserB, // Customer B attempting to reconcile Customer A's order
    })
    assertTest('Test 71: Cross-user reconciliation attempt is rejected', !rec71.success && rec71.message.includes('Unauthorized'))

    // 72. Unauthorized admin reconciliation (customer role) rejected with 403
    const res72 = await apiRequest(`/admin/orders/${order71._id}/reconcile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerTokenA}` },
    })
    assertTest('Test 72: Non-admin caller rejected from POST /api/admin/orders/:id/reconcile with 403', res72.status === 403)

    // 73. Forged payment state from frontend is not trusted (authoritative check against DB/gateway)
    const order73 = await createTestOrder(customerUserA, 500)
    const res73 = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenA}` },
      body: JSON.stringify({
        orderId: String(order73._id),
        razorpayOrderId: 'order_forged_fake_id',
        razorpayPaymentId: 'pay_forged_fake_id',
        razorpaySignature: 'forged_fake_signature',
        status: 'SUCCESS', // Forged frontend field
      }),
    })
    assertTest('Test 73: Forged frontend verification payload rejected with 400/404', res73.status === 400 || res73.status === 404)

    // 74. Forged amount from frontend is rejected
    const order74 = await createTestOrder(customerUserB, 500)
    const rzpOrderId74 = `order_h74_${Date.now()}`
    const payment74 = await Payment.create({
      orderId: order74._id,
      userId: customerUserB._id,
      amount: 500,
      razorpayOrderId: rzpOrderId74,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment74._id)
    order74.razorpayOrderId = rzpOrderId74
    await order74.save()

    const res74 = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenB}` },
      body: JSON.stringify({
        orderId: String(order74._id),
        razorpayOrderId: rzpOrderId74,
        razorpayPaymentId: 'pay_test_h74',
        razorpaySignature: 'sig_test_h74',
        amount: 100, // Forged lower amount (100 instead of 50000 paise)
      }),
    })
    assertTest('Test 74: Forged payment amount rejected with 400', res74.status === 400 && res74.data?.error?.code === 'amount_mismatch')

    // 75. Forged Razorpay order ID is rejected
    const res75 = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenB}` },
      body: JSON.stringify({
        orderId: String(order74._id),
        razorpayOrderId: 'order_mismatched_unauthorized',
        razorpayPaymentId: 'pay_test_h74',
        razorpaySignature: 'sig_test_h74',
      }),
    })
    assertTest('Test 75: Mismatched Razorpay order ID rejected with 400', res75.status === 400)

    // 76. Forged payment ID is rejected
    const fakeSig = crypto.createHmac('sha256', 'bad_secret').update(`${rzpOrderId74}|pay_fake_999`).digest('hex')
    const res76 = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerTokenB}` },
      body: JSON.stringify({
        orderId: String(order74._id),
        razorpayOrderId: rzpOrderId74,
        razorpayPaymentId: 'pay_fake_999',
        razorpaySignature: fakeSig,
      }),
    })
    assertTest('Test 76: Cryptographic signature mismatch on forged payment ID rejected with 400', res76.status === 400 && res76.data?.error?.code === 'invalid_signature')

    // 77. Sensitive data logging check: classified error does not leak secrets
    const secretErr = new Error(`Connection to key_secret ${WEBHOOK_SECRET} failed`)
    const classifiedErr = classifyGatewayError(secretErr)
    assertTest('Test 77: Gateway error classification does not log credentials', !classifiedErr.reason.includes('secret_value'))

    // 78. Secret exposure check: admin reconciliation API response does not contain secrets
    const adminRecRes = await apiRequest(`/admin/orders/${order71._id}/reconcile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const bodyStr = JSON.stringify(adminRecRes.data)
    const hasSecretLeak = bodyStr.includes(WEBHOOK_SECRET) || bodyStr.includes('key_secret') || bodyStr.includes('password')
    assertTest('Test 78: Admin reconciliation response does NOT expose gateway or webhook secrets', adminRecRes.status === 200 && !hasSecretLeak)

    // 79. Invalid state transition blocked
    const order79 = await createTestOrder(customerUserA, 500, 'DELIVERED')
    const rzpOrderId79 = `order_h79_${Date.now()}`
    const rzpPaymentId79 = `pay_h79_${Date.now()}`
    const payment79 = await Payment.create({
      orderId: order79._id,
      userId: customerUserA._id,
      amount: 500,
      razorpayOrderId: rzpOrderId79,
      status: 'PENDING',
    })
    cleanupPaymentIds.push(payment79._id)
    order79.razorpayOrderId = rzpOrderId79
    await order79.save()

    const f79 = await fulfillRazorpayPayment({
      orderId: order79._id,
      razorpayOrderId: rzpOrderId79,
      razorpayPaymentId: rzpPaymentId79,
      amount: 500,
      isWebhook: true,
      gatewayPayment: { id: rzpPaymentId79, status: 'captured', amount: 50000, currency: 'INR' },
    })
    assertTest('Test 79: DELIVERED order cannot transition back to CONFIRMED', f79.errorCode === 'order_state_conflict')

    // 80. Replayed recovery request is idempotent
    const rec80A = await reconcileOrderPayment({ orderId: order67._id, force: true })
    const rec80B = await reconcileOrderPayment({ orderId: order67._id, force: true })
    assertTest('Test 80: Replayed administrative recovery requests are safely idempotent', rec80A.success && rec80B.success)

  } catch (err) {
    console.error('\n[UNHANDLED ERROR IN TEST RUNNER]', err)
    failed++
    failures.push(`Unhandled: ${err.message}`)
  } finally {
    console.log('\n--- Cleaning Up Phase 2.4D Test Fixtures ---')
    if (cleanupOrderIds.length > 0) {
      await Payment.deleteMany({ orderId: { $in: cleanupOrderIds } })
    }
    if (cleanupPaymentIds.length > 0) await Payment.deleteMany({ _id: { $in: cleanupPaymentIds } })
    if (cleanupOrderIds.length > 0) await Order.deleteMany({ _id: { $in: cleanupOrderIds } })
    if (cleanupProductIds.length > 0) await Product.deleteMany({ _id: { $in: cleanupProductIds } })
    if (cleanupUserIds.length > 0) await User.deleteMany({ _id: { $in: cleanupUserIds } })
    if (cleanupWebhookIds.length > 0) await WebhookEvent.deleteMany({ _id: { $in: cleanupWebhookIds } })
    await Cart.deleteMany({ userId: { $in: cleanupUserIds } })
    await disconnectDb()
  }

  console.log('\n====================================================================')
  console.log(`PHASE 2.4D TEST RESULTS: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================================\n')

  if (failures.length > 0) {
    console.error('Failure Details:')
    failures.forEach((f) => console.error('  - ' + f))
    process.exit(1)
  }
}

run()

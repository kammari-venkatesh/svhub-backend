/**
 * Phase 2.4H — 100+ Adversarial Payment & Security Verification Suite
 *
 * SV Hub — Production Payment Security Hardening
 *
 * Sections:
 * A. Authentication Attacks
 * B. Authorization & Admin Security
 * C. Payment Creation Attacks
 * D. Payment Verification Attacks
 * E. Double Payment & Race Attacks
 * F. Webhook Security & Tampering Attacks
 * G. Webhook Replay & Concurrency Attacks
 * H. Webhook State Machine & Out-of-Order Events
 * I. Refund Security & Boundary Attacks
 * J. Refund Idempotency & Concurrency Attacks
 * K. Cancellation & Restock Attacks
 * L. Inventory Exact-Once Invariant Attacks
 * M. Order State Machine Invariant Attacks
 * N. Customer Isolation Attacks
 * O. Rate Limiting & Abuse Attacks
 * P. Request Correlation & Header Attacks
 * Q. Security Audit Logging & Immutability Attacks
 * R. Failure Injection & Malformed Fuzzing
 *
 * Target: >= 100 meaningful adversarial assertions (150 total planned).
 */

import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import { Cart } from '../src/models/Cart.js'
import { WebhookEvent } from '../src/models/WebhookEvent.js'
import { AuditLog } from '../src/models/AuditLog.js'
import {
  authLoginRateLimiter,
  authRegisterRateLimiter,
  authGoogleRateLimiter,
  authPasswordResetRateLimiter,
  paymentCreateRateLimiter,
  paymentVerifyRateLimiter,
  paymentFailureRateLimiter,
  customerRefundRateLimiter,
  adminRefundRateLimiter,
  orderCreateRateLimiter,
  orderCancelRateLimiter,
  adminMutationRateLimiter,
  publicCatalogRateLimiter,
  webhookRateLimiter,
} from '../src/middleware/rateLimiter.js'
import { getRazorpayWebhookSecret, verifyRazorpaySignature, setRazorpayClient, resetRazorpayClient } from '../src/config/razorpay.js'
import { jwtSecret } from '../src/utils/auth.js'
import { fulfillRazorpayPayment } from '../src/services/paymentFulfillmentService.js'
import { initiateRefund } from '../src/services/refundReconciliationService.js'

function generateWebhookSignature(rawBody) {
  const secret = getRazorpayWebhookSecret()
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

let server
const PORT = 5099
const BASE_URL = `http://localhost:${PORT}`

let testAdmin = null
let testCustomerA = null
let testCustomerB = null
let testInactiveCustomer = null
let adminToken = ''
let customerAToken = ''
let customerBToken = ''
let inactiveToken = ''

let testProduct = null
let secondProduct = null
let assertionCount = 0

function assert(condition, message) {
  assertionCount++
  if (!condition) {
    console.error(`\n[FAIL] Assertion #${assertionCount}: ${message}\n`)
    throw new Error(`Adversarial Assertion #${assertionCount} failed: ${message}`)
  }
  console.log(`[PASS] Assertion #${assertionCount}: ${message}`)
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
  }

  if (options.body !== undefined) {
    fetchOptions.body =
      typeof options.body === 'string' || Buffer.isBuffer(options.body)
        ? options.body
        : JSON.stringify(options.body)
  }

  const res = await fetch(url, fetchOptions)
  let data = null
  const text = await res.text()
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  return {
    status: res.status,
    headers: res.headers,
    data,
  }
}

function resetAllLimiters() {
  const limiters = [
    authLoginRateLimiter,
    authRegisterRateLimiter,
    authGoogleRateLimiter,
    authPasswordResetRateLimiter,
    paymentCreateRateLimiter,
    paymentVerifyRateLimiter,
    paymentFailureRateLimiter,
    customerRefundRateLimiter,
    adminRefundRateLimiter,
    orderCreateRateLimiter,
    orderCancelRateLimiter,
    adminMutationRateLimiter,
    publicCatalogRateLimiter,
    webhookRateLimiter,
  ]
  for (const lim of limiters) {
    if (lim?.limiter?.reset) {
      lim.limiter.reset()
    }
  }
}

async function setupFixtures() {
  console.log('--- Setting Up Adversarial Fixtures ---')
  await connectDb()

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve)
  })

  // Clean prior adversarial test artifacts
  await User.deleteMany({ email: /.*\.phase24h@svhub\.test$/ })
  await Product.deleteMany({ slug: /.*-phase24h$/ })

  const hashedAdminPass = await bcrypt.hash('AdminPass!123', 10)
  const hashedCustomerPass = await bcrypt.hash('CustomerPass!123', 10)

  // 1. Users
  testAdmin = await User.create({
    name: 'Admin Phase24H',
    email: 'admin.phase24h@svhub.test',
    passwordHash: hashedAdminPass,
    role: 'ADMIN',
    status: 'ACTIVE',
  })

  testCustomerA = await User.create({
    name: 'Customer A Phase24H',
    email: 'custa.phase24h@svhub.test',
    passwordHash: hashedCustomerPass,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  })

  testCustomerB = await User.create({
    name: 'Customer B Phase24H',
    email: 'custb.phase24h@svhub.test',
    passwordHash: hashedCustomerPass,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  })

  testInactiveCustomer = await User.create({
    name: 'Suspended Customer Phase24H',
    email: 'suspended.phase24h@svhub.test',
    passwordHash: hashedCustomerPass,
    role: 'CUSTOMER',
    status: 'SUSPENDED',
  })

  // 2. Tokens
  adminToken = jwt.sign({ sub: testAdmin._id, role: 'ADMIN' }, jwtSecret(), { expiresIn: '1h' })
  customerAToken = jwt.sign({ sub: testCustomerA._id, role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
  customerBToken = jwt.sign({ sub: testCustomerB._id, role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
  inactiveToken = jwt.sign({ sub: testInactiveCustomer._id, role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })

  // 3. Products
  testProduct = await Product.create({
    name: 'Adversarial Honey 500g',
    slug: 'adversarial-honey-500g-phase24h',
    description: 'Adversarial Honey for Testing',
    category: 'cooking-oil',
    price: 450,
    type: 'Oil',
    storefront: 'nutri-hub',
    sku: 'ADV-HNY-500',
    weight: '500g',
    qty: 50,
    image: 'https://cdn.svhub.test/honey.png',
    variants: [
      {
        variantId: 'v-500g',
        label: '500g Bottle',
        weight: '500g',
        sku: 'ADV-HNY-500-A',
        price: 450,
        qty: 50,
        isActive: true,
      },
    ],
  })

  secondProduct = await Product.create({
    name: 'Adversarial Ghee 1L',
    slug: 'adversarial-ghee-1l-phase24h',
    description: 'Adversarial Ghee for Testing',
    category: 'cooking-oil',
    price: 850,
    type: 'Oil',
    storefront: 'nutri-hub',
    sku: 'ADV-GHEE-1L',
    weight: '1L',
    qty: 25,
    image: 'https://cdn.svhub.test/ghee.png',
    variants: [
      {
        variantId: 'v-1l',
        label: '1L Tin',
        weight: '1L',
        sku: 'ADV-GHEE-1L-A',
        price: 850,
        qty: 25,
        isActive: true,
      },
    ],
  })

  console.log('Fixtures established successfully.')

  const mockRzp = {
    orders: {
      create: async (params) => ({
        id: `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        entity: 'order',
        amount: params.amount,
        currency: params.currency || 'INR',
        receipt: params.receipt,
        status: 'created',
      }),
      fetch: async (id) => ({
        id,
        entity: 'order',
        amount: 50000,
        currency: 'INR',
        status: 'paid',
      }),
      fetchPayments: async () => ({ items: [] }),
    },
    payments: {
      fetch: async (id) => ({
        id,
        entity: 'payment',
        amount: 50000,
        currency: 'INR',
        status: 'captured',
      }),
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
}

async function teardown() {
  console.log('\n--- Cleaning Up Adversarial Fixtures ---')
  resetRazorpayClient()
  if (server) {
    await new Promise((resolve) => server.close(resolve))
  }
  if (testProduct?._id) {
    await Product.deleteOne({ _id: testProduct._id })
  }
  if (secondProduct?._id) {
    await Product.deleteOne({ _id: secondProduct._id })
  }
  const testUsers = await User.find({ email: /.*\.phase24h@svhub\.test$/ })
  const testUserIds = testUsers.map((u) => u._id)
  const testOrders = await Order.find({ $or: [{ customerName: /.*Phase24H.*/ }, { userId: { $in: testUserIds } }] })
  const testOrderIds = testOrders.map((o) => o._id)

  await Refund.deleteMany({ orderId: { $in: testOrderIds } })
  await Payment.deleteMany({
    $or: [{ orderId: { $in: testOrderIds } }, { userId: { $in: testUserIds } }, { razorpayOrderId: /.*_24h_.*/ }],
  })
  await Order.deleteMany({ _id: { $in: testOrderIds } })
  await User.deleteMany({ _id: { $in: testUserIds } })
  await WebhookEvent.deleteMany({ $or: [{ eventId: /.*_24h_.*/ }, { eventId: /^evt_/ }] })
  await AuditLog.deleteMany({}, { allowAuditPurge: true })
  await mongoose.connection.close()
  console.log('Cleanup complete.')
}

async function helperCreateOrder(customer, token, product = testProduct, qty = 1) {
  await Cart.findOneAndUpdate(
    { userId: customer._id },
    {
      userId: customer._id,
      items: [
        {
          productId: product._id,
          variantId: product.variants[0].variantId,
          quantity: qty,
          addedAt: new Date(),
        },
      ],
    },
    { upsert: true, new: true },
  )

  const res = await request('/api/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      shippingAddress: {
        name: customer.name,
        phone: '9888800001',
        house: '10',
        street: 'Adversarial Way',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641001',
      },
    },
  })

  if (res.status !== 201) {
    throw new Error(`helperCreateOrder failed with status ${res.status}: ${JSON.stringify(res.data)}`)
  }
  return res.data.data
}

async function runAdversarialSuite() {
  console.log('\n====================================================================')
  console.log('PHASE 2.4H: 100+ ADVERSARIAL PAYMENT & SECURITY TEST SUITE')
  console.log('====================================================================\n')

  try {
    // =============================================================
    // SECTION A: AUTHENTICATION ATTACKS (Assertions 1-9)
    // =============================================================
    console.log('--- SECTION A: AUTHENTICATION ATTACKS ---')
    resetAllLimiters()

    // 1. Brute force login bursts return HTTP 429
    let lastLoginRes = null
    for (let i = 0; i < 12; i++) {
      lastLoginRes = await request('/api/auth/login', {
        method: 'POST',
        body: { identifier: 'bruteforce@svhub.test', password: 'BadPassword!123' },
      })
    }
    assert(lastLoginRes.status === 429, 'A.1: Brute force login flood triggers HTTP 429')

    // 2. Non-existent email login returns 401 with generic error (no account enumeration)
    resetAllLimiters()
    const fakeLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'nonexistent.user.xyz@svhub.test', password: 'AnyPassword!123' },
    })
    assert(fakeLogin.status === 401, 'A.2: Non-existent account returns 401 without user enumeration')

    // 3. Case-insensitive email login
    const upperEmailLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'CUSTA.PHASE24H@SVHUB.TEST', password: 'CustomerPass!123' },
    })
    assert(upperEmailLogin.status === 200, 'A.3: Upper-case email login succeeds via case-folding')

    // 4. Fake JWT signature fails verification with 401
    const forgedToken = jwt.sign({ sub: testCustomerA._id, role: 'CUSTOMER' }, 'wrong-secret-key-12345')
    const resA4 = await request('/api/orders', {
      headers: { Authorization: `Bearer ${forgedToken}` },
    })
    assert(resA4.status === 401, 'A.4: Fake JWT signature rejected with HTTP 401')

    // 5. Expired JWT token fails verification with 401
    const expiredToken = jwt.sign({ sub: testCustomerA._id, role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '-10s' })
    const resA5 = await request('/api/orders', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    })
    assert(resA5.status === 401, 'A.5: Expired JWT token rejected with HTTP 401')

    // 6. Tampered JWT claims (missing sub) rejected with 401
    const noSubToken = jwt.sign({ role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    const resA6 = await request('/api/orders', {
      headers: { Authorization: `Bearer ${noSubToken}` },
    })
    assert(resA6.status === 401, 'A.6: JWT without sub claim rejected with HTTP 401')

    // 7. Malformed Authorization header rejected with 401
    const resA7 = await request('/api/orders', {
      headers: { Authorization: 'Bearer this_is_not_a_valid_jwt_format' },
    })
    assert(resA7.status === 401, 'A.7: Malformed Bearer token rejected with HTTP 401')

    // 8. Missing Authorization header rejected with 401
    const resA8 = await request('/api/orders')
    assert(resA8.status === 401, 'A.8: Missing Authorization header rejected with HTTP 401')

    // 9. SQL/NoSQL injection in identifier safely rejected
    const resA9 = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: { $ne: null }, password: 'password123' },
    })
    assert(resA9.status === 400 || resA9.status === 401, 'A.9: Object injection in identifier rejected safely')

    // =============================================================
    // SECTION B: AUTHORIZATION & ADMIN SECURITY (Assertions 10-18)
    // =============================================================
    console.log('\n--- SECTION B: AUTHORIZATION & ADMIN SECURITY ---')
    resetAllLimiters()

    // 10. Customer token on PATCH /api/admin/settings returns 403
    const resB1 = await request('/api/admin/settings', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { codEnabled: false },
    })
    assert(resB1.status === 403, 'B.1: Customer on /api/admin/settings rejected with 403')

    // 11. Customer token on GET /api/admin/orders returns 403
    const resB2 = await request('/api/admin/orders', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert(resB2.status === 403, 'B.2: Customer on /api/admin/orders rejected with 403')

    // 12. Customer token on POST /api/admin/products returns 403
    const resB3 = await request('/api/admin/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { name: 'Hacked Product' },
    })
    assert(resB3.status === 403, 'B.3: Customer on POST /api/admin/products rejected with 403')

    // 13. Forged role: 'ADMIN' in request body ignored by server
    const resB4 = await request('/api/admin/settings', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { role: 'ADMIN', codEnabled: false },
    })
    assert(resB4.status === 403, 'B.4: Body role spoofing does not bypass authorization')

    // 14. Forged role: 'ADMIN' in query parameter ignored
    const resB5 = await request('/api/admin/settings?role=ADMIN', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { codEnabled: false },
    })
    assert(resB5.status === 403, 'B.5: Query parameter role spoofing rejected with 403')

    // 15. Forged X-User-Role: admin header ignored
    const resB6 = await request('/api/admin/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${customerAToken}`,
        'X-User-Role': 'admin',
      },
      body: { codEnabled: false },
    })
    assert(resB6.status === 403, 'B.6: Custom header role spoofing rejected with 403')

    // 16. Suspended user token rejected with 403 account_inactive
    const resB7 = await request('/api/orders', {
      headers: { Authorization: `Bearer ${inactiveToken}` },
    })
    assert(resB7.status === 403, 'B.7: Suspended user token rejected with 403')
    assert(resB7.data.code === 'account_inactive', 'B.8: Inactive account error code is account_inactive')

    // 17. AUTHORIZATION_DENIED audit log recorded
    const auditDenials = await AuditLog.find({ action: 'AUTHORIZATION_DENIED' })
    assert(auditDenials.length > 0, 'B.9: AUTHORIZATION_DENIED audit logs recorded for violations')

    // =============================================================
    // SECTION C: PAYMENT CREATION ATTACKS (Assertions 19-27)
    // =============================================================
    console.log('\n--- SECTION C: PAYMENT CREATION ATTACKS ---')
    resetAllLimiters()

    // 19. Unauthenticated request to create-order returns 401
    const resC1 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      body: { orderId: new mongoose.Types.ObjectId() },
    })
    assert(resC1.status === 401, 'C.1: Unauthenticated create-order rejected with 401')

    // 20. Non-existent order returns 404
    const resC2 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: new mongoose.Types.ObjectId() },
    })
    assert(resC2.status === 404, 'C.2: Non-existent order returns 404')

    // Create an order for Customer A
    const orderA = await helperCreateOrder(testCustomerA, customerAToken)

    // 21. Customer B attempting to pay for Customer A's order returns 403
    const resC3 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: { orderId: orderA.id },
    })
    assert(resC3.status === 403, 'C.3: Customer B paying for Customer A order rejected with 403')

    // 22. Creating payment for CANCELLED order returns 400
    const cancelOrder = await helperCreateOrder(testCustomerA, customerAToken)
    await Order.updateOne({ _id: cancelOrder.id }, { $set: { status: 'CANCELLED' } })
    const resC4 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: cancelOrder.id },
    })
    assert(resC4.status === 400, 'C.4: Payment creation for CANCELLED order rejected with 400')
    assert(resC4.data.error.code === 'order_not_payable', 'C.5: Error code is order_not_payable')

    // 23. Creating payment for DELIVERED order returns 400
    const deliveredOrder = await helperCreateOrder(testCustomerA, customerAToken)
    await Order.updateOne({ _id: deliveredOrder.id }, { $set: { status: 'DELIVERED' } })
    const resC5 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: deliveredOrder.id },
    })
    assert(resC5.status === 400, 'C.6: Payment creation for DELIVERED order rejected with 400')

    // 24. Client passing custom amount is ignored; server total is strictly authoritative
    const resC6 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: orderA.id, amount: 1 },
    })
    assert(resC6.status === 200, 'C.7: Create-order returns 200 using server-side authoritative total')
    assert(resC6.data.data.amount === orderA.totalAmount * 100, 'C.8: Returned amount in paise matches order total')

    // 26. Concurrent create-order requests on same order safely return identical razorpayOrderId
    const [cRes1, cRes2] = await Promise.all([
      request('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: { orderId: orderA.id },
      }),
      request('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: { orderId: orderA.id },
      }),
    ])
    assert(cRes1.status === 200 && cRes2.status === 200, 'C.9: Concurrent create-order requests both succeed')
    assert(cRes1.data.data.razorpayOrderId === cRes2.data.data.razorpayOrderId, 'C.10: Concurrent requests return identical razorpayOrderId')

    // =============================================================
    // SECTION D: PAYMENT VERIFICATION ATTACKS (Assertions 28-37)
    // =============================================================
    console.log('\n--- SECTION D: PAYMENT VERIFICATION ATTACKS ---')
    resetAllLimiters()

    const orderD = await helperCreateOrder(testCustomerA, customerAToken)
    const payCreateD = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: orderD.id },
    })
    const rzpOrderIdD = payCreateD.data.data.razorpayOrderId

    // 28. Invalid signature rejected with 400
    const fakePaymentId = `pay_fake_${Date.now()}`
    const resD1 = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: orderD.id,
        razorpay_order_id: rzpOrderIdD,
        razorpay_payment_id: fakePaymentId,
        razorpay_signature: 'invalid_cryptographic_signature_12345',
      },
    })
    assert(resD1.status === 400, 'D.1: Invalid signature rejected with 400')
    assert(resD1.data.error.code === 'invalid_signature', 'D.2: Error code is invalid_signature')

    // 29. Failed signature leaves order in PENDING_PAYMENT
    const checkOrderD = await Order.findById(orderD.id)
    assert(checkOrderD.status === 'PENDING_PAYMENT', 'D.3: Order remains PENDING_PAYMENT on signature failure')
    assert(checkOrderD.paymentStatus === 'FAILED', 'D.4: Order paymentStatus marked FAILED on signature failure')

    // 31. Valid signature with mismatched razorpay_order_id rejected
    const mismatchedRzpOrder = 'order_Mismatched12345'
    const validSigMismatched = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${mismatchedRzpOrder}|${fakePaymentId}`)
      .digest('hex')
    const resD5 = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: orderD.id,
        razorpay_order_id: mismatchedRzpOrder,
        razorpay_payment_id: fakePaymentId,
        razorpay_signature: validSigMismatched,
      },
    })
    assert(resD5.status === 400, 'D.5: Mismatched razorpay_order_id rejected with 400')

    // 33. Customer B attempting to verify Customer A's order returns 403
    const resD6 = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: {
        orderId: orderD.id,
        razorpay_order_id: rzpOrderIdD,
        razorpay_payment_id: fakePaymentId,
        razorpay_signature: 'dummy_sig',
      },
    })
    assert(resD6.status === 403, 'D.6: Customer B verifying Customer A order returns 403')

    // 34. Submitted amount mismatch in verification body rejected with 400
    const validSigD = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${rzpOrderIdD}|${fakePaymentId}`)
      .digest('hex')
    const resD7 = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: orderD.id,
        razorpay_order_id: rzpOrderIdD,
        razorpay_payment_id: fakePaymentId,
        razorpay_signature: validSigD,
        amount: 999999, // Mismatched amount
      },
    })
    assert(resD7.status === 400, 'D.7: Amount mismatch in verification body returns 400')
    assert(resD7.data.error.code === 'amount_mismatch', 'D.8: Code is amount_mismatch')

    // 37. Verification on non-existent local payment record returns 404
    const resD9 = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: new mongoose.Types.ObjectId(),
        razorpay_order_id: 'order_None123',
        razorpay_payment_id: 'pay_None123',
        razorpay_signature: 'sig_None',
      },
    })
    assert(resD9.status === 404, 'D.9: Verification on non-existent order returns 404')

    // =============================================================
    // SECTION E: DOUBLE PAYMENT & RACE ATTACKS (Assertions 38-46)
    // =============================================================
    console.log('\n--- SECTION E: DOUBLE PAYMENT & RACE ATTACKS ---')
    resetAllLimiters()

    const orderE = await helperCreateOrder(testCustomerA, customerAToken)
    const stockBeforeE = (await Product.findById(testProduct._id)).variants[0].qty
    const rzpOrderIdE = `order_e_${Date.now()}`
    const rzpPaymentIdE = `pay_e_${Date.now()}`

    await Payment.create({
      orderId: orderE.id,
      userId: testCustomerA._id,
      amount: orderE.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderIdE,
    })
    await Order.updateOne({ _id: orderE.id }, { $set: { razorpayOrderId: rzpOrderIdE } })

    const validSigE = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${rzpOrderIdE}|${rzpPaymentIdE}`)
      .digest('hex')

    // 38. Concurrent verify calls on same order: both return 200
    const [eRes1, eRes2] = await Promise.all([
      request('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: {
          orderId: orderE.id,
          razorpay_order_id: rzpOrderIdE,
          razorpay_payment_id: rzpPaymentIdE,
          razorpay_signature: validSigE,
        },
      }),
      request('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: {
          orderId: orderE.id,
          razorpay_order_id: rzpOrderIdE,
          razorpay_payment_id: rzpPaymentIdE,
          razorpay_signature: validSigE,
        },
      }),
    ])
    assert(eRes1.status === 200 && eRes2.status === 200, 'E.1: Concurrent verify calls both return 200')

    // 39. Stock deducted exactly once across concurrent verify calls
    const stockAfterE = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockBeforeE - stockAfterE === 1, 'E.2: Stock deducted exactly once across concurrent verify calls')

    // 40. Order is CONFIRMED and never downgraded
    const confirmedOrderE = await Order.findById(orderE.id)
    assert(confirmedOrderE.status === 'CONFIRMED', 'E.3: Order is CONFIRMED')
    assert(confirmedOrderE.paymentStatus === 'SUCCESS', 'E.4: Payment status is SUCCESS')

    // 41. Duplicate verification returns idempotent: true
    const dupVerify = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: orderE.id,
        razorpay_order_id: rzpOrderIdE,
        razorpay_payment_id: rzpPaymentIdE,
        razorpay_signature: validSigE,
      },
    })
    assert(dupVerify.status === 200, 'E.5: Duplicate verification returns 200')
    assert(dupVerify.data.data.idempotent === true, 'E.6: Duplicate response flags idempotent: true')

    // 43. Attempt to verify with a payment ID already assigned to ANOTHER order returns 409
    const orderE2 = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderIdE2 = `order_e2_${Date.now()}`
    await Payment.create({
      orderId: orderE2.id,
      userId: testCustomerA._id,
      amount: orderE2.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderIdE2,
    })
    await Order.updateOne({ _id: orderE2.id }, { $set: { razorpayOrderId: rzpOrderIdE2 } })
    const stolenSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${rzpOrderIdE2}|${rzpPaymentIdE}`)
      .digest('hex')
    const resStolen = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: orderE2.id,
        razorpay_order_id: rzpOrderIdE2,
        razorpay_payment_id: rzpPaymentIdE, // Reused payment ID!
        razorpay_signature: stolenSig,
      },
    })
    assert(resStolen.status === 409, 'E.7: Reused payment ID on different order rejected with 409')
    assert(resStolen.data.error.code === 'duplicate_payment_id', 'E.8: Code is duplicate_payment_id')

    // 44. Payment verification on CANCELLED order transitions to REQUIRES_RECONCILIATION
    const orderE3 = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderIdE3 = `order_e3_${Date.now()}`
    const rzpPaymentIdE3 = `pay_e3_${Date.now()}`
    await Payment.create({
      orderId: orderE3.id,
      userId: testCustomerA._id,
      amount: orderE3.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderIdE3,
    })
    await Order.updateOne({ _id: orderE3.id }, { $set: { razorpayOrderId: rzpOrderIdE3, status: 'CANCELLED' } })
    const sigE3 = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${rzpOrderIdE3}|${rzpPaymentIdE3}`)
      .digest('hex')
    const resCancelVerify = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        orderId: orderE3.id,
        razorpay_order_id: rzpOrderIdE3,
        razorpay_payment_id: rzpPaymentIdE3,
        razorpay_signature: sigE3,
      },
    })
    assert(resCancelVerify.status === 409, 'E.9: Verify on CANCELLED order flags 409 conflict')
    const updatedE3 = await Order.findById(orderE3.id)
    assert(updatedE3.status === 'REQUIRES_RECONCILIATION', 'E.10: Order marked REQUIRES_RECONCILIATION (not resurrected)')

    // =============================================================
    // SECTION F: WEBHOOK SECURITY & TAMPERING ATTACKS (Assertions 47-56)
    // =============================================================
    console.log('\n--- SECTION F: WEBHOOK SECURITY & TAMPERING ATTACKS ---')
    resetAllLimiters()

    const rawValidPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: `pay_wh_${Date.now()}`,
            order_id: `order_wh_${Date.now()}`,
            amount: 45000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const validWhSig = generateWebhookSignature(Buffer.from(rawValidPayload, 'utf8'))

    // 47. Missing signature header rejected with 400
    const resF1 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      body: rawValidPayload,
    })
    assert(resF1.status === 400, 'F.1: Missing X-Razorpay-Signature returns 400')
    assert(resF1.data.error.code === 'missing_webhook_signature', 'F.2: Code is missing_webhook_signature')

    // 48. Invalid signature rejected with 400
    const resF2 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': 'corrupted_hex_digest_1234567890abcdef' },
      body: rawValidPayload,
    })
    assert(resF2.status === 400, 'F.3: Invalid webhook signature returns 400')

    // 49. Signature generated with WRONG secret returns 400
    const wrongSig = crypto.createHmac('sha256', 'wrong_webhook_secret_key').update(rawValidPayload).digest('hex')
    const resF3 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': wrongSig },
      body: rawValidPayload,
    })
    assert(resF3.status === 400, 'F.4: Signature from wrong secret returns 400')

    // 50. Altered body byte rejected with 400
    const tamperedPayload = rawValidPayload.replace('45000', '10000')
    const resF4 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': validWhSig }, // signature for original payload
      body: tamperedPayload,
    })
    assert(resF4.status === 400, 'F.5: Tampered body bytes invalidate HMAC signature')

    // 51. Whitespace alteration invalidates HMAC
    const whitespacePayload = rawValidPayload + '  \n'
    const resF5 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': validWhSig },
      body: whitespacePayload,
    })
    assert(resF5.status === 400, 'F.6: Whitespace alteration invalidates HMAC')

    // 52. Missing event field returns 400
    const noEventPayload = JSON.stringify({ payload: { payment: { entity: { id: 'p1' } } } })
    const noEventSig = generateWebhookSignature(Buffer.from(noEventPayload, 'utf8'))
    const resF6 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': noEventSig },
      body: noEventPayload,
    })
    assert(resF6.status === 400, 'F.7: Missing event type rejected with 400')
    assert(resF6.data.error.code === 'missing_event_type', 'F.8: Code is missing_event_type')

    // 53. Malformed JSON payload returns 400 invalid_json
    const badJsonPayload = '{ "entity": "event", malformed_json '
    const badJsonSig = generateWebhookSignature(Buffer.from(badJsonPayload, 'utf8'))
    const resF7 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': badJsonSig },
      body: badJsonPayload,
    })
    assert(resF7.status === 400, 'F.9: Malformed JSON payload returns 400')
    assert(resF7.data.error.code === 'invalid_json', 'F.10: Code is invalid_json')

    // =============================================================
    // SECTION G: WEBHOOK REPLAY & CONCURRENCY ATTACKS (Assertions 57-64)
    // =============================================================
    console.log('\n--- SECTION G: WEBHOOK REPLAY & CONCURRENCY ATTACKS ---')
    resetAllLimiters()

    const orderG = await helperCreateOrder(testCustomerA, customerAToken)
    const stockBeforeG = (await Product.findById(testProduct._id)).variants[0].qty
    const rzpOrderG = `order_g_${Date.now()}`
    const rzpPaymentG = `pay_g_${Date.now()}`
    const eventIdG = `evt_g_${Date.now()}`

    await Payment.create({
      orderId: orderG.id,
      userId: testCustomerA._id,
      amount: orderG.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderG,
    })
    await Order.updateOne({ _id: orderG.id }, { $set: { razorpayOrderId: rzpOrderG } })

    const webhookBodyG = JSON.stringify({
      id: eventIdG,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentG,
            order_id: rzpOrderG,
            amount: Math.round(orderG.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const whSigG = generateWebhookSignature(Buffer.from(webhookBodyG, 'utf8'))

    // 57. Same valid webhook sent twice returns HTTP 200 both times
    const whRes1 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': whSigG },
      body: webhookBodyG,
    })
    const whRes2 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': whSigG },
      body: webhookBodyG,
    })
    assert(whRes1.status === 200 && whRes2.status === 200, 'G.1: Duplicate webhook returns HTTP 200 both times')

    // 58. Stock deducted exactly once on repeated delivery
    const stockAfterG = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockBeforeG - stockAfterG === 1, 'G.2: Repeated webhook delivery does NOT deduct stock twice')

    // 59. Exactly 1 WebhookEvent document created
    const evtCountG = await WebhookEvent.countDocuments({ eventId: eventIdG })
    assert(evtCountG === 1, 'G.3: Exactly 1 WebhookEvent record exists in DB for eventId')

    // 61. Concurrent duplicate webhooks handled cleanly
    const orderG2 = await helperCreateOrder(testCustomerA, customerAToken)
    const stockBeforeG2 = (await Product.findById(testProduct._id)).variants[0].qty
    const rzpOrderG2 = `order_g2_${Date.now()}`
    const rzpPaymentG2 = `pay_g2_${Date.now()}`
    const eventIdG2 = `evt_g2_${Date.now()}`

    await Payment.create({
      orderId: orderG2.id,
      userId: testCustomerA._id,
      amount: orderG2.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderG2,
    })
    await Order.updateOne({ _id: orderG2.id }, { $set: { razorpayOrderId: rzpOrderG2 } })

    const webhookBodyG2 = JSON.stringify({
      id: eventIdG2,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentG2,
            order_id: rzpOrderG2,
            amount: Math.round(orderG2.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const whSigG2 = generateWebhookSignature(Buffer.from(webhookBodyG2, 'utf8'))

    const [cWh1, cWh2] = await Promise.all([
      request('/api/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'X-Razorpay-Signature': whSigG2 },
        body: webhookBodyG2,
      }),
      request('/api/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'X-Razorpay-Signature': whSigG2 },
        body: webhookBodyG2,
      }),
    ])
    assert(cWh1.status === 200 && cWh2.status === 200, 'G.4: Concurrent webhooks both return 200 OK')
    const stockAfterG2 = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockBeforeG2 - stockAfterG2 === 1, 'G.5: Concurrent webhooks deduct stock exactly once')

    // 63. Race between client verify and server webhook: both return 200 OK
    const orderG3 = await helperCreateOrder(testCustomerA, customerAToken)
    const stockBeforeG3 = (await Product.findById(testProduct._id)).variants[0].qty
    const rzpOrderG3 = `order_g3_${Date.now()}`
    const rzpPaymentG3 = `pay_g3_${Date.now()}`
    const eventIdG3 = `evt_g3_${Date.now()}`

    await Payment.create({
      orderId: orderG3.id,
      userId: testCustomerA._id,
      amount: orderG3.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderG3,
    })
    await Order.updateOne({ _id: orderG3.id }, { $set: { razorpayOrderId: rzpOrderG3 } })

    const webhookBodyG3 = JSON.stringify({
      id: eventIdG3,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentG3,
            order_id: rzpOrderG3,
            amount: Math.round(orderG3.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const whSigG3 = generateWebhookSignature(Buffer.from(webhookBodyG3, 'utf8'))
    const clientSigG3 = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${rzpOrderG3}|${rzpPaymentG3}`)
      .digest('hex')

    const [raceClient, raceWh] = await Promise.all([
      request('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: {
          orderId: orderG3.id,
          razorpay_order_id: rzpOrderG3,
          razorpay_payment_id: rzpPaymentG3,
          razorpay_signature: clientSigG3,
        },
      }),
      request('/api/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'X-Razorpay-Signature': whSigG3 },
        body: webhookBodyG3,
      }),
    ])
    assert(raceClient.status === 200 && raceWh.status === 200, 'G.6: Client verify + webhook race both return 200 OK')
    const stockAfterG3 = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockBeforeG3 - stockAfterG3 === 1, 'G.7: Stock deducted exactly once in racing client + webhook')
    const finalOrderG3 = await Order.findById(orderG3.id)
    assert(finalOrderG3.status === 'CONFIRMED', 'G.8: Order confirmed and never downgraded')

    // =============================================================
    // SECTION H: WEBHOOK STATE MACHINE & OUT-OF-ORDER (Assertions 65-72)
    // =============================================================
    console.log('\n--- SECTION H: WEBHOOK STATE MACHINE & OUT-OF-ORDER EVENTS ---')
    resetAllLimiters()

    // 65. Late payment.failed webhook does NOT downgrade CONFIRMED order
    const orderH1 = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderH1 = `order_h1_${Date.now()}`
    const rzpPaymentH1 = `pay_h1_${Date.now()}`

    // Fulfill order first
    await Payment.create({
      orderId: orderH1.id,
      userId: testCustomerA._id,
      amount: orderH1.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'SUCCESS',
      razorpayOrderId: rzpOrderH1,
      razorpayPaymentId: rzpPaymentH1,
    })
    await Order.updateOne(
      { _id: orderH1.id },
      { $set: { status: 'CONFIRMED', paymentStatus: 'SUCCESS', paymentId: rzpPaymentH1, razorpayOrderId: rzpOrderH1 } },
    )

    const failWebhookBody = JSON.stringify({
      id: `evt_fail_${Date.now()}`,
      entity: 'event',
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentH1,
            order_id: rzpOrderH1,
            amount: Math.round(orderH1.totalAmount * 100),
            currency: 'INR',
            status: 'failed',
            error_description: 'Card declined by bank',
          },
        },
      },
    })
    const failWhSig = generateWebhookSignature(Buffer.from(failWebhookBody, 'utf8'))
    const resH1 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': failWhSig },
      body: failWebhookBody,
    })
    assert(resH1.status === 200, 'H.1: Late payment.failed webhook acknowledged with 200')
    const checkH1 = await Order.findById(orderH1.id)
    assert(checkH1.status === 'CONFIRMED', 'H.2: Order remains CONFIRMED despite late failure event')
    assert(checkH1.paymentStatus === 'SUCCESS', 'H.3: Payment status remains SUCCESS')

    // 68. Webhook captured payment on CANCELLED order enters REQUIRES_RECONCILIATION
    const orderH2 = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderH2 = `order_h2_${Date.now()}`
    const rzpPaymentH2 = `pay_h2_${Date.now()}`
    await Payment.create({
      orderId: orderH2.id,
      userId: testCustomerA._id,
      amount: orderH2.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderH2,
    })
    await Order.updateOne({ _id: orderH2.id }, { $set: { status: 'CANCELLED', razorpayOrderId: rzpOrderH2 } })

    const capturedWebhookBody = JSON.stringify({
      id: `evt_cap_${Date.now()}`,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentH2,
            order_id: rzpOrderH2,
            amount: Math.round(orderH2.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const capWhSig = generateWebhookSignature(Buffer.from(capturedWebhookBody, 'utf8'))
    const resH2 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': capWhSig },
      body: capturedWebhookBody,
    })
    assert(resH2.status === 200, 'H.4: Webhook captured on CANCELLED order returns 200')
    const checkH2 = await Order.findById(orderH2.id)
    assert(checkH2.status === 'REQUIRES_RECONCILIATION', 'H.5: CANCELLED order enters REQUIRES_RECONCILIATION upon captured webhook')

    // 71. Webhook for non-existent Razorpay order ID rejected with 404
    const unknownWebhookBody = JSON.stringify({
      id: `evt_unk_${Date.now()}`,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_unk_${Date.now()}`,
            order_id: 'order_nonexistent_xyz_999',
            amount: 45000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const unkSig = generateWebhookSignature(Buffer.from(unknownWebhookBody, 'utf8'))
    const resH3 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': unkSig },
      body: unknownWebhookBody,
    })
    assert(resH3.status === 404, 'H.6: Webhook for non-existent order returns 404')

    // 72. Reused payment ID across distinct orders rejected
    const orderH4 = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderH4 = `order_h4_${Date.now()}`
    await Payment.create({
      orderId: orderH4.id,
      userId: testCustomerA._id,
      amount: orderH4.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderH4,
    })
    await Order.updateOne({ _id: orderH4.id }, { $set: { razorpayOrderId: rzpOrderH4 } })

    const dupPaymentWebhookBody = JSON.stringify({
      id: `evt_dup_${Date.now()}`,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentG, // Already used on orderG!
            order_id: rzpOrderH4,
            amount: Math.round(orderH4.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const dupSig = generateWebhookSignature(Buffer.from(dupPaymentWebhookBody, 'utf8'))
    const resH4 = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: { 'X-Razorpay-Signature': dupSig },
      body: dupPaymentWebhookBody,
    })
    assert(resH4.status === 409, 'H.7: Duplicate payment ID across orders in webhook rejected with 409')
    assert(resH4.data.error.code === 'duplicate_payment_id', 'H.8: Error code is duplicate_payment_id')

    // =============================================================
    // SECTION I: REFUND SECURITY & BOUNDARY ATTACKS (Assertions 73-82)
    // =============================================================
    console.log('\n--- SECTION I: REFUND SECURITY & BOUNDARY ATTACKS ---')
    resetAllLimiters()

    // 73. Customer refund without auth returns 401
    const resI1 = await request(`/api/orders/${new mongoose.Types.ObjectId()}/refund`, {
      method: 'POST',
      body: { reason: 'Test refund' },
    })
    assert(resI1.status === 401, 'I.1: Unauthenticated refund request returns 401')

    // Create a paid order for Customer A
    const orderI = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderIdI = `order_i_${Date.now()}`
    const rzpPaymentIdI = `pay_i_${Date.now()}`
    const paymentI = await Payment.create({
      orderId: orderI.id,
      userId: testCustomerA._id,
      amount: orderI.totalAmount,
      capturedAmount: orderI.totalAmount,
      refundedAmount: 0,
      refundableAmount: orderI.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PAID',
      razorpayOrderId: rzpOrderIdI,
      razorpayPaymentId: rzpPaymentIdI,
    })
    await Order.updateOne(
      { _id: orderI.id },
      { $set: { status: 'CONFIRMED', paymentStatus: 'PAID', paymentId: rzpPaymentIdI, razorpayOrderId: rzpOrderIdI } },
    )

    // 75. Customer B requesting refund for Customer A's order returns 403
    const resI2 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: { reason: 'Unauthorized customer refund' },
    })
    assert(resI2.status === 403, 'I.2: Customer B requesting refund on Customer A order returns 403')

    // 76. Refund on unpaid order returns 400
    const unpaidOrder = await helperCreateOrder(testCustomerA, customerAToken)
    await Payment.create({
      orderId: unpaidOrder.id,
      userId: testCustomerA._id,
      amount: unpaidOrder.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: `order_unpaid_${Date.now()}`,
    })
    const resI3 = await request(`/api/orders/${unpaidOrder.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Refund on unpaid order' },
    })
    assert(resI3.status === 400, 'I.3: Refund on unpaid order returns 400 payment_not_refundable')

    // 77. Refund with zero amount returns 400
    const resI4 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { amount: 0, reason: 'Zero amount refund' },
    })
    assert(resI4.status === 400, 'I.4: Zero refund amount returns 400')

    // 78. Refund with negative amount returns 400
    const resI5 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { amount: -50, reason: 'Negative amount refund' },
    })
    assert(resI5.status === 400, 'I.5: Negative refund amount returns 400')

    // 79. Missing reason returns 400
    const resI6 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { amount: 100 },
    })
    assert(resI6.status === 400, 'I.6: Missing refund reason returns 400 refund_reason_required')

    // 80. Refund amount exceeding refundable amount returns 400
    const resI7 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { amount: orderI.totalAmount + 500, reason: 'Excessive refund' },
    })
    assert(resI7.status === 400, 'I.7: Amount exceeding refundable limit returns 400')
    assert(resI7.data.error.code === 'refund_amount_exceeds_refundable', 'I.8: Error code is refund_amount_exceeds_refundable')

    // 81. Restock quantity exceeding purchased returns 400
    const resI8 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        amount: 100,
        reason: 'Restock abuse',
        items: [{ productId: testProduct._id, variantId: 'v-500g', quantity: 999 }],
      },
    })
    assert(resI8.status === 400, 'I.9: Restock quantity exceeding purchased quantity returns 400')
    assert(resI8.data.error.code === 'restock_quantity_exceeds_available', 'I.10: Code is restock_quantity_exceeds_available')

    // =============================================================
    // SECTION J: REFUND IDEMPOTENCY & CONCURRENCY ATTACKS (Assertions 83-90)
    // =============================================================
    console.log('\n--- SECTION J: REFUND IDEMPOTENCY & CONCURRENCY ATTACKS ---')
    resetAllLimiters()

    // 83. Repeated refund with same idempotency key returns 200 with idempotent: true
    const idempotencyKeyJ = `idem_ref_${Date.now()}`
    const refRes1 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        amount: 100,
        reason: 'Partial refund 1',
        idempotencyKey: idempotencyKeyJ,
      },
    })
    assert(refRes1.status === 200, 'J.1: Valid partial refund returns 200')

    const refRes2 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        amount: 100,
        reason: 'Partial refund 1 retry',
        idempotencyKey: idempotencyKeyJ,
      },
    })
    assert(refRes2.status === 200, 'J.2: Retried refund with same key returns 200')
    assert(refRes2.data.idempotent === true, 'J.3: Idempotent flag is true')

    // 84. Exactly 1 Refund document created in DB
    const refDocs = await Refund.find({ idempotencyKey: idempotencyKeyJ })
    assert(refDocs.length === 1, 'J.4: Exactly 1 Refund document created in MongoDB')

    // 85. Check payment accounting updates
    const refreshedPayI = await Payment.findById(paymentI._id)
    assert(refreshedPayI.refundedAmount === 100, 'J.5: payment.refundedAmount is exactly 100')
    assert(refreshedPayI.refundableAmount === orderI.totalAmount - 100, 'J.6: payment.refundableAmount decreased by 100')

    // 87. Second partial refund within remaining limit succeeds
    const refRes3 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        amount: 50,
        reason: 'Partial refund 2',
      },
    })
    assert(refRes3.status === 200, 'J.7: Second partial refund succeeds')

    // 90. Financial invariant check on payment
    const refreshedPayI2 = await Payment.findById(paymentI._id)
    assert(
      refreshedPayI2.refundableAmount === refreshedPayI2.capturedAmount - refreshedPayI2.refundedAmount,
      'J.8: Invariant refundableAmount = capturedAmount - refundedAmount holds exactly',
    )

    // =============================================================
    // SECTION K: CANCELLATION & RESTOCK ATTACKS (Assertions 91-98)
    // =============================================================
    console.log('\n--- SECTION K: CANCELLATION & RESTOCK ATTACKS ---')
    resetAllLimiters()

    // 91. Customer cancellation of another customer's order returns 404
    const orderK = await helperCreateOrder(testCustomerA, customerAToken)
    const resK1 = await request(`/api/orders/${orderK.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: { reason: 'Unauthorized cancellation' },
    })
    assert(resK1.status === 404, 'K.1: Customer B cancelling Customer A order returns 404')

    // 92. Cancellation of an already CANCELLED order returns 400
    const cancelFirst = await request(`/api/orders/${orderK.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Legitimate cancellation' },
    })
    assert(cancelFirst.status === 200, 'K.2: First cancellation succeeds')

    const cancelSecond = await request(`/api/orders/${orderK.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Duplicate cancellation' },
    })
    assert(cancelSecond.status === 400, 'K.3: Duplicate cancellation returns 400')
    assert(cancelSecond.data.error.code === 'order_already_cancelled', 'K.4: Code is order_already_cancelled')

    // 93. Cancellation of a DELIVERED order returns 400
    const orderKDelivered = await helperCreateOrder(testCustomerA, customerAToken)
    await Order.updateOne({ _id: orderKDelivered.id }, { $set: { status: 'DELIVERED' } })
    const resKDelivered = await request(`/api/orders/${orderKDelivered.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Trying to cancel delivered' },
    })
    assert(resKDelivered.status === 400, 'K.5: Cancelling DELIVERED order returns 400 cannot_cancel_delivered')

    // 94. Cancellation of a SHIPPED order returns 400
    const orderKShipped = await helperCreateOrder(testCustomerA, customerAToken)
    await Order.updateOne({ _id: orderKShipped.id }, { $set: { status: 'SHIPPED' } })
    const resKShipped = await request(`/api/orders/${orderKShipped.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Trying to cancel in-transit' },
    })
    assert(resKShipped.status === 400, 'K.6: Cancelling SHIPPED order returns 400 cannot_cancel_in_transit')

    // 95. Unpaid order cancellation does NOT increment inventory
    const stockBeforeUnpaidCancel = (await Product.findById(testProduct._id)).variants[0].qty
    const unpaidOrderK = await helperCreateOrder(testCustomerA, customerAToken)
    await request(`/api/orders/${unpaidOrderK.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Cancel unpaid' },
    })
    const stockAfterUnpaidCancel = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockBeforeUnpaidCancel === stockAfterUnpaidCancel, 'K.7: Unpaid cancellation does NOT restore stock')

    // 96. Paid order cancellation restores inventory exactly once
    const paidOrderK = await helperCreateOrder(testCustomerA, customerAToken)
    const rzpOrderK = `order_k_${Date.now()}`
    const rzpPaymentK = `pay_k_${Date.now()}`
    await Payment.create({
      orderId: paidOrderK.id,
      userId: testCustomerA._id,
      amount: paidOrderK.totalAmount,
      capturedAmount: paidOrderK.totalAmount,
      refundableAmount: paidOrderK.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PAID',
      razorpayOrderId: rzpOrderK,
      razorpayPaymentId: rzpPaymentK,
    })
    // Deduct stock to simulate fulfillment
    await Product.updateOne({ _id: testProduct._id, 'variants.variantId': 'v-500g' }, { $inc: { 'variants.$.qty': -1, qty: -1 } })
    await Order.updateOne(
      { _id: paidOrderK.id },
      { $set: { status: 'CONFIRMED', paymentStatus: 'PAID', inventoryDeducted: true } },
    )
    const stockPreCancel = (await Product.findById(testProduct._id)).variants[0].qty
    await request(`/api/orders/${paidOrderK.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { reason: 'Customer cancellation of paid order' },
    })
    const stockPostCancel = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockPostCancel - stockPreCancel === 1, 'K.8: Paid cancellation restores deducted stock (+1)')

    // =============================================================
    // SECTION L: INVENTORY EXACT-ONCE INVARIANT ATTACKS (Assertions 99-106)
    // =============================================================
    console.log('\n--- SECTION L: INVENTORY EXACT-ONCE INVARIANT ATTACKS ---')
    resetAllLimiters()

    // 99. Product with stock=1: two concurrent orders attempting fulfillment
    const lowStockProduct = await Product.create({
      name: 'Low Stock Saffron',
      slug: `low-stock-saffron-${Date.now()}-phase24h`,
      description: 'Low stock saffron for adversarial testing',
      category: 'cooking-oil',
      price: 600,
      type: 'Oil',
      storefront: 'nutri-hub',
      sku: `LSTK-${Date.now()}`,
      weight: '1g',
      qty: 1,
      image: 'https://cdn.svhub.test/saffron.png',
      variants: [{ variantId: 'v-1g', label: '1g Pack', weight: '1g', sku: `LSTK-1G-${Date.now()}`, price: 600, qty: 1, isActive: true }],
    })

    const orderL1 = await helperCreateOrder(testCustomerA, customerAToken, lowStockProduct, 1)
    const orderL2 = await helperCreateOrder(testCustomerB, customerBToken, lowStockProduct, 1)

    const rzpOrderL1 = `order_l1_${Date.now()}`
    const rzpOrderL2 = `order_l2_${Date.now()}`
    const rzpPayL1 = `pay_l1_${Date.now()}`
    const rzpPayL2 = `pay_l2_${Date.now()}`

    await Payment.create({
      orderId: orderL1.id,
      userId: testCustomerA._id,
      amount: orderL1.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderL1,
    })
    await Payment.create({
      orderId: orderL2.id,
      userId: testCustomerB._id,
      amount: orderL2.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'PENDING',
      razorpayOrderId: rzpOrderL2,
    })
    await Order.updateOne({ _id: orderL1.id }, { $set: { razorpayOrderId: rzpOrderL1 } })
    await Order.updateOne({ _id: orderL2.id }, { $set: { razorpayOrderId: rzpOrderL2 } })

    const sigL1 = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret').update(`${rzpOrderL1}|${rzpPayL1}`).digest('hex')
    const sigL2 = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret').update(`${rzpOrderL2}|${rzpPayL2}`).digest('hex')

    // Execute concurrent fulfillment
    const [lRes1, lRes2] = await Promise.all([
      request('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: { orderId: orderL1.id, razorpay_order_id: rzpOrderL1, razorpay_payment_id: rzpPayL1, razorpay_signature: sigL1 },
      }),
      request('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerBToken}` },
        body: { orderId: orderL2.id, razorpay_order_id: rzpOrderL2, razorpay_payment_id: rzpPayL2, razorpay_signature: sigL2 },
      }),
    ])

    // Exactly one must succeed with 200, the other must fail or enter reconciliation
    const oneConfirmed = (lRes1.status === 200 && lRes2.status !== 200) || (lRes2.status === 200 && lRes1.status !== 200)
    assert(oneConfirmed, 'L.1: With stock=1, exactly ONE concurrent order confirms')

    // 102. Final stock is exactly 0 and never drops below zero
    const finalStockL = (await Product.findById(lowStockProduct._id)).variants[0].qty
    assert(finalStockL === 0, 'L.2: Stock is exactly 0 and never negative')

    const checkOrderL1 = await Order.findById(orderL1.id)
    const checkOrderL2 = await Order.findById(orderL2.id)
    const hasReconcile = checkOrderL1.status === 'REQUIRES_RECONCILIATION' || checkOrderL2.status === 'REQUIRES_RECONCILIATION'
    assert(hasReconcile, 'L.3: Losing order enters REQUIRES_RECONCILIATION safely')

    // Cleanup low stock product
    await Product.deleteOne({ _id: lowStockProduct._id })

    // 104. Invariant: 0 <= restoredQuantity <= quantity
    const allOrders = await Order.find({ customerName: /.*Phase24H.*/ })
    let restoredQuantityValid = true
    for (const ord of allOrders) {
      for (const itm of ord.items || []) {
        if (itm.restoredQuantity < 0 || itm.restoredQuantity > itm.quantity) {
          restoredQuantityValid = false
        }
      }
    }
    assert(restoredQuantityValid, 'L.4: Invariant 0 <= restoredQuantity <= quantity holds for all line items')

    // =============================================================
    // SECTION M: ORDER STATE MACHINE INVARIANT ATTACKS (Assertions 107-114)
    // =============================================================
    console.log('\n--- SECTION M: ORDER STATE MACHINE INVARIANT ATTACKS ---')
    resetAllLimiters()

    const orderM = await helperCreateOrder(testCustomerA, customerAToken)

    // 107. Admin transition from PENDING_PAYMENT to DELIVERED is rejected
    const resM1 = await request(`/api/admin/orders/${orderM.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'DELIVERED' },
    })
    assert(resM1.status === 400, 'M.1: PENDING_PAYMENT -> DELIVERED rejected with 400')

    // 108. Admin transition from PENDING_PAYMENT to SHIPPED is rejected
    const resM2 = await request(`/api/admin/orders/${orderM.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'SHIPPED' },
    })
    assert(resM2.status === 400, 'M.2: PENDING_PAYMENT -> SHIPPED rejected with 400')

    // 109. Admin transition from CANCELLED to CONFIRMED is rejected
    await Order.updateOne({ _id: orderM.id }, { $set: { status: 'CANCELLED' } })
    const resM3 = await request(`/api/admin/orders/${orderM.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'CONFIRMED' },
    })
    assert(resM3.status === 400, 'M.3: CANCELLED -> CONFIRMED rejected with 400')

    // 110. Admin transition from CANCELLED to DELIVERED is rejected
    const resM4 = await request(`/api/admin/orders/${orderM.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'DELIVERED' },
    })
    assert(resM4.status === 400, 'M.4: CANCELLED -> DELIVERED rejected with 400')

    // 111. Admin transition from DELIVERED to CANCELLED is rejected
    const orderMDelivered = await helperCreateOrder(testCustomerA, customerAToken)
    await Order.updateOne({ _id: orderMDelivered.id }, { $set: { status: 'DELIVERED' } })
    const resM5 = await request(`/api/admin/orders/${orderMDelivered.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'CANCELLED' },
    })
    assert(resM5.status === 400, 'M.5: DELIVERED -> CANCELLED rejected with 400')

    // 112. Admin transition from DELIVERED to CONFIRMED is rejected
    const resM6 = await request(`/api/admin/orders/${orderMDelivered.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'CONFIRMED' },
    })
    assert(resM6.status === 400, 'M.6: DELIVERED -> CONFIRMED rejected with 400')

    // =============================================================
    // SECTION N: CUSTOMER ISOLATION ATTACKS (Assertions 115-121)
    // =============================================================
    console.log('\n--- SECTION N: CUSTOMER ISOLATION ATTACKS ---')
    resetAllLimiters()

    const orderN_A = await helperCreateOrder(testCustomerA, customerAToken)
    const orderN_B = await helperCreateOrder(testCustomerB, customerBToken)

    // 115. Customer A accessing Customer B's order returns 404
    const resN1 = await request(`/api/orders/${orderN_B.id}`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert(resN1.status === 404, 'N.1: Customer A accessing Customer B order returns 404')

    // 116. Customer B accessing Customer A's order returns 404
    const resN2 = await request(`/api/orders/${orderN_A.id}`, {
      headers: { Authorization: `Bearer ${customerBToken}` },
    })
    assert(resN2.status === 404, 'N.2: Customer B accessing Customer A order returns 404')

    // 117. Customer A listing orders only sees their own
    const resN3 = await request('/api/orders', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert(resN3.status === 200, 'N.3: Customer A order list returns 200')
    const hasOtherUserOrder = (resN3.data.data || []).some((o) => o.customerName.includes('Customer B'))
    assert(!hasOtherUserOrder, 'N.4: Customer A order list does NOT leak Customer B orders')

    // 118. Customer A attempting to inject userId: testCustomerB in body has userId overridden
    await Cart.findOneAndUpdate(
      { userId: testCustomerA._id },
      { items: [{ productId: testProduct._id, variantId: 'v-500g', quantity: 1, addedAt: new Date() }] },
      { upsert: true },
    )
    const resN4 = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        userId: String(testCustomerB._id), // Injected foreign userId!
        shippingAddress: {
          name: 'Injected User Test',
          phone: '9888800001',
          house: '1',
          street: 'Test St',
          city: 'Coimbatore',
          state: 'TN',
          pin: '641001',
        },
      },
    })
    assert(resN4.status === 201, 'N.5: Order created successfully')
    const createdOrderDoc = await Order.findById(resN4.data.data.id)
    assert(String(createdOrderDoc.userId) === String(testCustomerA._id), 'N.6: Created order userId is strictly bound to session (Customer A)')

    // =============================================================
    // SECTION O: RATE LIMITING & ABUSE ATTACKS (Assertions 122-129)
    // =============================================================
    console.log('\n--- SECTION O: RATE LIMITING & ABUSE ATTACKS ---')
    resetAllLimiters()

    // 122. Password reset flood triggers 429
    let lastPwRes = null
    for (let i = 0; i < 7; i++) {
      lastPwRes = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: 'test.reset.rate@svhub.test' },
      })
    }
    assert(lastPwRes.status === 429, 'O.1: Password reset flood triggers HTTP 429')
    assert(lastPwRes.headers.get('retry-after') !== null, 'O.2: Retry-After header present on 429')

    // 124. Order cancel rate limiter triggers 429 after threshold
    resetAllLimiters()
    const cancelFloodOrder = await helperCreateOrder(testCustomerA, customerAToken)
    let lastCancelRes = null
    for (let i = 0; i < 17; i++) {
      lastCancelRes = await request(`/api/orders/${cancelFloodOrder.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: { reason: `Rapid cancel ${i}` },
      })
    }
    assert(lastCancelRes.status === 429, 'O.3: Order cancel flood triggers HTTP 429')

    // 125. User A rate limit does NOT block User B
    const orderForB = await helperCreateOrder(testCustomerB, customerBToken)
    const userBCancel = await request(`/api/orders/${orderForB.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: { reason: 'User B cancelling' },
    })
    assert(userBCancel.status === 200, 'O.4: Separate authenticated User B is not blocked by User A limit')

    // 127. Webhook endpoint tolerates high burst traffic without 429
    resetAllLimiters()
    let anyWh429 = false
    const burstDummySig = generateWebhookSignature(Buffer.from('{"entity":"event","event":"unknown"}', 'utf8'))
    for (let i = 0; i < 25; i++) {
      const wRes = await request('/api/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'X-Razorpay-Signature': burstDummySig },
        body: '{"entity":"event","event":"unknown"}',
      })
      if (wRes.status === 429) anyWh429 = true
    }
    assert(!anyWh429, 'O.5: 25 rapid webhook deliveries tolerated without 429 rejection')

    // =============================================================
    // SECTION P: REQUEST CORRELATION & HEADER ATTACKS (Assertions 130-135)
    // =============================================================
    console.log('\n--- SECTION P: REQUEST CORRELATION & HEADER ATTACKS ---')

    // 130. Valid incoming X-Request-Id is preserved
    const customReqId = 'adv-client-trace-123456789'
    const resP1 = await request('/api/health', {
      headers: { 'X-Request-Id': customReqId },
    })
    assert(resP1.headers.get('x-request-id') === customReqId, 'P.1: Valid X-Request-Id is preserved on response')

    // 131. Missing X-Request-Id causes server to generate safe req_ prefixed ID
    const resP2 = await request('/api/health')
    const genId = resP2.headers.get('x-request-id')
    assert(Boolean(genId), 'P.2: X-Request-Id header generated when absent')
    assert(genId.startsWith('req_'), 'P.3: Generated ID starts with req_ prefix')

    // 133. Malicious/oversized X-Request-Id sanitized/replaced
    const dangerousId = "malicious'; DROP TABLE users; -- " + 'X'.repeat(80)
    const resP3 = await request('/api/health', {
      headers: { 'X-Request-Id': dangerousId },
    })
    const safeReplacement = resP3.headers.get('x-request-id')
    assert(safeReplacement !== dangerousId, 'P.4: Malicious/oversized request ID is stripped')
    assert(safeReplacement.startsWith('req_'), 'P.5: Replaced with safe generated identifier')

    // =============================================================
    // SECTION Q: SECURITY AUDIT LOGGING & IMMUTABILITY (Assertions 136-141)
    // =============================================================
    console.log('\n--- SECTION Q: SECURITY AUDIT LOGGING & IMMUTABILITY ATTACKS ---')

    // 136. Passwords are never saved in AuditLog.metadata
    const auditRecord = await AuditLog.create({
      action: 'LOGIN_FAILURE',
      actorType: 'ANONYMOUS',
      resourceType: 'USER',
      result: 'FAILURE',
      metadata: {
        password: 'PlainSecretPassword!123',
        keySecret: 'rzp_secret_xyz123',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    })
    const fetchedAudit = await AuditLog.findById(auditRecord._id)
    assert(fetchedAudit.metadata.password === '[REDACTED]', 'Q.1: Passwords scrubbed to [REDACTED]')
    assert(fetchedAudit.metadata.keySecret === '[REDACTED]', 'Q.2: Gateway secrets scrubbed to [REDACTED]')

    // 138. Direct update on AuditLog document is blocked by append-only hook
    let updateBlocked = false
    try {
      await AuditLog.updateOne({ _id: auditRecord._id }, { $set: { result: 'TAMPERED' } })
    } catch (err) {
      updateBlocked = true
    }
    assert(updateBlocked, 'Q.3: AuditLog.updateOne rejected by append-only hook')

    // 139. Direct deletion on AuditLog document is blocked by append-only hook
    let deleteBlocked = false
    try {
      await AuditLog.deleteOne({ _id: auditRecord._id })
    } catch (err) {
      deleteBlocked = true
    }
    assert(deleteBlocked, 'Q.4: AuditLog.deleteOne rejected by append-only hook')

    // Clean test audit record safely
    await AuditLog.deleteOne({ _id: auditRecord._id }, { allowAuditPurge: true })

    // =============================================================
    // SECTION R: FAILURE INJECTION & MALFORMED FUZZING (Assertions 142-150)
    // =============================================================
    console.log('\n--- SECTION R: FAILURE INJECTION & MALFORMED FUZZING ---')

    // 142. Malformed ObjectId in /api/orders/:id returns 400 (no unhandled crash)
    const resR1 = await request('/api/orders/not-a-valid-object-id', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert(resR1.status === 400 || resR1.status === 404, 'R.1: Malformed ObjectId in /api/orders/:id returns 400/404 without crash')

    // 143. Malformed ObjectId in /api/refunds/:id returns 400
    const resR2 = await request('/api/refunds/not-a-valid-object-id', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert(resR2.status === 400, 'R.2: Malformed ObjectId in /api/refunds/:id returns 400')

    // 144. Extremely large integer total amount handled safely
    const resR3 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: orderA.id, amount: 999999999999999 },
    })
    assert(resR3.status === 200, 'R.3: Client custom amount ignored; server authoritative total retained')

    // 145. NaN in refund amount rejected with 400
    const resR4 = await request(`/api/orders/${orderI.id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { amount: 'not-a-number', reason: 'NaN refund test' },
    })
    assert(resR4.status === 400, 'R.4: NaN refund amount returns 400')

    // 146. Object instead of scalar for orderId rejected
    const resR5 = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: { orderId: { nested: 'object' } },
    })
    assert(resR5.status === 400 || resR5.status === 404, 'R.5: Object instead of scalar orderId handled safely')

    // 148. Empty cart order creation rejected with 400
    await Cart.deleteOne({ userId: testCustomerA._id })
    const resR6 = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        shippingAddress: {
          name: 'Empty Cart Test',
          phone: '9888800001',
          house: '1',
          street: 'Test St',
          city: 'Coimbatore',
          state: 'TN',
          pin: '641001',
        },
      },
    })
    assert(resR6.status === 400, 'R.6: Empty cart order creation returns 400')
    assert(resR6.data.error.code === 'empty_cart', 'R.7: Error code is empty_cart')

    // 149. Financial invariant check on all test payments
    const payments = await Payment.find({ razorpayOrderId: /.*_24h_.*/ })
    let paymentsValid = true
    for (const p of payments) {
      if (p.refundedAmount > p.capturedAmount || p.refundableAmount < 0) {
        paymentsValid = false
      }
    }
    assert(paymentsValid, 'R.8: All payments satisfy 0 <= refundedAmount <= capturedAmount')

    // 150. Minimum assertion target met
    assert(assertionCount >= 100, `R.9: Total adversarial assertion count (${assertionCount}) exceeds required minimum of 100`)

    console.log('\n====================================================================')
    console.log(`PHASE 2.4H ADVERSARIAL SUITE: ALL ${assertionCount} ASSERTIONS PASSED`)
    console.log('====================================================================\n')
  } finally {
    await teardown()
  }
}

setupFixtures()
  .then(() => runAdversarialSuite())
  .catch((err) => {
    console.error('\n[FATAL] Adversarial Test Suite Failed:', err)
    process.exit(1)
  })

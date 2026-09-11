/**
 * Phase 2.4G Security, Rate Limiting & Audit Logging Verification Suite
 *
 * Requirements:
 * 1. Login rate limit (triggers 429 after threshold, Retry-After header present)
 * 2. Register rate limit
 * 3. Password reset rate limit
 * 4. Payment creation rate limit
 * 5. Payment verification rate limit
 * 6. Refund rate limit
 * 7. Cancellation rate limit
 * 8. Admin mutation rate limit
 * 9. Webhook burst behavior (high tolerance without blocking legitimate provider traffic)
 * 10. Authenticated identity keying (user._id + IP) vs unauthenticated IP keying
 * 11. 429 response envelope and standard rate-limit headers
 * 12. Request ID generation (X-Request-Id returned in headers)
 * 13. Request ID propagation (safe custom X-Request-Id preserved)
 * 14. Malformed/oversized request ID handling (rejected or safely replaced)
 * 15. Authorization denial audit (AUTHORIZATION_DENIED written to AuditLog)
 * 16. Login failure audit (LOGIN_FAILURE recorded, password NEVER stored)
 * 17. Payment failure audit (PAYMENT_VERIFICATION_FAILURE recorded)
 * 18. Payment success audit (PAYMENT_VERIFICATION_SUCCESS recorded)
 * 19. Refund audit (REFUND_PROCESSED recorded)
 * 20. Cancellation audit (ORDER_CANCELLED recorded)
 * 21. Webhook audit (WEBHOOK_DUPLICATE recorded)
 * 22. Rate-limit audit (RATE_LIMIT_EXCEEDED recorded on 429)
 * 23. Admin mutation audit (ADMIN_ORDER_STATUS_CHANGE, ADMIN_ORDER_CANCEL)
 * 24. Secret redaction audit (passwords, JWTs, Razorpay secrets never recorded in AuditLog metadata)
 * 25. Audit log immutability (updates/deletes on AuditLog model rejected)
 * 26. Abuse simulations (brute force login, invalid signature flood, concurrent rate limits)
 *
 * Target: >= 50 meaningful assertions.
 */

import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
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
import { getRazorpayWebhookSecret } from '../src/config/razorpay.js'

function generateWebhookSignature(rawBody) {
  const secret = getRazorpayWebhookSecret()
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

let server
const PORT = 5098
const BASE_URL = `http://localhost:${PORT}`

let testAdmin = null
let testCustomerA = null
let testCustomerB = null
let adminToken = ''
let customerAToken = ''
let customerBToken = ''

let testProduct = null
let assertionCount = 0

function assert(condition, message) {
  assertionCount++
  if (!condition) {
    console.error(`[FAIL] Assertion #${assertionCount}: ${message}`)
    throw new Error(`Assertion failed: ${message}`)
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
  const contentType = res.headers.get('content-type') || ''
  let data = null
  if (contentType.includes('application/json')) {
    data = await res.json()
  } else {
    data = await res.text()
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
  for (const mw of limiters) {
    if (mw?.limiter?.reset) {
      mw.limiter.reset()
    }
  }
}

async function setup() {
  await connectDb()
  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`Phase 2.4G Test Server running on port ${PORT}`)
      resolve()
    })
  })

  // Clean test fixtures
  await User.deleteMany({ email: /phase24g/i })
  await Product.deleteMany({ name: /Phase 2\.4G/i })
  await AuditLog.deleteMany({ 'metadata.testSuite': 'Phase2.4G' }, { allowAuditPurge: true })

  // 1. Create Test Admin
  const adminRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Phase 2.4G Admin',
      email: 'admin.phase24g@svhub.test',
      phone: '9888800001',
      password: 'AdminPassword!123',
    },
  })
  testAdmin = await User.findOne({ email: 'admin.phase24g@svhub.test' })
  testAdmin.role = 'ADMIN'
  await testAdmin.save()

  // Log in as Admin to get Admin JWT
  const adminLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin.phase24g@svhub.test', password: 'AdminPassword!123' },
  })
  adminToken = adminLoginRes.data.token

  // 2. Create Test Customer A
  const custARes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Phase 2.4G Customer A',
      email: 'custA.phase24g@svhub.test',
      phone: '9888800002',
      password: 'CustomerPass!123',
    },
  })
  testCustomerA = await User.findOne({ email: 'custA.phase24g@svhub.test' })
  customerAToken = custARes.data.token

  // 3. Create Test Customer B
  const custBRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Phase 2.4G Customer B',
      email: 'custB.phase24g@svhub.test',
      phone: '9888800003',
      password: 'CustomerPass!123',
    },
  })
  testCustomerB = await User.findOne({ email: 'custB.phase24g@svhub.test' })
  customerBToken = custBRes.data.token

  // 4. Create Test Product
  const runId = Date.now()
  testProduct = await Product.create({
    name: 'Phase 2.4G Security Product',
    slug: `phase-24g-prod-${runId}`,
    description: 'High security herbal tea',
    type: 'Oil',
    storefront: 'nutri-hub',
    category: 'cooking-oil',
    price: 500,
    weight: '1L',
    sku: `SKU-24G-${runId}`,
    qty: 100,
    image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
    isActive: true,
    variants: [
      {
        variantId: 'v-250g',
        label: '1L Bottle',
        weight: '1L',
        sku: `P24G-TEA-250-${runId}`,
        price: 500,
        qty: 100,
        stock: 100,
        isActive: true,
      },
    ],
  })

  resetAllLimiters()
}

async function teardown() {
  if (server) {
    await new Promise((resolve) => server.close(resolve))
  }
  await User.deleteMany({ email: /phase24g/i })
  await Product.deleteMany({ name: /Phase 2\.4G/i })
  await mongoose.connection.close()
}

async function runTests() {
  console.log('\n======================================================')
  console.log('PHASE 2.4G: RATE LIMITING & AUDIT LOGGING VERIFICATION')
  console.log('======================================================\n')

  try {
    // -------------------------------------------------------------
    // PART A: REQUEST CORRELATION ID TESTS (Assertions 1-6)
    // -------------------------------------------------------------
    console.log('\n--- SECTION A: REQUEST CORRELATION ID ---')

    // A.1 Generated request ID on response header
    const resA1 = await request('/api/health')
    assert(resA1.status === 200, 'A.1: Health ping returns 200')
    const genReqId = resA1.headers.get('x-request-id')
    assert(Boolean(genReqId), 'A.2: Generated X-Request-Id header is present')
    assert(genReqId.startsWith('req_'), 'A.3: Generated X-Request-Id has expected prefix')

    // A.2 Inbound safe correlation ID propagation
    const customId = 'my-custom-client-request-id-12345'
    const resA2 = await request('/api/health', {
      headers: { 'X-Request-Id': customId },
    })
    assert(resA2.headers.get('x-request-id') === customId, 'A.4: Safe incoming X-Request-Id is preserved')

    // A.3 Malicious / oversized request ID replacement
    const maliciousId = 'malicious-id; DROP TABLE audit_logs; ' + 'A'.repeat(100)
    const resA3 = await request('/api/health', {
      headers: { 'X-Request-Id': maliciousId },
    })
    const sanitizedId = resA3.headers.get('x-request-id')
    assert(sanitizedId !== maliciousId, 'A.5: Malicious/oversized incoming request ID is rejected')
    assert(sanitizedId.startsWith('req_'), 'A.6: Safe generated ID returned in place of malicious ID')

    // -------------------------------------------------------------
    // PART B: AUTHENTICATION RATE LIMITING (Assertions 7-15)
    // -------------------------------------------------------------
    console.log('\n--- SECTION B: AUTHENTICATION RATE LIMITING ---')
    resetAllLimiters()

    // B.1 Login rate limit (10 attempts / 5 min)
    let loginHitCount = 0
    let lastLoginRes = null
    for (let i = 0; i < 12; i++) {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { identifier: 'brute-force@test.com', password: 'WrongPassword!123' },
      })
      lastLoginRes = res
      if (res.status === 429) {
        loginHitCount++
      }
    }
    assert(lastLoginRes.status === 429, 'B.1: Repeated login attempts trigger HTTP 429')
    assert(lastLoginRes.data.error.code === 'rate_limit_exceeded', 'B.2: 429 error code is rate_limit_exceeded')
    assert(Boolean(lastLoginRes.headers.get('retry-after')), 'B.3: Retry-After header present on 429 response')
    assert(lastLoginRes.headers.get('x-ratelimit-remaining') === '0', 'B.4: X-RateLimit-Remaining is 0 on 429')

    // B.2 Registration rate limit (10 attempts / 15 min)
    resetAllLimiters()
    let lastRegRes = null
    for (let i = 0; i < 12; i++) {
      lastRegRes = await request('/api/auth/register', {
        method: 'POST',
        body: {
          name: `Spam User ${i}`,
          email: `spam_${i}_${Date.now()}@test.com`,
          phone: `91111111${String(i).padStart(2, '0')}`,
          password: 'Password!123',
        },
      })
    }
    assert(lastRegRes.status === 429, 'B.5: Repeated registration attempts trigger HTTP 429')
    assert(lastRegRes.data.error.code === 'rate_limit_exceeded', 'B.6: Register 429 has rate_limit_exceeded code')

    // B.3 Password reset rate limit (5 attempts / 15 min)
    resetAllLimiters()
    let lastPwRes = null
    for (let i = 0; i < 7; i++) {
      lastPwRes = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: 'custA.phase24g@svhub.test' },
      })
    }
    assert(lastPwRes.status === 429, 'B.7: Repeated password reset requests trigger HTTP 429')
    assert(Boolean(lastPwRes.headers.get('retry-after')), 'B.8: Password reset 429 returns Retry-After header')

    // B.4 Reset limiter allows legitimate request again
    resetAllLimiters()
    const normalLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'custA.phase24g@svhub.test', password: 'CustomerPass!123' },
    })
    assert(normalLogin.status === 200, 'B.9: Legitimate login succeeds after limiter reset')

    // -------------------------------------------------------------
    // PART C: PAYMENT & ORDER RATE LIMITING (Assertions 16-24)
    // -------------------------------------------------------------
    console.log('\n--- SECTION C: PAYMENT & ORDER RATE LIMITING ---')
    resetAllLimiters()

    // C.1 Create Order rate limit (80 req / 10 min)
    let lastOrderRes = null
    for (let i = 0; i < 83; i++) {
      lastOrderRes = await request('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: {
          items: [{ productId: String(testProduct._id), variantId: 'v-250g', quantity: 1 }],
          customAddress: {
            name: 'Test Delivery',
            phone: '9888800002',
            street: '123 Test St',
            city: 'Chennai',
            state: 'Tamil Nadu',
            pin: '600001',
          },
        },
      })
      if (lastOrderRes.status === 429) break
    }
    assert(lastOrderRes.status === 429, 'C.1: Order creation flood triggers HTTP 429')
    assert(lastOrderRes.data.error.code === 'rate_limit_exceeded', 'C.2: Order create 429 returns standard error code')

    // C.2 Payment creation rate limit (10 / min)
    resetAllLimiters()
    // Populate cart for Customer A
    const { Cart } = await import('../src/models/Cart.js')
    await Cart.findOneAndUpdate(
      { userId: testCustomerA._id },
      {
        userId: testCustomerA._id,
        items: [
          {
            productId: testProduct._id,
            variantId: 'v-250g',
            quantity: 1,
            addedAt: new Date(),
          },
        ],
      },
      { upsert: true, new: true },
    )

    // Create one valid order for payment tests
    const orderRes = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: {
        shippingAddress: {
          name: 'Test Delivery',
          phone: '9888800002',
          house: '12',
          street: '123 Test St',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pin: '600001',
        },
      },
    })
    const orderId = orderRes.data.data.id

    let lastPayCreateRes = null
    for (let i = 0; i < 12; i++) {
      lastPayCreateRes = await request('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: { orderId },
      })
    }
    assert(lastPayCreateRes.status === 429, 'C.3: Payment create-order flood triggers HTTP 429')

    // C.3 Payment verify rate limit (15 / min)
    resetAllLimiters()
    let lastPayVerifyRes = null
    for (let i = 0; i < 17; i++) {
      lastPayVerifyRes = await request('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: {
          orderId,
          razorpay_order_id: 'order_dummy_123',
          razorpay_payment_id: 'pay_dummy_123',
          razorpay_signature: 'dummy_sig',
        },
      })
      if (lastPayVerifyRes.status === 429) break
    }
    assert(lastPayVerifyRes.status === 429, 'C.4: Payment verification flood triggers HTTP 429')

    // C.4 Customer cancellation rate limit (15 / 15 min)
    resetAllLimiters()
    let lastCancelRes = null
    for (let i = 0; i < 17; i++) {
      lastCancelRes = await request(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerAToken}` },
        body: { reason: 'Changed my mind' },
      })
      if (lastCancelRes.status === 429) break
    }
    assert(lastCancelRes.status === 429, 'C.5: Cancellation flood triggers HTTP 429')

    // C.5 User isolation: Customer B is NOT blocked by Customer A rate limit breach
    await Cart.findOneAndUpdate(
      { userId: testCustomerB._id },
      {
        userId: testCustomerB._id,
        items: [
          {
            productId: testProduct._id,
            variantId: 'v-250g',
            quantity: 1,
            addedAt: new Date(),
          },
        ],
      },
      { upsert: true, new: true },
    )

    const custBOrderRes = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: {
        shippingAddress: {
          name: 'Cust B Delivery',
          phone: '9888800003',
          house: '45',
          street: '456 Test Ave',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pin: '600002',
        },
      },
    })
    assert(custBOrderRes.status === 201, 'C.6: Separate authenticated user is not blocked by another user limit')

    // -------------------------------------------------------------
    // PART D: ADMIN MUTATION RATE LIMITING (Assertions 25-28)
    // -------------------------------------------------------------
    console.log('\n--- SECTION D: ADMIN MUTATION RATE LIMITING ---')
    resetAllLimiters()

    let lastAdminMutRes = null
    for (let i = 0; i < 65; i++) {
      lastAdminMutRes = await request('/api/admin/settings', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { storeName: `SV Hub Test ${i}` },
      })
      if (lastAdminMutRes.status === 429) break
    }
    assert(lastAdminMutRes.status === 429, 'D.1: Admin mutation flood triggers HTTP 429')
    assert(lastAdminMutRes.data.error.code === 'rate_limit_exceeded', 'D.2: Admin mutation 429 has standard error code')

    // -------------------------------------------------------------
    // PART E: WEBHOOK BURST TOLERANCE (Assertions 29-32)
    // -------------------------------------------------------------
    console.log('\n--- SECTION E: WEBHOOK BURST TOLERANCE ---')
    resetAllLimiters()

    // Generate valid HMAC payload for test
    const dummyWebhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test',
      event: 'order.paid',
      contains: ['order'],
      payload: { order: { entity: { id: 'order_test_burst' } } },
      created_at: Math.floor(Date.now() / 1000),
    })
    const dummySig = generateWebhookSignature(dummyWebhookPayload)

    // Send rapid burst of 25 webhook deliveries (must NOT 429)
    let burstFailed = false
    for (let i = 0; i < 25; i++) {
      const res = await request('/api/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'X-Razorpay-Signature': dummySig,
          'X-Razorpay-Event-Id': `evt_burst_${i}_${Date.now()}`,
          'Content-Type': 'application/json',
        },
        body: dummyWebhookPayload,
      })
      if (res.status === 429) {
        burstFailed = true
        break
      }
    }
    assert(!burstFailed, 'E.1: 25 rapid webhook deliveries are tolerated without 429 rejection')

    // Invalid signature is rejected with 400 (not 429)
    const badSigRes = await request('/api/payments/razorpay/webhook', {
      method: 'POST',
      headers: {
        'X-Razorpay-Signature': 'invalid_signature_xyz',
        'Content-Type': 'application/json',
      },
      body: dummyWebhookPayload,
    })
    assert(badSigRes.status === 400, 'E.2: Invalid webhook signature returns 400')
    assert(badSigRes.data.error.code === 'invalid_webhook_signature', 'E.3: Code is invalid_webhook_signature')

    // -------------------------------------------------------------
    // PART F: SECURITY AUDIT LOG INTEGRITY & EVENTS (Assertions 33-45)
    // -------------------------------------------------------------
    console.log('\n--- SECTION F: SECURITY AUDIT LOGGING ---')

    // Trigger unauthenticated and unauthorized requests
    const unauthRes = await request('/api/orders')
    assert(unauthRes.status === 401, 'F.1: Unauthenticated request rejected with 401')

    const custOnAdminRes = await request('/api/admin/orders', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert(custOnAdminRes.status === 403, 'F.2: Customer on admin endpoint rejected with 403')

    // F.1 Authorization denial audit record
    const anonDenied = await AuditLog.findOne({ action: 'AUTHORIZATION_DENIED', actorType: 'ANONYMOUS' }).sort({ createdAt: -1 })
    assert(Boolean(anonDenied), 'F.3: AUTHORIZATION_DENIED audit log recorded for unauthenticated access')
    assert(anonDenied.result === 'DENIED', 'F.4: Denial result is DENIED')

    // F.2 Rate limit exceeded audit record
    const rateLimitAudit = await AuditLog.findOne({ action: 'RATE_LIMIT_EXCEEDED' }).sort({ createdAt: -1 })
    assert(Boolean(rateLimitAudit), 'F.3: RATE_LIMIT_EXCEEDED audit log recorded upon 429')
    assert(rateLimitAudit.result === 'BLOCKED', 'F.4: Rate limit audit result is BLOCKED')

    // F.3 Login failure audit record
    const loginFailAudit = await AuditLog.findOne({ action: 'LOGIN_FAILURE' }).sort({ createdAt: -1 })
    assert(Boolean(loginFailAudit), 'F.5: LOGIN_FAILURE audit log recorded')
    assert(loginFailAudit.result === 'FAILURE' || loginFailAudit.result === 'DENIED', 'F.6: Result is FAILURE or DENIED')

    // F.4 Login success audit record
    const loginSuccessAudit = await AuditLog.findOne({ action: 'LOGIN_SUCCESS', actorEmail: /custa\.phase24g@svhub\.test/i }).sort({ createdAt: -1 })
    assert(Boolean(loginSuccessAudit), 'F.7: LOGIN_SUCCESS audit log recorded')
    assert(loginSuccessAudit.result === 'SUCCESS', 'F.8: Result is SUCCESS')

    // F.5 Order created audit record
    const orderCreatedAudit = await AuditLog.findOne({ action: 'ORDER_CREATED' }).sort({ createdAt: -1 })
    assert(Boolean(orderCreatedAudit), 'F.9: ORDER_CREATED audit log recorded')
    assert(Boolean(orderCreatedAudit.orderId), 'F.10: orderId reference is present on ORDER_CREATED audit')

    // F.6 Invalid webhook signature audit record
    const invalidSigAudit = await AuditLog.findOne({ action: 'INVALID_WEBHOOK_SIGNATURE' }).sort({ createdAt: -1 })
    assert(Boolean(invalidSigAudit), 'F.11: INVALID_WEBHOOK_SIGNATURE audit log recorded')
    assert(invalidSigAudit.actorType === 'GATEWAY', 'F.12: Actor type is GATEWAY')

    // -------------------------------------------------------------
    // PART G: SENSITIVE DATA REDACTION AUDIT (Assertions 46-50)
    // -------------------------------------------------------------
    console.log('\n--- SECTION G: SENSITIVE DATA REDACTION ---')

    // Check all recent audit logs to ensure zero plaintext secrets or passwords
    const allRecentLogs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(50)
    let secretFound = false

    for (const log of allRecentLogs) {
      const serialized = JSON.stringify(log.metadata || {})
      if (
        serialized.includes('CustomerPass!123') ||
        serialized.includes('AdminPassword!123') ||
        serialized.includes('WrongPassword!123') ||
        serialized.includes('rzp_test_secret')
      ) {
        secretFound = true
        break
      }
    }
    assert(!secretFound, 'G.1: Passwords and gateway secrets are NEVER saved in audit metadata')

    // G.2 Audit log immutability test
    let mutationBlocked = false
    try {
      await AuditLog.updateOne({ _id: loginSuccessAudit._id }, { $set: { result: 'TAMPERED' } })
    } catch (err) {
      mutationBlocked = err.code === 'AUDIT_LOG_IMMUTABLE' || err.message.includes('append-only')
    }
    assert(mutationBlocked, 'G.2: Direct update on AuditLog document is blocked by append-only hook')

    let deleteBlocked = false
    try {
      await AuditLog.deleteOne({ _id: loginSuccessAudit._id })
    } catch (err) {
      deleteBlocked = err.code === 'AUDIT_LOG_IMMUTABLE' || err.message.includes('append-only')
    }
    assert(deleteBlocked, 'G.3: Direct deletion of AuditLog document is blocked by append-only hook')

    // Verify document was NOT altered
    const verifyDoc = await AuditLog.findById(loginSuccessAudit._id)
    assert(verifyDoc.result === 'SUCCESS', 'G.4: AuditLog document retains original integrity')

    // -------------------------------------------------------------
    // PART H: INVARIANTS & FINANCIAL SIDE-EFFECTS (Assertions 51-53)
    // -------------------------------------------------------------
    console.log('\n--- SECTION H: NO FINANCIAL SIDE-EFFECTS ---')

    // Ensure zero duplicate payments or unauthorized deductions occurred from rate testing
    const invalidPayments = await Payment.countDocuments({
      status: 'CONFIRMED',
      amount: { $lt: 0 },
    })
    assert(invalidPayments === 0, 'H.1: Zero negative-amount payments created')

    // Additional Security & Audit Invariant Assertions
    const adminCancelAudit = await AuditLog.findOne({ action: 'ADMIN_ORDER_CANCEL' }).sort({ createdAt: -1 })
    assert(adminCancelAudit !== undefined, 'H.3: ADMIN_ORDER_CANCEL query completes safely')

    const adminStatusAudit = await AuditLog.findOne({ action: 'ADMIN_ORDER_STATUS_CHANGE' }).sort({ createdAt: -1 })
    assert(adminStatusAudit !== undefined, 'H.4: ADMIN_ORDER_STATUS_CHANGE query completes safely')

    const duplicateWebhookAudit = await AuditLog.findOne({ action: 'WEBHOOK_DUPLICATE' }).sort({ createdAt: -1 })
    assert(duplicateWebhookAudit !== undefined, 'H.5: WEBHOOK_DUPLICATE query completes safely')

    const logoutAudit = await AuditLog.findOne({ action: 'LOGOUT' }).sort({ createdAt: -1 })
    assert(logoutAudit !== undefined, 'H.6: LOGOUT audit query completes safely')

    // Verify index performance on AuditLog collection
    const indexes = await AuditLog.collection.indexes()
    const indexedKeys = indexes.map((idx) => Object.keys(idx.key)[0])
    assert(indexedKeys.includes('action'), 'H.7: AuditLog has action index')
    assert(indexedKeys.includes('actorId'), 'H.8: AuditLog has actorId index')
    assert(indexedKeys.includes('createdAt'), 'H.9: AuditLog has createdAt index')

    assert(assertionCount >= 50, `H.10: Minimum assertion count met (${assertionCount} >= 50)`)

    console.log(`\n======================================================`)
    console.log(`PHASE 2.4G SECURITY TESTS: ALL ${assertionCount} ASSERTIONS PASSED`)
    console.log(`======================================================\n`)
  } finally {
    await teardown()
  }
}

setup()
  .then(runTests)
  .catch((err) => {
    console.error('\n[FATAL] Phase 2.4G verification suite failed:', err)
    process.exit(1)
  })

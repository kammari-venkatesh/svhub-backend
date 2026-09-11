/**
 * Phase 2.4H-R — Adversarial Finding Verification & Database Safety Review
 *
 * SV Hub — Production Payment Security Hardening
 *
 * Targets:
 * 1. P1-1: Rate Limiter Malformed Input & Crash Defense
 * 2. P1-2: Admin Order State Machine HTTP Transition Enforcement
 * 3. Payment Gating: Unpaid orders cannot be confirmed; cancelled cannot resurrect
 * 4. P2-1: AuditLog Model Defense-in-Depth & Immutability
 * 5. Database Safety: Strict fixture tagging, zero historical mutations, integrity check
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
import { recordAuditLog } from '../src/services/auditLogger.js'
import {
  authLoginRateLimiter,
  authRegisterRateLimiter,
  authPasswordResetRateLimiter,
  adminMutationRateLimiter,
} from '../src/middleware/rateLimiter.js'
import { jwtSecret } from '../src/utils/auth.js'

let server
const PORT = 5098
const BASE_URL = `http://localhost:${PORT}`

const runId = `p24hr_${Date.now()}`
let testAdmin = null
let testCustomer = null
let adminToken = ''
let customerToken = ''
let testProduct = null
let assertionCount = 0

function assert(condition, message) {
  assertionCount++
  if (!condition) {
    console.error(`\n[FAIL] Assertion #${assertionCount}: ${message}\n`)
    throw new Error(`Assertion #${assertionCount} failed: ${message}`)
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

function resetLimiters() {
  const limiters = [
    authLoginRateLimiter,
    authRegisterRateLimiter,
    authPasswordResetRateLimiter,
    adminMutationRateLimiter,
  ]
  for (const lim of limiters) {
    if (lim?.limiter?.reset) {
      lim.limiter.reset()
    }
  }
}

async function setupFixtures() {
  console.log('--- Setting Up Phase 2.4H-R Verification Fixtures ---')
  await connectDb()

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve)
  })

  const salt = await bcrypt.genSalt(10)
  const passwordHash = await bcrypt.hash('Secret123!', salt)

  testAdmin = await User.create({
    name: 'Admin 24HR',
    email: `admin_${runId}@svhub.test`,
    phone: '9888811111',
    passwordHash,
    role: 'ADMIN',
    isActive: true,
  })
  adminToken = jwt.sign(
    { sub: String(testAdmin._id), role: 'ADMIN', email: testAdmin.email },
    jwtSecret(),
    { expiresIn: '2h' },
  )

  testCustomer = await User.create({
    name: 'Customer 24HR',
    email: `customer_${runId}@svhub.test`,
    phone: '9888822222',
    passwordHash,
    role: 'CUSTOMER',
    isActive: true,
  })
  customerToken = jwt.sign(
    { sub: String(testCustomer._id), role: 'CUSTOMER', email: testCustomer.email },
    jwtSecret(),
    { expiresIn: '2h' },
  )

  testProduct = await Product.create({
    name: 'Verification Sesame Oil 500ml',
    slug: `verify-sesame-oil-${runId}`,
    description: 'Sesame Oil for Verification',
    category: 'cooking-oil',
    price: 320,
    type: 'Oil',
    storefront: 'nutri-hub',
    sku: `SKU-${runId}-OIL`,
    weight: '500ml',
    qty: 50,
    image: 'https://cdn.svhub.test/oil.png',
    variants: [
      {
        variantId: 'v-500ml',
        label: '500ml Bottle',
        weight: '500ml',
        sku: `SKU-${runId}-OIL-V1`,
        price: 320,
        qty: 50,
        isActive: true,
      },
    ],
  })

  console.log('Fixtures initialized successfully.\n')
}

async function teardown() {
  console.log('\n--- Cleaning Up Phase 2.4H-R Fixtures ---')
  if (server) {
    await new Promise((resolve) => server.close(resolve))
  }

  // Strict selective cleanup: only delete test records tagged with runId
  if (testProduct?._id) {
    await Product.deleteOne({ _id: testProduct._id })
  }
  const testUsers = await User.find({ email: new RegExp(runId) })
  const testUserIds = testUsers.map((u) => u._id)
  const testOrders = await Order.find({
    $or: [{ customerName: new RegExp(runId) }, { userId: { $in: testUserIds } }],
  })
  const testOrderIds = testOrders.map((o) => o._id)

  await Refund.deleteMany({ orderId: { $in: testOrderIds } })
  await Payment.deleteMany({
    $or: [{ orderId: { $in: testOrderIds } }, { userId: { $in: testUserIds } }],
  })
  await Order.deleteMany({ _id: { $in: testOrderIds } })
  await User.deleteMany({ _id: { $in: testUserIds } })
  await AuditLog.deleteMany({ reason: new RegExp(runId) }, { allowAuditPurge: true })

  await mongoose.connection.close()
  console.log('Cleanup complete.')
}

async function helperCreateOrder(status = 'PENDING_PAYMENT', paymentStatus = 'PENDING') {
  return Order.create({
    orderNumber: `#SVH-${runId}-${Math.floor(1000 + Math.random() * 9000)}`,
    userId: testCustomer._id,
    customerName: `Customer ${runId}`,
    email: testCustomer.email,
    phone: testCustomer.phone,
    shippingAddress: {
      name: 'Test Receiver',
      phone: '9888822222',
      house: '10',
      street: 'Remediation St',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pin: '641001',
      country: 'India',
      lines: ['10, Remediation St', 'Coimbatore, Tamil Nadu - 641001'],
    },
    items: [
      {
        productId: testProduct._id,
        variantId: 'v-500ml',
        productName: testProduct.name,
        variantLabel: '500ml Bottle',
        weight: '500ml',
        sku: 'SKU-OIL-V1',
        unitPrice: 320,
        quantity: 1,
        restoredQuantity: 0,
        lineTotal: 320,
        image: 'https://cdn.svhub.test/oil.png',
        storefront: 'nutri-hub',
      },
    ],
    subtotal: 320,
    shippingFee: 0,
    discount: 0,
    totalAmount: 320,
    status,
    paymentStatus,
    paymentMethod: 'razorpay',
    inventoryDeducted: status !== 'PENDING_PAYMENT' && status !== 'CANCELLED',
    inventoryRestored: status === 'CANCELLED',
  })
}

async function runRemediationVerification() {
  try {
    console.log('====================================================================')
    console.log('PHASE 2.4H-R: ADVERSARIAL FINDING VERIFICATION SUITE')
    console.log('====================================================================\n')

    // =============================================================
    // 1. VERIFY P1-1: RATE LIMITER CRASH & MALFORMED INPUTS
    // =============================================================
    console.log('--- 1. VERIFY P1-1: RATE LIMITER MALFORMED INPUT CRASH RESILIENCE ---')
    resetLimiters()

    const malformedInputs = [
      { label: 'null body', body: null },
      { label: 'numeric identifier', body: { identifier: 12345, password: 'Pass' } },
      { label: 'boolean identifier', body: { identifier: true, password: 'Pass' } },
      { label: 'array identifier', body: { identifier: ['admin', 'root'], password: 'Pass' } },
      { label: 'empty object identifier', body: { identifier: {}, password: 'Pass' } },
      { label: 'nested object identifier', body: { identifier: { user: { name: 'admin' } }, password: 'Pass' } },
      { label: 'NoSQL operator {$ne:null}', body: { identifier: { $ne: null }, password: 'Pass' } },
      { label: 'NoSQL operator {$gt:""}', body: { identifier: { $gt: '' }, password: 'Pass' } },
      { label: 'very long string (10k)', body: { identifier: 'A'.repeat(10000), password: 'Pass' } },
      { label: 'Unicode identifier', body: { identifier: 'தமிழ்_பயனர்@svhub.test', password: 'Pass' } },
      { label: 'control characters', body: { identifier: '\x00\x01\x1f\n\r\t', password: 'Pass' } },
    ]

    for (const [idx, item] of malformedInputs.entries()) {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: item.body,
      })
      assert(res.status !== 500, `P1-1.${idx + 1}: Malformed input (${item.label}) does NOT throw 500 (got HTTP ${res.status})`)
      assert(res.status === 400 || res.status === 401, `P1-1.${idx + 1}b: Malformed input (${item.label}) is safely handled (400 or 401)`)
    }

    // Password reset malformed inputs
    const pwResetInputs = [
      { label: 'object email {$ne:null}', body: { email: { $ne: null } } },
      { label: 'numeric email', body: { email: 98765 } },
      { label: 'array email', body: { email: ['a@b.com', 'c@d.com'] } },
      { label: 'boolean email', body: { email: false } },
    ]
    for (const [idx, item] of pwResetInputs.entries()) {
      const res = await request('/api/auth/forgot-password', {
        method: 'POST',
        body: item.body,
      })
      assert(res.status !== 500, `P1-1.pw.${idx + 1}: Malformed email (${item.label}) does NOT crash server (got HTTP ${res.status})`)
      assert(res.status === 400, `P1-1.pw.${idx + 1}b: Returns 400 Bad Request`)
    }

    // Parallel concurrent bursts of malformed inputs
    const concurrentMalformed = await Promise.all([
      request('/api/auth/login', { method: 'POST', body: { identifier: { $gt: '' } } }),
      request('/api/auth/login', { method: 'POST', body: { identifier: { $ne: null } } }),
      request('/api/auth/login', { method: 'POST', body: { identifier: [1, 2, 3] } }),
      request('/api/auth/forgot-password', { method: 'POST', body: { email: { $exists: true } } }),
      request('/api/auth/forgot-password', { method: 'POST', body: { email: 42 } }),
    ])
    const allNon500 = concurrentMalformed.every((r) => r.status !== 500)
    assert(allNon500, 'P1-1.concurrent: All concurrent malformed requests return non-500 responses')

    // Legitimate login continues working cleanly after malformed barrage
    resetLimiters()
    const legitLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { identifier: testCustomer.email, password: 'Secret123!' },
    })
    assert(legitLogin.status === 200, 'P1-1.legit: Legitimate customer login succeeds (200 OK) after malformed barrage')

    // =============================================================
    // 2. VERIFY P1-2: ADMIN ORDER STATE MACHINE HTTP ENFORCEMENT
    // =============================================================
    console.log('\n--- 2. VERIFY P1-2: ADMIN ORDER STATE MACHINE ENFORCEMENT ---')
    resetLimiters()

    // Test matrix of illegal transitions:
    // A. Unpaid PENDING_PAYMENT order transitions
    const unpaidOrder = await helperCreateOrder('PENDING_PAYMENT', 'PENDING')
    const stockBefore = (await Product.findById(testProduct._id)).variants[0].qty

    // 1. PENDING_PAYMENT -> CONFIRMED (without payment)
    const resIllegal1 = await request(`/api/admin/orders/${unpaidOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'CONFIRMED' },
    })
    assert(resIllegal1.status === 400, 'P1-2.1: PENDING_PAYMENT -> CONFIRMED without payment rejected with 400')
    assert(
      resIllegal1.data.error?.code === 'unpaid_order_confirmation',
      'P1-2.1b: Error code is unpaid_order_confirmation',
    )

    // 2. PENDING_PAYMENT -> PROCESSING
    const resIllegal2 = await request(`/api/admin/orders/${unpaidOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'PROCESSING' },
    })
    assert(resIllegal2.status === 400, 'P1-2.2: PENDING_PAYMENT -> PROCESSING rejected with 400 invalid_order_transition')

    // 3. PENDING_PAYMENT -> SHIPPED
    const resIllegal3 = await request(`/api/admin/orders/${unpaidOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'SHIPPED' },
    })
    assert(resIllegal3.status === 400, 'P1-2.3: PENDING_PAYMENT -> SHIPPED rejected with 400 invalid_order_transition')

    // 4. PENDING_PAYMENT -> DELIVERED
    const resIllegal4 = await request(`/api/admin/orders/${unpaidOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'DELIVERED' },
    })
    assert(resIllegal4.status === 400, 'P1-2.4: PENDING_PAYMENT -> DELIVERED rejected with 400 invalid_order_transition')

    // Verify DB state of unpaid order remains unchanged
    const unpaidDbCheck = await Order.findById(unpaidOrder.id)
    assert(unpaidDbCheck.status === 'PENDING_PAYMENT', 'P1-2.5: Unpaid order status strictly remains PENDING_PAYMENT in DB')
    assert(unpaidDbCheck.paymentStatus === 'PENDING', 'P1-2.6: Payment status strictly remains PENDING')
    const stockAfterIllegal = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockBefore === stockAfterIllegal, 'P1-2.7: Inventory stock unchanged after rejected illegal transitions')

    // B. Terminal CANCELLED order illegal transitions
    const cancelledOrder = await helperCreateOrder('CANCELLED', 'FAILED')
    const cancelTransitions = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']
    for (const target of cancelTransitions) {
      const res = await request(`/api/admin/orders/${cancelledOrder.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: target },
      })
      assert(res.status === 400, `P1-2.cancel: CANCELLED -> ${target} rejected with 400 invalid_order_transition`)
    }
    const cancelledDbCheck = await Order.findById(cancelledOrder.id)
    assert(cancelledDbCheck.status === 'CANCELLED', 'P1-2.cancel: Order strictly remains CANCELLED in DB')

    // C. Terminal DELIVERED order illegal transitions
    const deliveredOrder = await helperCreateOrder('DELIVERED', 'PAID')
    const deliveredTransitions = ['CANCELLED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'PENDING_PAYMENT']
    for (const target of deliveredTransitions) {
      const res = await request(`/api/admin/orders/${deliveredOrder.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: target },
      })
      assert(res.status === 400, `P1-2.deliv: DELIVERED -> ${target} rejected with 400 invalid_order_transition`)
    }
    const deliveredDbCheck = await Order.findById(deliveredOrder.id)
    assert(deliveredDbCheck.status === 'DELIVERED', 'P1-2.deliv: Order strictly remains DELIVERED in DB')

    // D. Payment status downgrade attack (PAID -> PENDING)
    const paidOrder = await helperCreateOrder('CONFIRMED', 'SUCCESS')
    const resDowngrade = await request(`/api/admin/orders/${paidOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { paymentStatus: 'PENDING' },
    })
    assert(resDowngrade.status === 400, 'P1-2.pay: Downgrading SUCCESS paymentStatus to PENDING rejected with 400')
    assert(
      resDowngrade.data.error?.code === 'invalid_payment_transition',
      'P1-2.pay: Error code is invalid_payment_transition',
    )

    // E. Legal lifecycle transitions on a legitimately paid order
    const legalOrder = await helperCreateOrder('CONFIRMED', 'SUCCESS')
    const legalSteps = [
      { target: 'PROCESSING', expectedDisplay: 'Processing' },
      { target: 'SHIPPED', expectedDisplay: 'Shipped' },
      { target: 'OUT_FOR_DELIVERY', expectedDisplay: 'Out for Delivery' },
      { target: 'DELIVERED', expectedDisplay: 'Delivered' },
    ]
    for (const step of legalSteps) {
      const res = await request(`/api/admin/orders/${legalOrder.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: step.target },
      })
      assert(res.status === 200, `P1-2.legal: Transition to ${step.target} succeeds with 200 OK`)
      assert(res.data.order.status === step.target, `P1-2.legal: Order status is ${step.target}`)
      assert(res.data.order.displayStatus === step.expectedDisplay, `P1-2.legal: displayStatus is ${step.expectedDisplay}`)
    }

    // =============================================================
    // 3. VERIFY PAYMENT GATING & ANTI-RESURRECTION
    // =============================================================
    console.log('\n--- 3. VERIFY PAYMENT GATING & ANTI-RESURRECTION ---')
    resetLimiters()

    // Prove unpaid order cannot become CONFIRMED through admin update
    const unpaidGatingOrder = await helperCreateOrder('PENDING_PAYMENT', 'PENDING')
    const resGate1 = await request(`/api/admin/orders/${unpaidGatingOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'CONFIRMED' },
    })
    assert(resGate1.status === 400, 'Gate.1: Unpaid order cannot be moved to CONFIRMED')

    // Cancel the unpaid order
    const resCancelUnpaid = await request(`/api/orders/${unpaidGatingOrder.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { reason: 'Customer cancels unpaid order' },
    })
    assert(resCancelUnpaid.status === 200, 'Gate.2: Customer cancellation of unpaid order succeeds')

    // Attempt resurrection via admin status patch
    const resResurrect = await request(`/api/admin/orders/${unpaidGatingOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'CONFIRMED' },
    })
    assert(resResurrect.status === 400, 'Gate.3: Cancelled order cannot be resurrected to CONFIRMED via admin update')
    const checkPostResurrect = await Order.findById(unpaidGatingOrder.id)
    assert(checkPostResurrect.status === 'CANCELLED', 'Gate.4: Order remains CANCELLED')

    // =============================================================
    // 4. VERIFY P2-1: AUDITLOG DEFENSE-IN-DEPTH & IMMUTABILITY
    // =============================================================
    console.log('\n--- 4. VERIFY P2-1: AUDITLOG DEFENSE-IN-DEPTH & IMMUTABILITY ---')

    const rawSensitivePayload = {
      password: 'SuperSecretPassword!123',
      passwordHash: '$2a$10$xyz123fakehashvalueforauditreview',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      token: 'bearer_token_xyz987',
      idToken: 'google_id_token_abc123',
      resetToken: 'reset_token_secret_456',
      secret: 'app_master_secret',
      keySecret: 'rzp_test_secret_key_123',
      razorpay_key_secret: 'rzp_sec_topsecret',
      webhookSecret: 'whsec_999888777',
      authorization: 'Bearer eyJhbGciOi...',
      cookie: 'connect.sid=s%3A123456',
      cvv: '123',
      cardNumber: '4111111111111111',
      pan: '4111111111111111',
      nested: {
        adminPassword: 'NestedAdminPassword!456',
        apiKey: 'sk_live_1234567890',
        deep: {
          clientSecret: 'deep_secret_value',
        },
      },
      itemList: [
        { cardCVV: '999', userPassword: 'ArrayPassword!789' },
        'harmless_string',
      ],
    }

    // A. Verify through auditLogger.js service
    const serviceAuditDoc = await recordAuditLog({
      action: 'SECURITY_TEST',
      actorType: 'SYSTEM',
      resourceType: 'SYSTEM',
      result: 'INFO',
      reason: `auditLogger.js test ${runId}`,
      metadata: rawSensitivePayload,
    })
    const fetchedServiceAudit = await AuditLog.findById(serviceAuditDoc._id)
    assert(fetchedServiceAudit.metadata.password === '[REDACTED]', 'P2-1.srv.1: service audit: password is [REDACTED]')
    assert(fetchedServiceAudit.metadata.keySecret === '[REDACTED]', 'P2-1.srv.2: service audit: keySecret is [REDACTED]')
    assert(fetchedServiceAudit.metadata.nested.adminPassword === '[REDACTED]', 'P2-1.srv.3: service audit: nested password is [REDACTED]')
    assert(fetchedServiceAudit.metadata.itemList[0].userPassword === '[REDACTED]', 'P2-1.srv.4: service audit: array object userPassword is [REDACTED]')
    assert(fetchedServiceAudit.metadata.itemList[0].cardCVV === '[REDACTED]', 'P2-1.srv.5: service audit: array object cardCVV is [REDACTED]')
    assert(fetchedServiceAudit.metadata.itemList[1] === 'harmless_string', 'P2-1.srv.6: service audit: harmless string in array preserved')

    // B. Verify direct AuditLog.create() (Bypassing auditLogger.js completely)
    const directCreateDoc = await AuditLog.create({
      action: 'DIRECT_CREATE_SECURITY_TEST',
      actorType: 'SYSTEM',
      resourceType: 'SYSTEM',
      result: 'INFO',
      reason: `direct create test ${runId}`,
      metadata: rawSensitivePayload,
    })
    const fetchedDirectAudit = await AuditLog.findById(directCreateDoc._id)
    assert(fetchedDirectAudit.metadata.password === '[REDACTED]', 'P2-1.dir.1: direct AuditLog.create: password is [REDACTED]')
    assert(fetchedDirectAudit.metadata.passwordHash === '[REDACTED]', 'P2-1.dir.2: direct AuditLog.create: passwordHash is [REDACTED]')
    assert(fetchedDirectAudit.metadata.jwt === '[REDACTED]', 'P2-1.dir.3: direct AuditLog.create: jwt is [REDACTED]')
    assert(fetchedDirectAudit.metadata.authorization === '[REDACTED]', 'P2-1.dir.4: direct AuditLog.create: authorization is [REDACTED]')
    assert(fetchedDirectAudit.metadata.cookie === '[REDACTED]', 'P2-1.dir.5: direct AuditLog.create: cookie is [REDACTED]')
    assert(fetchedDirectAudit.metadata.cvv === '[REDACTED]', 'P2-1.dir.6: direct AuditLog.create: cvv is [REDACTED]')
    assert(fetchedDirectAudit.metadata.cardNumber === '[REDACTED]', 'P2-1.dir.7: direct AuditLog.create: cardNumber is [REDACTED]')
    assert(fetchedDirectAudit.metadata.razorpay_key_secret === '[REDACTED]', 'P2-1.dir.8: direct AuditLog.create: razorpay_key_secret is [REDACTED]')
    assert(fetchedDirectAudit.metadata.nested.adminPassword === '[REDACTED]', 'P2-1.dir.9: direct AuditLog.create: nested.adminPassword is [REDACTED]')
    assert(fetchedDirectAudit.metadata.nested.deep.clientSecret === '[REDACTED]', 'P2-1.dir.10: direct AuditLog.create: deep.clientSecret is [REDACTED]')
    assert(fetchedDirectAudit.metadata.itemList[0].userPassword === '[REDACTED]', 'P2-1.dir.11: direct AuditLog.create: array object userPassword is [REDACTED]')
    assert(fetchedDirectAudit.metadata.itemList[0].cardCVV === '[REDACTED]', 'P2-1.dir.12: direct AuditLog.create: array object cardCVV is [REDACTED]')

    // C. Verify direct new AuditLog().save()
    const instanceDoc = new AuditLog({
      action: 'INSTANCE_SAVE_SECURITY_TEST',
      actorType: 'SYSTEM',
      resourceType: 'SYSTEM',
      result: 'INFO',
      reason: `instance save test ${runId}`,
      metadata: { password: 'InstancePlainPassword!123' },
    })
    await instanceDoc.save()
    const fetchedInstanceAudit = await AuditLog.findById(instanceDoc._id)
    assert(fetchedInstanceAudit.metadata.password === '[REDACTED]', 'P2-1.save: new AuditLog().save: password is [REDACTED]')

    // D. Verify direct AuditLog.insertMany()
    const [insertedDoc] = await AuditLog.insertMany([
      {
        action: 'INSERT_MANY_SECURITY_TEST',
        actorType: 'SYSTEM',
        resourceType: 'SYSTEM',
        result: 'INFO',
        reason: `insertMany test ${runId}`,
        metadata: { keySecret: 'bulk_secret_xyz' },
      },
    ])
    const fetchedInsertedAudit = await AuditLog.findById(insertedDoc._id)
    assert(fetchedInsertedAudit.metadata.keySecret === '[REDACTED]', 'P2-1.bulk: AuditLog.insertMany: keySecret is [REDACTED]')

    // E. Verify AuditLog Immutability (all 8 mutation methods strictly blocked)
    const testDocId = directCreateDoc._id
    const mutationMethods = [
      { name: 'updateOne', fn: () => AuditLog.updateOne({ _id: testDocId }, { $set: { result: 'TAMPERED' } }) },
      { name: 'updateMany', fn: () => AuditLog.updateMany({ _id: testDocId }, { $set: { result: 'TAMPERED' } }) },
      { name: 'findOneAndUpdate', fn: () => AuditLog.findOneAndUpdate({ _id: testDocId }, { $set: { result: 'TAMPERED' } }) },
      { name: 'replaceOne', fn: () => AuditLog.replaceOne({ _id: testDocId }, { result: 'TAMPERED' }) },
      { name: 'deleteOne', fn: () => AuditLog.deleteOne({ _id: testDocId }) },
      { name: 'deleteMany', fn: () => AuditLog.deleteMany({ _id: testDocId }) },
      { name: 'findOneAndDelete', fn: () => AuditLog.findOneAndDelete({ _id: testDocId }) },
      { name: 'findOneAndReplace', fn: () => AuditLog.findOneAndReplace({ _id: testDocId }, { result: 'TAMPERED' }) },
    ]

    for (const m of mutationMethods) {
      let blocked = false
      try {
        await m.fn()
      } catch (err) {
        if (err.code === 'AUDIT_LOG_IMMUTABLE') {
          blocked = true
        }
      }
      assert(blocked, `Immutability: AuditLog.${m.name} is strictly rejected with code AUDIT_LOG_IMMUTABLE`)
    }

    // =============================================================
    // 5. DATABASE SAFETY & HISTORICAL FINANCIAL INTEGRITY
    // =============================================================
    console.log('\n--- 5. VERIFY DATABASE SAFETY & HISTORICAL FINANCIAL INTEGRITY ---')

    // Historical Payment 6aa242c25aea5fc569c4b8ae
    const histPayment = await Payment.findById('6aa242c25aea5fc569c4b8ae')
    assert(Boolean(histPayment), 'DB.1: Real historical ₹209 payment (6aa242c25aea5fc569c4b8ae) exists')
    assert(histPayment.status === 'REQUIRES_RECONCILIATION', 'DB.2: Historical payment status is preserved as REQUIRES_RECONCILIATION')
    assert(histPayment.capturedAmount === 0, 'DB.3: Historical payment capturedAmount is preserved as 0')
    assert(histPayment.refundableAmount === 0, 'DB.4: Historical payment refundableAmount is preserved as 0')
    assert(histPayment.refundedAmount === 0, 'DB.5: Historical payment refundedAmount is preserved as 0')

    // Production Order #SVH-10265
    const histOrder = await Order.findOne({ orderNumber: '#SVH-10265' })
    assert(Boolean(histOrder), 'DB.6: Real production order #SVH-10265 exists')
    assert(histOrder.status === 'PROCESSING', 'DB.7: Order #SVH-10265 status is PROCESSING')
    assert(histOrder.paymentStatus === 'SUCCESS', 'DB.8: Order #SVH-10265 paymentStatus is SUCCESS')

    // Financial invariant equations across all payments
    const allPayments = await Payment.find({})
    let allFinancialInvariantsHold = true
    for (const p of allPayments) {
      const cap = p.capturedAmount || 0
      const ref = p.refundedAmount || 0
      const refable = p.refundableAmount || 0
      if (ref > cap || refable < 0 || Math.abs(refable - (cap - ref)) > 0.01) {
        allFinancialInvariantsHold = false
        console.error(`Financial Invariant Violation on payment ${p._id}:`, { cap, ref, refable })
      }
    }
    assert(allFinancialInvariantsHold, 'DB.9: Financial invariant refundableAmount = capturedAmount - refundedAmount holds for ALL payments')

    // Inventory non-negative check across all products
    const allProducts = await Product.find({})
    let zeroNegativeStock = true
    for (const pr of allProducts) {
      if (pr.qty < 0) zeroNegativeStock = false
      for (const v of pr.variants || []) {
        if (v.qty < 0) zeroNegativeStock = false
      }
    }
    assert(zeroNegativeStock, 'DB.10: Zero negative stock counts across all catalog products and variants')

    console.log('\n====================================================================')
    console.log(`PHASE 2.4H-R VERIFICATION COMPLETE: ALL ${assertionCount} ASSERTIONS PASSED`)
    console.log('====================================================================\n')
  } finally {
    await teardown()
  }
}

setupFixtures()
  .then(() => runRemediationVerification())
  .catch((err) => {
    console.error('\n[FATAL] Phase 2.4H-R Verification Suite Failed:', err)
    process.exit(1)
  })

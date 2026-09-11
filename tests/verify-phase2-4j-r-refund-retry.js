/**
 * SV HUB — PHASE 2.4J-R REFUND RETRY REMEDIATION & CONCURRENCY SUITE
 *
 * Dedicated verification for:
 * A. transient WriteConflict on attempt 1 (recovers on attempt 2)
 * B. transient WriteConflict on attempt 2 (recovers on attempt 3)
 * C. transient WriteConflict on final allowed attempt (attempt 3)
 * D. repeated WriteConflict until retry exhaustion (no TypeError, no 500, enters REQUIRES_RECONCILIATION)
 * E. successful retry after transient conflict
 * F. permanent gateway failure
 * G. gateway timeout / uncertain result
 * H. gateway refund created but local DB update conflicts
 * I. duplicate retry after refund already exists (idempotent)
 * J. concurrent refund requests (no over-refund)
 * K. concurrent reconciliation (idempotent)
 * L. webhook + refund reconciliation race (safe convergence)
 * M. recovery/sweeper after retry exhaustion (recovers REQUIRES_RECONCILIATION)
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
  MAX_REFUND_RECONCILIATION_ATTEMPTS,
  initiateRefund,
  processRefundWebhook,
  reconcileRefundRecord,
  recoverStaleRefunds,
  completeRefundFulfillment,
} from '../src/services/refundReconciliationService.js'
import { refundAdminOrder } from '../src/controllers/adminOrderController.js'
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
  const eventId = eventIdOverride || `evt_24jr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const bodyString = JSON.stringify({
    entity: 'event',
    account_id: 'acc_test_24jr',
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
  console.log('SV HUB — PHASE 2.4J-R REFUND RETRY REMEDIATION SUITE')
  console.log('====================================================================\n')

  await connectDb()

  await new Promise((resolve) => {
    testServer = app.listen(0, () => {
      const port = testServer.address().port
      API_BASE = `http://localhost:${port}/api`
      resolve()
    })
  })

  const runId = `24jr_${Date.now()}`
  let custA = null
  let admin = null
  let tokenA = null
  let adminToken = null
  let prodA = null

  const cleanupUserIds = []
  const cleanupProductIds = []
  const cleanupOrderIds = []
  const cleanupPaymentIds = []
  const cleanupRefundIds = []
  const cleanupWebhookIds = []

  // Deterministic gateway mock
  let gatewayRefundCallCount = 0
  const mockRzp = {
    payments: {
      refund: async (payId, params) => {
        gatewayRefundCallCount++
        return {
          id: `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          entity: 'refund',
          amount: params.amount,
          currency: 'INR',
          payment_id: payId,
          status: 'processed',
          created_at: Math.floor(Date.now() / 1000),
        }
      },
    },
    refunds: {
      fetch: async (id) => ({
        id,
        entity: 'refund',
        amount: 50000,
        status: 'processed',
      }),
    },
  }
  setRazorpayClient(mockRzp)

  try {
    // 0. Setup Users & Catalog
    console.log('--- 0. SETUP TEST USERS & CATALOG ---')
    custA = await User.create({
      name: 'Customer 24J-R',
      email: `cust24jr_${runId}@example.com`,
      phone: '9876543201',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(custA._id)

    admin = await User.create({
      name: 'Admin 24J-R',
      email: `admin24jr_${runId}@example.com`,
      phone: '9876543299',
      password: 'Password123!',
      role: 'ADMIN',
      isActive: true,
    })
    cleanupUserIds.push(admin._id)

    const jwt = (await import('jsonwebtoken')).default
    const { jwtSecret } = await import('../src/utils/auth.js')
    tokenA = jwt.sign({ sub: String(custA._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    adminToken = jwt.sign({ sub: String(admin._id), role: 'ADMIN' }, jwtSecret(), { expiresIn: '1h' })

    prodA = await Product.create({
      name: `Product 24JR ${runId}`,
      slug: `product-24jr-${runId}`,
      description: 'Test catalog item',
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      price: 500,
      weight: '1L',
      sku: `SKU-24JR-A-${runId}`,
      qty: 100,
      isActive: true,
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      variants: [
        {
          variantId: `var_a_${runId}`,
          label: '1L Bottle',
          weight: '1L',
          price: 500,
          qty: 100,
          sku: `SKU-24JR-A-V1-${runId}`,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(prodA._id)

    assertTest('0.1: Test fixtures initialized successfully', Boolean(custA && admin && prodA))
    assertTest('0.2: Authoritative MAX_REFUND_RECONCILIATION_ATTEMPTS constant is 3', MAX_REFUND_RECONCILIATION_ATTEMPTS === 3)

    // Helper to create valid Order + Payment fixture
    async function createOrderPaymentFixture(tag, amount = 1000) {
      const order = await Order.create({
        orderNumber: `SVH-24JR-${tag}-${Date.now()}`,
        userId: custA._id,
        customerName: custA.name,
        email: custA.email,
        phone: custA.phone,
        shippingAddress: {
          name: 'Customer 24J-R',
          phone: '9876543201',
          street: '123 Test St',
          city: 'Bangalore',
          state: 'Karnataka',
          pin: '560001',
        },
        items: [
          {
            productId: prodA._id,
            variantId: `var_a_${runId}`,
            productName: prodA.name,
            variantLabel: '1L Bottle',
            weight: '1L',
            sku: `SKU-24JR-A-V1-${runId}`,
            unitPrice: 500,
            quantity: Math.floor(amount / 500),
            restoredQuantity: 0,
            lineTotal: amount,
          },
        ],
        subtotal: amount,
        shippingFee: 0,
        discount: 0,
        totalAmount: amount,
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
        paymentMethod: 'razorpay',
        inventoryDeducted: true,
        inventoryRestored: false,
        razorpayOrderId: `order_24jr_${tag}_${Date.now()}`,
      })
      cleanupOrderIds.push(order._id)

      const payment = await Payment.create({
        orderId: order._id,
        userId: custA._id,
        amount,
        capturedAmount: amount,
        refundedAmount: 0,
        refundableAmount: amount,
        currency: 'INR',
        gateway: 'razorpay',
        status: 'SUCCESS',
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: `pay_24jr_${tag}_${Date.now()}`,
      })
      cleanupPaymentIds.push(payment._id)

      return { order, payment }
    }

    // --- TEST A: Transient WriteConflict on attempt 1 (succeeds on attempt 2) ---
    console.log('\n--- TEST A: Transient WriteConflict on attempt 1 ---')
    const fixA = await createOrderPaymentFixture('A', 500)
    
    // Concurrently trigger update to provoke WriteConflict retry handling during fulfillment
    let attemptACount = 0
    const realSaveA = Payment.prototype.save
    Payment.prototype.save = async function (options) {
      if (this._id.toString() === fixA.payment._id.toString() && this.isModified('refundedAmount') && attemptACount === 0 && options?.session) {
        attemptACount++
        const err = new Error('WriteConflict')
        err.code = 112
        err.codeName = 'WriteConflict'
        throw err
      }
      return realSaveA.apply(this, arguments)
    }

    const resA = await initiateRefund({
      orderId: fixA.order._id,
      amount: 500,
      reason: 'Test A transient conflict attempt 1',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_a_${Date.now()}`,
    })
    Payment.prototype.save = realSaveA
    if (resA.refund?._id) cleanupRefundIds.push(resA.refund._id)

    assertTest('A.1: InitiateRefund recovers after attempt 1 WriteConflict', resA.success === true)
    assertTest('A.2: Refund status is PROCESSED', resA.refund?.status === 'PROCESSED')
    assertTest('A.3: Retry attempt was executed', attemptACount === 1)

    // --- TEST B: Transient WriteConflict on attempt 2 (succeeds on attempt 3) ---
    console.log('\n--- TEST B: Transient WriteConflict on attempt 2 ---')
    const fixB = await createOrderPaymentFixture('B', 500)
    let attemptBCount = 0
    const realSaveB = Payment.prototype.save
    Payment.prototype.save = async function (options) {
      if (this._id.toString() === fixB.payment._id.toString() && this.isModified('refundedAmount') && attemptBCount < 2 && options?.session) {
        attemptBCount++
        const err = new Error('WriteConflict')
        err.code = 112
        err.codeName = 'WriteConflict'
        throw err
      }
      return realSaveB.apply(this, arguments)
    }

    const resB = await initiateRefund({
      orderId: fixB.order._id,
      amount: 500,
      reason: 'Test B transient conflict attempt 2',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_b_${Date.now()}`,
    })
    Payment.prototype.save = realSaveB
    if (resB.refund?._id) cleanupRefundIds.push(resB.refund._id)

    assertTest('B.1: InitiateRefund recovers after attempt 2 WriteConflict', resB.success === true)
    assertTest('B.2: Refund status is PROCESSED', resB.refund?.status === 'PROCESSED')
    assertTest('B.3: Both transient attempts were retried', attemptBCount === 2)

    // --- TEST C & D: Transient WriteConflict on final attempt & Retry Exhaustion ---
    console.log('\n--- TEST C & D: WriteConflict Retry Exhaustion on Final Attempt ---')
    const fixC = await createOrderPaymentFixture('C', 500)
    let attemptCCount = 0
    const realSaveC = Payment.prototype.save
    Payment.prototype.save = async function (options) {
      if (this._id.toString() === fixC.payment._id.toString() && this.isModified('refundedAmount') && options?.session) {
        attemptCCount++
        const err = new Error('WriteConflict')
        err.code = 112
        err.codeName = 'WriteConflict'
        throw err
      }
      return realSaveC.apply(this, arguments)
    }

    // Test through HTTP controller directly to guarantee HTTP response behavior and no-TypeError
    const mockReqC = {
      params: { id: String(fixC.order._id) },
      body: {
        amount: 500,
        reason: 'Test C WriteConflict exhaustion',
        idempotencyKey: `idemp_c_${Date.now()}`,
      },
      user: admin,
      headers: {},
    }
    let controllerStatusC = 200
    let controllerBodyC = null
    const mockResC = {
      status(code) {
        controllerStatusC = code
        return this
      },
      json(data) {
        controllerBodyC = data
        return this
      },
    }

    let controllerErrorC = null
    try {
      await refundAdminOrder(mockReqC, mockResC, (err) => {
        if (err) controllerErrorC = err
      })
    } catch (err) {
      controllerErrorC = err
    }
    Payment.prototype.save = realSaveC

    assertTest('C.1: Final attempt WriteConflict does NOT throw unhandled TypeError', controllerErrorC === null)
    assertTest('C.2: Response status is 503 Service Unavailable', controllerStatusC === 503)
    assertTest('C.3: Error code is refund_reconciliation_pending', controllerBodyC?.error?.code === 'refund_reconciliation_pending')
    assertTest('C.4: Loop executed exactly MAX_REFUND_RECONCILIATION_ATTEMPTS (3)', attemptCCount === 3)

    const refundDocC = await Refund.findOne({ orderId: fixC.order._id })
    if (refundDocC?._id) cleanupRefundIds.push(refundDocC._id)

    assertTest('D.1: Refund document exists with gateway refund ID', Boolean(refundDocC && refundDocC.razorpayRefundId))
    assertTest('D.2: Refund document status is REQUIRES_RECONCILIATION (not FAILED)', refundDocC?.status === 'REQUIRES_RECONCILIATION')
    assertTest('D.3: Safe failure reason records local fulfillment pending', refundDocC?.safeFailureReason?.includes('Local fulfillment pending'))

    // --- TEST E: Successful Retry After Transient Conflict ---
    console.log('\n--- TEST E: Successful Retry After Transient Conflict ---')
    const fixE = await createOrderPaymentFixture('E', 500)
    let attemptECount = 0
    const realSaveE = Payment.prototype.save
    Payment.prototype.save = async function (options) {
      if (this._id.toString() === fixE.payment._id.toString() && this.isModified('refundedAmount') && attemptECount === 0 && options?.session) {
        attemptECount++
        const err = new Error('TransientTransactionError')
        err.errorLabels = ['TransientTransactionError']
        throw err
      }
      return realSaveE.apply(this, arguments)
    }

    const resE = await initiateRefund({
      orderId: fixE.order._id,
      amount: 500,
      reason: 'Test E TransientTransactionError retry',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_e_${Date.now()}`,
    })
    Payment.prototype.save = realSaveE
    if (resE.refund?._id) cleanupRefundIds.push(resE.refund._id)

    assertTest('E.1: Succeeded on retry attempt', resE.success === true)
    assertTest('E.2: Refund is PROCESSED', resE.refund?.status === 'PROCESSED')

    // --- TEST F: Permanent Gateway Failure ---
    console.log('\n--- TEST F: Permanent Gateway Failure ---')
    const fixF = await createOrderPaymentFixture('F', 500)
    const mockRzpPermFail = {
      payments: {
        refund: async () => {
          const err = new Error('Amount exceeds refundable balance')
          err.statusCode = 400
          err.code = 'BAD_REQUEST_ERROR'
          throw err
        },
      },
    }
    setRazorpayClient(mockRzpPermFail)

    const resF = await initiateRefund({
      orderId: fixF.order._id,
      amount: 500,
      reason: 'Test F permanent failure',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_f_${Date.now()}`,
    })
    setRazorpayClient(mockRzp)
    if (resF.refund?._id) cleanupRefundIds.push(resF.refund._id)

    assertTest('F.1: Permanent gateway failure returns success: false', resF.success === false)
    assertTest('F.2: Status code is 400', resF.statusCode === 400)
    assertTest('F.3: Refund document marked FAILED', resF.refund?.status === 'FAILED')
    const payF = await Payment.findById(fixF.payment._id)
    assertTest('F.4: Refundable balance restored to Payment (still 500)', payF.refundableAmount === 500)

    // --- TEST G: Gateway Timeout / Uncertain Result ---
    console.log('\n--- TEST G: Gateway Timeout / Uncertain Result ---')
    const fixG = await createOrderPaymentFixture('G', 500)
    const mockRzpTimeout = {
      payments: {
        refund: async () => {
          const err = new Error('ETIMEDOUT')
          err.code = 'ETIMEDOUT'
          throw err
        },
      },
    }
    setRazorpayClient(mockRzpTimeout)

    const resG = await initiateRefund({
      orderId: fixG.order._id,
      amount: 500,
      reason: 'Test G gateway timeout',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_g_${Date.now()}`,
    })
    setRazorpayClient(mockRzp)
    if (resG.refund?._id) cleanupRefundIds.push(resG.refund._id)

    assertTest('G.1: Gateway timeout returns 502', resG.statusCode === 502)
    assertTest('G.2: Refund kept in PROCESSING (NOT FAILED)', resG.refund?.status === 'PROCESSING')
    assertTest('G.3: Gateway status marked uncertain', resG.refund?.gatewayStatus === 'uncertain')

    // --- TEST H: Gateway Refund Created but Local DB Update Conflicts ---
    console.log('\n--- TEST H: Gateway Refund Created but Local Update Conflicts ---')
    const fixH = await createOrderPaymentFixture('H', 500)
    let callHCount = 0
    const realSaveH = Payment.prototype.save
    Payment.prototype.save = async function (options) {
      if (this._id.toString() === fixH.payment._id.toString() && this.isModified('refundedAmount') && options?.session) {
        callHCount++
        const err = new Error('WriteConflict')
        err.code = 112
        throw err
      }
      return realSaveH.apply(this, arguments)
    }

    const resH = await initiateRefund({
      orderId: fixH.order._id,
      amount: 500,
      reason: 'Test H conflict after gateway creation',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_h_${Date.now()}`,
    })
    Payment.prototype.save = realSaveH
    if (resH.refund?._id) cleanupRefundIds.push(resH.refund._id)

    assertTest('H.1: Returned explicit failure result object (not null)', Boolean(resH) && resH.success === false)
    assertTest('H.2: Refund doc has gateway refund ID', Boolean(resH.refund?.razorpayRefundId))
    assertTest('H.3: Status is REQUIRES_RECONCILIATION', resH.refund?.status === 'REQUIRES_RECONCILIATION')

    // --- TEST I: Duplicate Retry After Refund Already Exists ---
    console.log('\n--- TEST I: Duplicate Idempotency Retry ---')
    const fixI = await createOrderPaymentFixture('I', 500)
    const idempKeyI = `idemp_i_${Date.now()}`

    const resI1 = await initiateRefund({
      orderId: fixI.order._id,
      amount: 500,
      reason: 'Test I call 1',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: idempKeyI,
    })
    if (resI1.refund?._id) cleanupRefundIds.push(resI1.refund._id)

    const resI2 = await initiateRefund({
      orderId: fixI.order._id,
      amount: 500,
      reason: 'Test I duplicate call',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: idempKeyI,
    })

    assertTest('I.1: First call succeeds', resI1.success === true)
    assertTest('I.2: Second call returns idempotent: true', resI2.success === true && resI2.idempotent === true)
    assertTest('I.3: Exactly same refund document returned', String(resI1.refund._id) === String(resI2.refund._id))

    // --- TEST J: Concurrent Refund Requests (No Over-Refund) ---
    console.log('\n--- TEST J: Concurrent Refund Requests ---')
    const fixJ = await createOrderPaymentFixture('J', 500)
    const [raceJ1, raceJ2] = await Promise.all([
      initiateRefund({
        orderId: fixJ.order._id,
        amount: 500,
        reason: 'Test J concurrent 1',
        user: admin,
        role: 'admin',
        source: 'admin_request',
        idempotencyKey: `idemp_j1_${Date.now()}`,
      }),
      initiateRefund({
        orderId: fixJ.order._id,
        amount: 500,
        reason: 'Test J concurrent 2',
        user: admin,
        role: 'admin',
        source: 'admin_request',
        idempotencyKey: `idemp_j2_${Date.now()}`,
      }),
    ])
    if (raceJ1.refund?._id) cleanupRefundIds.push(raceJ1.refund._id)
    if (raceJ2.refund?._id) cleanupRefundIds.push(raceJ2.refund._id)

    const successCountJ = (raceJ1.success ? 1 : 0) + (raceJ2.success ? 1 : 0)
    assertTest('J.1: Exactly one of the two concurrent full refunds succeeds', successCountJ === 1)
    const payJ = await Payment.findById(fixJ.payment._id)
    assertTest('J.2: Payment refundedAmount does not exceed 500', payJ.refundedAmount === 500)
    assertTest('J.3: Payment refundableAmount is 0', payJ.refundableAmount === 0)

    // --- TEST K: Concurrent Reconciliation ---
    console.log('\n--- TEST K: Concurrent Reconciliation ---')
    const fixK = await createOrderPaymentFixture('K', 500)
    const resK1 = await initiateRefund({
      orderId: fixK.order._id,
      amount: 500,
      reason: 'Test K setup',
      user: admin,
      role: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_k_${Date.now()}`,
    })
    if (resK1.refund?._id) cleanupRefundIds.push(resK1.refund._id)

    const [recK1, recK2] = await Promise.all([
      reconcileRefundRecord({ refundId: resK1.refund._id, force: true }),
      reconcileRefundRecord({ refundId: resK1.refund._id, force: true }),
    ])

    assertTest('K.1: Both concurrent reconciliations succeed safely', recK1.success === true && recK2.success === true)

    // --- TEST L: Webhook + Refund Reconciliation Race ---
    console.log('\n--- TEST L: Webhook + Refund Reconciliation Race ---')
    const fixL = await createOrderPaymentFixture('L', 500)
    const refundDocL = await Refund.create({
      orderId: fixL.order._id,
      paymentId: fixL.payment._id,
      userId: custA._id,
      razorpayPaymentId: fixL.payment.razorpayPaymentId,
      razorpayRefundId: `rfnd_race_${Date.now()}`,
      amount: 500,
      amountInPaise: 50000,
      currency: 'INR',
      status: 'PROCESSING',
      reason: 'Race test',
      requestedBy: admin._id,
      requestedByRole: 'admin',
      source: 'admin_request',
      idempotencyKey: `idemp_l_${Date.now()}`,
    })
    cleanupRefundIds.push(refundDocL._id)

    const webhookPayloadL = {
      payment: { entity: { id: fixL.payment.razorpayPaymentId, amount: 50000, currency: 'INR' } },
      refund: { entity: { id: refundDocL.razorpayRefundId, payment_id: fixL.payment.razorpayPaymentId, amount: 50000, status: 'processed' } },
    }
    const signedWhL = createSignedWebhook('refund.processed', webhookPayloadL)

    const [raceRecL, raceWhL] = await Promise.all([
      reconcileRefundRecord({ refundId: refundDocL._id, force: true }),
      apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'x-razorpay-signature': signedWhL.signature },
        body: signedWhL.bodyString,
      }),
    ])
    if (signedWhL.eventId) cleanupWebhookIds.push(signedWhL.eventId)

    assertTest('L.1: Race between reconciliation and webhook returns 200/safe', raceRecL.success === true && raceWhL.status === 200)
    const refreshedRefundL = await Refund.findById(refundDocL._id)
    assertTest('L.2: Refund converges to PROCESSED', refreshedRefundL.status === 'PROCESSED')

    // --- TEST M: Recovery / Sweeper After Retry Exhaustion ---
    console.log('\n--- TEST M: Recovery / Sweeper After Retry Exhaustion ---')
    // We already have fixC from Test C where refundDocC is in REQUIRES_RECONCILIATION!
    // Stale cutoff 0 to force recoverStaleRefunds to process immediately
    const sweepRes = await recoverStaleRefunds({ staleThresholdMs: 0, limit: 10 })
    const sweptC = sweepRes?.results?.find((r) => String(r.refundId) === String(refundDocC._id))

    assertTest('M.1: Stale recovery sweeper processed the REQUIRES_RECONCILIATION refund', Boolean(sweptC && sweptC.success))
    const finalRefundDocC = await Refund.findById(refundDocC._id)
    assertTest('M.2: Final refund doc transitioned to PROCESSED via sweeper', finalRefundDocC?.status === 'PROCESSED')
    const finalOrderC = await Order.findById(fixC.order._id)
    assertTest('M.3: Order paymentStatus transitioned to REFUNDED', finalOrderC?.paymentStatus === 'REFUNDED')

    // --- FINANCIAL INVARIANTS AUDIT ---
    console.log('\n--- FINANCIAL INVARIANTS AUDIT ---')
    const allPayments = await Payment.find({})
    let invariantsHold = true
    for (const p of allPayments) {
      const cap = Number(p.capturedAmount) || 0
      const ref = Number(p.refundedAmount) || 0
      const able = Number(p.refundableAmount) || 0
      if (cap < 0 || ref < 0 || able < 0 || ref > cap) invariantsHold = false
    }
    assertTest('Invariants: All payments satisfy financial consistency bounds', invariantsHold)

  } finally {
    // Teardown temporary fixtures only
    console.log('\n--- CLEANING UP PHASE 2.4J-R TEST FIXTURES ---')
    resetRazorpayClient()

    if (cleanupRefundIds.length > 0) {
      await Refund.deleteMany({ _id: { $in: cleanupRefundIds } }).catch(() => {})
    }
    if (cleanupWebhookIds.length > 0) {
      await WebhookEvent.deleteMany({ eventId: { $in: cleanupWebhookIds } }).catch(() => {})
    }
    if (cleanupPaymentIds.length > 0) {
      await Payment.deleteMany({ _id: { $in: cleanupPaymentIds } }).catch(() => {})
    }
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } }).catch(() => {})
    }
    if (cleanupProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: cleanupProductIds } }).catch(() => {})
    }
    if (cleanupUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: cleanupUserIds } }).catch(() => {})
    }

    if (testServer) {
      await new Promise((res) => testServer.close(res))
    }
    await disconnectDb()
    console.log('Cleanup complete.\n')
  }

  console.log('====================================================================')
  console.log(`PHASE 2.4J-R TEST RESULTS: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runSuite().catch((err) => {
  console.error('Fatal Suite Crash:', err)
  process.exit(1)
})

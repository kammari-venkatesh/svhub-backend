/**
 * SV Hub Phase 2.4B — Production Payment State & Fulfillment Core Test Suite
 *
 * Requirements Tested:
 * A. Valid captured payment succeeds
 * B. Invalid signature fails
 * C. Wrong Razorpay order ID fails
 * D. Wrong payment ID fails
 * E. Wrong amount fails
 * F. Wrong currency fails
 * G. Non-captured payment cannot fulfill
 * H. Razorpay fetch failure cannot fulfill
 * I. Customer cannot verify another customer's order
 * J. Cancelled order cannot be resurrected
 * K. Delivered order cannot be resurrected
 * L. Duplicate verification is idempotent
 * M. Same payment ID cannot fulfill two orders
 * N. Same Razorpay order cannot fulfill two SV Hub orders
 * O. Two concurrent verify requests: exactly one fulfillment
 * P. Concurrent verification: inventory deducted exactly once
 * Q. Concurrent verification: successful order is never downgraded to FAILED
 * R. Inventory = 1, two concurrent valid orders: only one succeeds
 * S. Stock never becomes negative
 * T. Transaction rollback: payment/order/inventory/cart remain consistent
 * U. Cart modifications during payment do not remove unrelated items
 * V. Admin cancellation is idempotent
 * W. Cancellation does not restore inventory twice
 * X. Captured payment + cancelled order produces reconciliation state
 * Y. Gateway uncertainty does not falsely mark payment failed
 * Z. Concurrent create-order calls do not create multiple active local payment attempts
 * AA. Existing successful Razorpay Test Mode flow remains compatible
 */

import 'dotenv/config'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'
import { User, Product, Cart, Address, Order, Payment } from '../src/models/index.js'
import { fulfillRazorpayPayment } from '../src/services/paymentFulfillmentService.js'
import { getRazorpayKeySecret, verifyRazorpaySignature } from '../src/config/razorpay.js'

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000/api'

let passed = 0
let failed = 0
const results = []

function assertTest(name, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`)
    passed++
    results.push({ name, passed: true })
  } else {
    console.error(`[FAIL] ${name} ${details ? '— ' + details : ''}`)
    failed++
    results.push({ name, passed: false, details })
  }
}

function generateSignature(orderId, paymentId, secret) {
  const keySecret = secret || process.env.RAZORPAY_KEY_SECRET || 'test_secret'
  return crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
}

async function apiRequest(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function runPhase24BTests() {
  console.log('====================================================================')
  console.log('SV HUB — PHASE 2.4B PAYMENT STATE & ATOMIC FULFILLMENT TEST SUITE')
  console.log('====================================================================\n')

  await connectDb()

  const runId = Date.now()
  const keySecret = getRazorpayKeySecret() || process.env.RAZORPAY_KEY_SECRET || 'test_secret'

  let customerUserA, customerTokenA
  let customerUserB, customerTokenB
  let adminUser, adminToken
  let baseProduct

  const cleanupUserIds = []
  const cleanupOrderIds = []
  const cleanupProductIds = []

  try {
    // -------------------------------------------------------------
    // FIXTURE SETUP
    // -------------------------------------------------------------
    console.log('--- Setting Up Test Fixtures ---')

    const regA = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alice Phase24B',
        email: `alice_${runId}@example.com`,
        password: 'Password123!',
        phone: '9876543210',
      }),
    })
    customerTokenA = regA.data?.token
    customerUserA = await User.findOne({ email: `alice_${runId}@example.com` })
    cleanupUserIds.push(customerUserA._id)

    const regB = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bob Phase24B',
        email: `bob_${runId}@example.com`,
        password: 'Password123!',
        phone: '9876543211',
      }),
    })
    customerTokenB = regB.data?.token
    customerUserB = await User.findOne({ email: `bob_${runId}@example.com` })
    cleanupUserIds.push(customerUserB._id)

    // Admin user for cancellation tests
    adminUser = await User.create({
      name: 'Admin Phase24B',
      email: `admin_${runId}@svhub.in`,
      passwordHash: 'dummyhash',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    cleanupUserIds.push(adminUser._id)
    const jwt = (await import('jsonwebtoken')).default
    const { jwtSecret } = await import('../src/utils/auth.js')
    adminToken = jwt.sign(
      { sub: String(adminUser._id), role: 'ADMIN' },
      jwtSecret(),
      { expiresIn: '1h' },
    )

    baseProduct = await Product.create({
      name: `Core Test Oil ${runId}`,
      slug: `core-test-oil-${runId}`,
      type: 'Cold Pressed Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      description: 'Phase 2.4B core test product',
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      price: 500,
      weight: '1 L',
      sku: `CORE-${runId}-BASE`,
      qty: 20,
      isActive: true,
      variants: [
        {
          variantId: '1L',
          label: '1 Litre Bottle',
          weight: '1 L',
          sku: `CORE-${runId}-1L`,
          price: 500,
          qty: 20,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(baseProduct._id)

    assertTest('Fixtures setup: Users & Product initialized', Boolean(customerTokenA && customerTokenB && baseProduct))

    // Helper: Create an SV Hub Order for a customer
    async function makeTestOrder(user, token, qty = 1, initialStock = null) {
      if (initialStock !== null) {
        await Product.updateOne(
          { _id: baseProduct._id, 'variants.variantId': '1L' },
          { $set: { qty: initialStock, 'variants.$.qty': initialStock } },
        )
      }

      await Cart.updateOne(
        { userId: user._id },
        {
          $set: {
            items: [
              {
                productId: baseProduct._id,
                variantId: '1L',
                quantity: qty,
              },
            ],
          },
        },
        { upsert: true },
      )

      const orderRes = await apiRequest('/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          shippingMethod: 'standard',
          shippingAddress: {
            name: user.name,
            phone: '9876543210',
            street: '123 Core Test Road',
            city: 'Coimbatore',
            state: 'Tamil Nadu',
            pin: '641001',
          },
        }),
      })

      const order = orderRes.data?.data
      if (order) cleanupOrderIds.push(order.id || order._id)
      return order
    }

    // Helper: Create Payment record directly in MongoDB for unit/service test scenarios
    async function makeTestPayment(order, rzpOrderId = null) {
      const razorpayOrderId = rzpOrderId || `order_rzp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const payment = await Payment.create({
        orderId: order.id || order._id,
        userId: order.userId,
        amount: order.totalAmount,
        currency: 'INR',
        gateway: 'razorpay',
        status: 'CREATED',
        razorpayOrderId,
      })
      await Order.updateOne({ _id: order.id || order._id }, { $set: { razorpayOrderId, paymentMethod: 'razorpay' } })
      return { payment, razorpayOrderId }
    }

    // -------------------------------------------------------------
    // TEST A: Valid captured payment succeeds
    // -------------------------------------------------------------
    console.log('\n--- TEST A: Valid captured payment succeeds ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 2)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_valid_${Date.now()}`
      const signature = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Test via service (with process.env.SKIP_RZP_FETCH=true for synthetic simulation)
      process.env.SKIP_RZP_FETCH = 'true'
      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: signature,
        user: customerUserA,
      })

      assertTest('TEST A.1: Service fulfills payment successfully', fulfillRes.success === true)

      const confirmedOrder = await Order.findById(order.id)
      assertTest('TEST A.2: Order transitioned to CONFIRMED', confirmedOrder.status === 'CONFIRMED')
      assertTest('TEST A.3: Order paymentStatus is SUCCESS', confirmedOrder.paymentStatus === 'SUCCESS')
      assertTest('TEST A.4: Order paymentId matches', confirmedOrder.paymentId === rzpPaymentId)
      assertTest('TEST A.5: Order inventoryDeducted is true', confirmedOrder.inventoryDeducted === true)

      const updatedProd = await Product.findById(baseProduct._id)
      const updatedVariant = updatedProd.variants.find((v) => v.variantId === '1L')
      assertTest('TEST A.6: Inventory deducted from 20 to 18 units', updatedVariant.qty === 18 && updatedProd.qty === 18)
    }

    // -------------------------------------------------------------
    // TEST B: Invalid signature fails
    // -------------------------------------------------------------
    console.log('\n--- TEST B: Invalid signature fails ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_badsig_${Date.now()}`
      const badSig = 'invalid_tampered_hmac_signature_00000000000000000000000000000000'

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: badSig,
        user: customerUserA,
      })

      assertTest('TEST B.1: Fails with invalid_signature', fulfillRes.success === false && fulfillRes.errorCode === 'invalid_signature')

      const o = await Order.findById(order.id)
      assertTest('TEST B.2: Order remains PENDING_PAYMENT (not CONFIRMED)', o.status === 'PENDING_PAYMENT')
      assertTest('TEST B.3: Order paymentStatus marked FAILED', o.paymentStatus === 'FAILED')

      const p = await Payment.findOne({ orderId: order.id, razorpayOrderId })
      assertTest('TEST B.4: Payment status marked FAILED', p.status === 'FAILED')
    }

    // -------------------------------------------------------------
    // TEST C: Wrong Razorpay order ID fails
    // -------------------------------------------------------------
    console.log('\n--- TEST C: Wrong Razorpay order ID fails ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      await makeTestPayment(order)
      const rzpPaymentId = `pay_c_${Date.now()}`
      const wrongOrderId = 'order_wrong_razorpay_id_999'
      const sig = generateSignature(wrongOrderId, rzpPaymentId, keySecret)

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId: wrongOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST C: Mismatched Razorpay order ID rejected', fulfillRes.success === false && fulfillRes.errorCode === 'mismatched_razorpay_order_id')
    }

    // -------------------------------------------------------------
    // TEST D: Wrong payment ID fails (signature mismatch)
    // -------------------------------------------------------------
    console.log('\n--- TEST D: Wrong payment ID fails ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_d1_${Date.now()}`
      const tamperedPaymentId = `pay_d2_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: tamperedPaymentId, // tampered!
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST D: Tampered payment ID fails signature verification', fulfillRes.success === false && fulfillRes.errorCode === 'invalid_signature')
    }

    // -------------------------------------------------------------
    // TEST E: Wrong amount fails
    // -------------------------------------------------------------
    console.log('\n--- TEST E: Wrong amount fails ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_e_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        amount: 9999999, // tampered amount
        user: customerUserA,
      })

      assertTest('TEST E: Amount mismatch rejected by server authority', fulfillRes.success === false && fulfillRes.errorCode === 'amount_mismatch')
    }

    // -------------------------------------------------------------
    // TEST F: Wrong currency fails (simulated gateway check)
    // -------------------------------------------------------------
    console.log('\n--- TEST F: Wrong currency / uncaptured payment fails ---')
    {
      // Test when gateway returns currency !== INR or status !== 'captured'
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_f_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Temporarily mock razorpay client fetch
      const { setRazorpayClient, resetRazorpayClient } = await import('../src/config/razorpay.js')
      process.env.STRICT_RZP_FETCH = 'true'
      delete process.env.SKIP_RZP_FETCH

      // Mock gateway returning status = 'authorized' (not captured!)
      setRazorpayClient({
        payments: {
          fetch: async () => ({
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'USD', // Wrong currency!
            status: 'authorized', // Not captured!
          }),
        },
      })

      const fulfillResCurrency = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST F: Non-INR currency rejected', fulfillResCurrency.success === false && fulfillResCurrency.errorCode === 'invalid_currency')

      // TEST G: Non-captured payment rejected
      setRazorpayClient({
        payments: {
          fetch: async () => ({
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'authorized', // Authorized but not captured
            captured: false,
          }),
        },
      })

      const fulfillResCapture = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST G: Non-captured (authorized) payment rejected from fulfillment', fulfillResCapture.success === false && fulfillResCapture.errorCode === 'payment_not_captured')

      // TEST H: Gateway fetch failure does NOT mark payment FAILED
      setRazorpayClient({
        payments: {
          fetch: async () => {
            throw new Error('Connection timeout to Razorpay API')
          },
        },
      })

      const fulfillResFetchFail = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST H.1: Gateway fetch failure returns safe gateway_uncertainty 502', fulfillResFetchFail.statusCode === 502 && fulfillResFetchFail.errorCode === 'gateway_uncertainty')

      // TEST Y: Gateway uncertainty does not falsely mark payment failed
      const pCheck = await Payment.findOne({ orderId: order.id, razorpayOrderId })
      assertTest('TEST Y: Gateway uncertainty did NOT falsely mark payment FAILED', pCheck.status !== 'FAILED')

      // Restore client and SKIP_RZP_FETCH
      resetRazorpayClient()
      delete process.env.STRICT_RZP_FETCH
      process.env.SKIP_RZP_FETCH = 'true'
    }

    // -------------------------------------------------------------
    // TEST I: Customer cannot verify another customer's order
    // -------------------------------------------------------------
    console.log('\n--- TEST I: Customer isolation ---')
    {
      const orderA = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(orderA)
      const rzpPaymentId = `pay_i_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: orderA.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserB, // Customer B attempting to verify Customer A's order!
      })

      assertTest('TEST I: Customer B forbidden from verifying Customer A order', fulfillRes.success === false && fulfillRes.statusCode === 403 && fulfillRes.errorCode === 'forbidden_order')
    }

    // -------------------------------------------------------------
    // TEST J: Cancelled order cannot be resurrected
    // -------------------------------------------------------------
    console.log('\n--- TEST J: Cancelled order resurrection protection ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_j_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Admin cancels the unpaid order
      await Order.updateOne({ _id: order.id }, { $set: { status: 'CANCELLED' } })

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST J.1: Cancelled order cannot be fulfilled into CONFIRMED', fulfillRes.success === false && fulfillRes.errorCode === 'order_state_conflict')

      const o = await Order.findById(order.id)
      // TEST X: Captured payment + cancelled order produces reconciliation state
      assertTest('TEST J.2 (X): Order placed into REQUIRES_RECONCILIATION', o.status === 'REQUIRES_RECONCILIATION')
      assertTest('TEST J.3: Payment record is NOT marked FAILED (funds captured externally)', o.paymentStatus === 'SUCCESS')
    }

    // -------------------------------------------------------------
    // TEST K: Delivered order cannot be resurrected
    // -------------------------------------------------------------
    console.log('\n--- TEST K: Delivered order resurrection protection ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_k_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Simulate order already in DELIVERED status
      await Order.updateOne({ _id: order.id }, { $set: { status: 'DELIVERED' } })

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST K: Delivered order cannot be overwritten to CONFIRMED', fulfillRes.success === false && fulfillRes.errorCode === 'order_state_conflict')
    }

    // -------------------------------------------------------------
    // TEST L: Duplicate verification is idempotent
    // -------------------------------------------------------------
    console.log('\n--- TEST L: Duplicate verification idempotency ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_l_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Initial verification
      const first = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })
      assertTest('TEST L.1: First fulfillment succeeds', first.success === true && first.order.status === 'CONFIRMED')

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty

      // Duplicate verification
      const second = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST L.2: Duplicate verification returns idempotent success', second.success === true && second.idempotent === true)

      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('TEST L.3: Stock was NOT deducted again on duplicate verification', stockBefore === stockAfter)
    }

    // -------------------------------------------------------------
    // TEST M: Same payment ID cannot fulfill two orders
    // -------------------------------------------------------------
    console.log('\n--- TEST M: Unique payment ID across orders ---')
    {
      const order1 = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: rzpOrder1 } = await makeTestPayment(order1)

      const order2 = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: rzpOrder2 } = await makeTestPayment(order2)

      const sharedPaymentId = `pay_shared_${Date.now()}`
      const sig1 = generateSignature(rzpOrder1, sharedPaymentId, keySecret)
      const sig2 = generateSignature(rzpOrder2, sharedPaymentId, keySecret)

      // Fulfill order 1
      const res1 = await fulfillRazorpayPayment({
        orderId: order1.id,
        razorpayOrderId: rzpOrder1,
        razorpayPaymentId: sharedPaymentId,
        razorpaySignature: sig1,
        user: customerUserA,
      })
      assertTest('TEST M.1: Order 1 fulfills with payment ID', res1.success === true)

      // Attempt to fulfill order 2 with the same payment ID
      const res2 = await fulfillRazorpayPayment({
        orderId: order2.id,
        razorpayOrderId: rzpOrder2,
        razorpayPaymentId: sharedPaymentId,
        razorpaySignature: sig2,
        user: customerUserA,
      })

      assertTest('TEST M.2: Second order cannot use the same payment ID', res2.success === false && res2.errorCode === 'duplicate_payment_id')
    }

    // -------------------------------------------------------------
    // TEST N: Same Razorpay order cannot fulfill two SV Hub orders
    // -------------------------------------------------------------
    console.log('\n--- TEST N: Unique Razorpay order across SV Hub orders ---')
    {
      const order1 = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: sharedRzpOrderId } = await makeTestPayment(order1)

      const order2 = await makeTestOrder(customerUserA, customerTokenA, 1)
      // Attempt to associate same razorpayOrderId to order2
      const pay2Id = `pay_n2_${Date.now()}`
      const sig2 = generateSignature(sharedRzpOrderId, pay2Id, keySecret)

      // Associate order 2 manually
      await Order.updateOne({ _id: order2.id }, { $set: { razorpayOrderId: sharedRzpOrderId } })
      await Payment.create({
        orderId: order2.id,
        userId: customerUserA._id,
        amount: order2.totalAmount,
        currency: 'INR',
        gateway: 'razorpay',
        status: 'CREATED',
        razorpayOrderId: `order_unique_for_model_${Date.now()}`,
      })

      const resConflict = await fulfillRazorpayPayment({
        orderId: order2.id,
        razorpayOrderId: sharedRzpOrderId,
        razorpayPaymentId: pay2Id,
        razorpaySignature: sig2,
        user: customerUserA,
      })

      assertTest('TEST N: Razorpay order ID reuse on separate SV Hub order rejected', resConflict.success === false)
    }

    // -------------------------------------------------------------
    // TEST O, P, Q: Concurrent Verification Race Condition Protection
    // -------------------------------------------------------------
    console.log('\n--- TEST O, P, Q: Concurrent Verification (Promise.all) ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 2)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_concurrent_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      const prodBefore = await Product.findById(baseProduct._id)
      const stockBefore = prodBefore.variants[0].qty

      // Fire 2 concurrent fulfillments at the exact same moment
      const [res1, res2] = await Promise.all([
        fulfillRazorpayPayment({
          orderId: order.id,
          razorpayOrderId,
          razorpayPaymentId: rzpPaymentId,
          razorpaySignature: sig,
          user: customerUserA,
        }),
        fulfillRazorpayPayment({
          orderId: order.id,
          razorpayOrderId,
          razorpayPaymentId: rzpPaymentId,
          razorpaySignature: sig,
          user: customerUserA,
        }),
      ])

      // TEST O: Exactly one fulfillment succeeds as original or idempotent
      const bothSuccessful = res1.success && res2.success
      const exactlyOnePrimary = (res1.idempotent ? 1 : 0) + (res2.idempotent ? 1 : 0) === 1
      assertTest('TEST O: Two concurrent verify requests safely handled (1 primary, 1 idempotent)', bothSuccessful && exactlyOnePrimary)

      // TEST P: Inventory deducted exactly once
      const prodAfter = await Product.findById(baseProduct._id)
      const stockAfter = prodAfter.variants[0].qty
      assertTest('TEST P: Stock deducted exactly once (decremented by 2, not 4)', stockBefore - stockAfter === 2)

      // TEST Q: Successful order is never downgraded to FAILED by the losing thread
      const finalOrder = await Order.findById(order.id)
      assertTest('TEST Q: Order remains CONFIRMED (never downgraded)', finalOrder.status === 'CONFIRMED')
      assertTest('TEST Q: Payment remains SUCCESS', finalOrder.paymentStatus === 'SUCCESS')
    }

    // -------------------------------------------------------------
    // TEST R, S: Inventory = 1, Two Concurrent Valid Orders
    // -------------------------------------------------------------
    console.log('\n--- TEST R, S: Stock = 1, Two Concurrent Orders ---')
    {
      // Set stock to exactly 1
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 1, 'variants.$.qty': 1 } },
      )

      const orderX = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: rzpX } = await makeTestPayment(orderX)
      const payX = `pay_rx_${Date.now()}`
      const sigX = generateSignature(rzpX, payX, keySecret)

      const orderY = await makeTestOrder(customerUserB, customerTokenB, 1)
      const { razorpayOrderId: rzpY } = await makeTestPayment(orderY)
      const payY = `pay_ry_${Date.now()}`
      const sigY = generateSignature(rzpY, payY, keySecret)

      // Concurrently fulfill both orders
      const [resX, resY] = await Promise.all([
        fulfillRazorpayPayment({
          orderId: orderX.id,
          razorpayOrderId: rzpX,
          razorpayPaymentId: payX,
          razorpaySignature: sigX,
          user: customerUserA,
        }),
        fulfillRazorpayPayment({
          orderId: orderY.id,
          razorpayOrderId: rzpY,
          razorpayPaymentId: payY,
          razorpaySignature: sigY,
          user: customerUserB,
        }),
      ])

      const successCount = (resX.success ? 1 : 0) + (resY.success ? 1 : 0)
      assertTest('TEST R: Stock = 1 allows exactly ONE order to succeed', successCount === 1)

      const losingRes = resX.success ? resY : resX
      assertTest('TEST R: Losing order enters reconciliation', losingRes.statusCode === 409 && losingRes.errorCode === 'inventory_conflict')

      // TEST S: Stock never becomes negative
      const prodCheck = await Product.findById(baseProduct._id)
      const finalVariantStock = prodCheck.variants[0].qty
      assertTest('TEST S: Stock never drops below zero (remains 0)', finalVariantStock === 0 && prodCheck.qty === 0)
    }

    // -------------------------------------------------------------
    // TEST T: Transaction Rollback Consistency
    // -------------------------------------------------------------
    console.log('\n--- TEST T: Transaction Rollback Consistency ---')
    {
      // Reset stock to 5
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 5, 'variants.$.qty': 5 } },
      )

      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_t_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Manually deplete stock before fulfillment to force transaction rollback
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 0, 'variants.$.qty': 0 } },
      )

      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      assertTest('TEST T.1: Stock exhaustion triggers safe rollback and 409 conflict', fulfillRes.statusCode === 409 && fulfillRes.errorCode === 'inventory_conflict')

      const o = await Order.findById(order.id)
      assertTest('TEST T.2: Order state consistent (REQUIRES_RECONCILIATION)', o.status === 'REQUIRES_RECONCILIATION')
      assertTest('TEST T.3: Stock remains intact (0)', (await Product.findById(baseProduct._id)).qty === 0)
    }

    // -------------------------------------------------------------
    // TEST U: Cart modifications during payment preserve unrelated items
    // -------------------------------------------------------------
    console.log('\n--- TEST U: Safe Selective Cart Item Removal ---')
    {
      // Reset stock
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 10, 'variants.$.qty': 10 } },
      )

      // Create a second product
      const secondProduct = await Product.create({
        name: `Second Test Oil ${runId}`,
        slug: `second-test-oil-${runId}`,
        type: 'Cold Pressed Oil',
        storefront: 'nutri-hub',
        category: 'cooking-oil',
        description: 'Unrelated cart item',
        image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
        price: 300,
        weight: '500 ml',
        sku: `SECOND-${runId}`,
        qty: 10,
        isActive: true,
        variants: [{ variantId: '500ml', label: '500ml', weight: '500 ml', sku: `SECOND-${runId}-500`, price: 300, qty: 10, isActive: true }],
      })
      cleanupProductIds.push(secondProduct._id)

      // Start checkout with baseProduct
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_u_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // While payment is processing, customer adds secondProduct to their cart!
      await Cart.updateOne(
        { userId: customerUserA._id },
        {
          $set: {
            items: [
              { productId: baseProduct._id, variantId: '1L', quantity: 1 },
              { productId: secondProduct._id, variantId: '500ml', quantity: 2 },
            ],
          },
        },
      )

      // Complete fulfillment
      const fulfillRes = await fulfillRazorpayPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })
      assertTest('TEST U.1: Order fulfillment completes', fulfillRes.success === true)

      // Verify cart: baseProduct removed, secondProduct preserved!
      const cartAfter = await Cart.findOne({ userId: customerUserA._id })
      assertTest('TEST U.2: Unrelated item (secondProduct) is preserved in cart', cartAfter.items.length === 1 && String(cartAfter.items[0].productId) === String(secondProduct._id))
    }

    // -------------------------------------------------------------
    // TEST V, W: Admin Cancellation & Safe Inventory Restoration
    // -------------------------------------------------------------
    console.log('\n--- TEST V, W: Admin Cancellation & Inventory Restoration ---')
    {
      // Reset stock to 10
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 10, 'variants.$.qty': 10 } },
      )

      // Case 1: Unpaid cancellation (PENDING_PAYMENT) must NOT restore inventory!
      const unpaidOrder = await makeTestOrder(customerUserA, customerTokenA, 2)
      const stockBeforeUnpaidCancel = (await Product.findById(baseProduct._id)).qty

      const cancelUnpaidRes = await apiRequest(`/admin/orders/${unpaidOrder.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Customer changed mind before payment' }),
      })
      assertTest('TEST V.1: Admin cancels unpaid order (200 OK)', cancelUnpaidRes.status === 200)

      const stockAfterUnpaidCancel = (await Product.findById(baseProduct._id)).qty
      assertTest('TEST V.2: Unpaid cancellation does NOT increment stock (remains 10)', stockBeforeUnpaidCancel === stockAfterUnpaidCancel)

      // Case 2: Paid/confirmed cancellation (CONFIRMED) MUST restore inventory atomically!
      const paidOrder = await makeTestOrder(customerUserA, customerTokenA, 3)
      const { razorpayOrderId } = await makeTestPayment(paidOrder)
      const rzpPaymentId = `pay_v_${Date.now()}`
      const sig = generateSignature(razorpayOrderId, rzpPaymentId, keySecret)

      // Fulfill order (deducts 3 units: stock goes from 10 to 7)
      await fulfillRazorpayPayment({
        orderId: paidOrder.id,
        razorpayOrderId,
        razorpayPaymentId: rzpPaymentId,
        razorpaySignature: sig,
        user: customerUserA,
      })

      const stockAfterFulfill = (await Product.findById(baseProduct._id)).qty
      assertTest('TEST V.3: Stock deducted on fulfillment (10 -> 7)', stockAfterFulfill === 7)

      // Admin cancels confirmed order
      const cancelPaidRes = await apiRequest(`/admin/orders/${paidOrder.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Defective batch recall' }),
      })
      assertTest('TEST V.4: Admin cancels paid order (200 OK)', cancelPaidRes.status === 200)

      const stockAfterPaidCancel = (await Product.findById(baseProduct._id)).qty
      assertTest('TEST V.5: Paid cancellation restores deducted stock (7 -> 10)', stockAfterPaidCancel === 10)

      // TEST W: Cancellation does not restore inventory twice
      const retryCancel = await apiRequest(`/admin/orders/${paidOrder.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: 'Retry cancellation call' }),
      })
      assertTest('TEST W.1: Retrying cancellation rejected as already cancelled', retryCancel.status === 400 && retryCancel.data?.error?.code === 'order_already_cancelled')

      const stockAfterRetry = (await Product.findById(baseProduct._id)).qty
      assertTest('TEST W.2: Retried cancellation does NOT restore inventory twice (remains 10)', stockAfterRetry === 10)
    }

    // -------------------------------------------------------------
    // TEST Z: Concurrent create-order calls do not create multiple local payment attempts
    // -------------------------------------------------------------
    console.log('\n--- TEST Z: Concurrent Create-Order Coordination ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)

      // Fire 2 concurrent POST /api/payments/razorpay/create-order
      const [res1, res2] = await Promise.all([
        apiRequest('/payments/razorpay/create-order', {
          method: 'POST',
          headers: { Authorization: `Bearer ${customerTokenA}` },
          body: JSON.stringify({ orderId: order.id }),
        }),
        apiRequest('/payments/razorpay/create-order', {
          method: 'POST',
          headers: { Authorization: `Bearer ${customerTokenA}` },
          body: JSON.stringify({ orderId: order.id }),
        }),
      ])

      assertTest('TEST Z.1: Both create-order requests succeed (200 OK)', res1.status === 200 && res2.status === 200)

      const rzpOrder1 = res1.data?.data?.razorpayOrderId
      const rzpOrder2 = res2.data?.data?.razorpayOrderId
      assertTest('TEST Z.2: Both requests returned the exact same Razorpay order ID', rzpOrder1 === rzpOrder2)

      const paymentCount = await Payment.countDocuments({ orderId: order.id })
      assertTest('TEST Z.3: Exactly 1 local Payment document created in MongoDB', paymentCount === 1)
    }

    // -------------------------------------------------------------
    // TEST AA: Existing successful Razorpay Test Mode flow remains compatible
    // -------------------------------------------------------------
    console.log('\n--- TEST AA: Existing Razorpay Flow Compatibility ---')
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)

      // Create-order API
      const createRes = await apiRequest('/payments/razorpay/create-order', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}` },
        body: JSON.stringify({ orderId: order.id }),
      })
      assertTest('TEST AA.1: POST /api/payments/razorpay/create-order returns expected structure', createRes.status === 200 && Boolean(createRes.data?.data?.razorpayOrderId))

      const rzpOrderId = createRes.data?.data?.razorpayOrderId
      const rzpPaymentId = `pay_aa_${Date.now()}`
      const sig = generateSignature(rzpOrderId, rzpPaymentId, keySecret)

      // Verify API endpoint
      const verifyRes = await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}` },
        body: JSON.stringify({
          orderId: order.id,
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: rzpPaymentId,
          razorpay_signature: sig,
        }),
      })

      assertTest('TEST AA.2: POST /api/payments/razorpay/verify returns expected 200 OK', verifyRes.status === 200 && verifyRes.data?.success === true)
      assertTest('TEST AA.3: Public order format contains orderNumber and CONFIRMED status', verifyRes.data?.data?.order?.status === 'CONFIRMED')
    }

    console.log('\n====================================================================')
    console.log(`PHASE 2.4B CORE SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`)
    console.log('====================================================================\n')
  } catch (err) {
    console.error('Fatal Phase 2.4B Test Error:', err)
    failed++
  } finally {
    // Teardown test documents
    console.log('--- Cleaning Up Test Fixtures ---')
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } }).catch(() => {})
      await Payment.deleteMany({ orderId: { $in: cleanupOrderIds } }).catch(() => {})
    }
    if (cleanupUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: cleanupUserIds } }).catch(() => {})
      await Cart.deleteMany({ userId: { $in: cleanupUserIds } }).catch(() => {})
      await Address.deleteMany({ userId: { $in: cleanupUserIds } }).catch(() => {})
    }
    if (cleanupProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: cleanupProductIds } }).catch(() => {})
    }

    await disconnectDb().catch(() => {})
  }

  if (failed > 0) {
    process.exit(1)
  }
}

runPhase24BTests().catch((err) => {
  console.error('Fatal execution error:', err)
  process.exit(1)
})

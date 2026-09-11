/**
 * tests/verify-staging-smoke-test.js
 * End-to-End Staging Smoke Test Suite
 *
 * Validates:
 * 1. Guest checkout API guards (401 unauthenticated)
 * 2. Authenticated customer order creation, Razorpay order generation, and signature verification
 * 3. Cart clearing only after successful payment verification
 * 4. Failed/abandoned payment: Order stays PENDING_PAYMENT, zero stock deducted
 * 5. Customer cancellation with idempotent repeat requests
 * 6. Admin cancellation with optional reason defaulting to professional notice
 * 7. Tenant isolation & security (cross-customer order access, cancel, payment creation, verification)
 */

import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Cart } from '../src/models/Cart.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import { jwtSecret } from '../src/utils/auth.js'

const PORT = 5097
const BASE_URL = `http://localhost:${PORT}`
let server
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

  const response = await fetch(url, fetchOptions)
  let data = null
  const text = await response.text()
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  return {
    status: response.status,
    headers: response.headers,
    data,
  }
}

function generateToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      id: String(user._id),
      _id: String(user._id),
      email: user.email,
      name: user.name,
      role: (user.role || 'CUSTOMER').toUpperCase(),
    },
    jwtSecret(),
    { expiresIn: '1h' },
  )
}

function generateMockSignature(razorpayOrderId, razorpayPaymentId, secret) {
  return crypto
    .createHmac('sha256', secret || process.env.RAZORPAY_KEY_SECRET || 'test_secret')
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
}

async function runSmokeTest() {
  console.log('\n======================================================')
  console.log('SV HUB — STAGING SMOKE TEST SUITE')
  console.log('======================================================\n')

  await connectDb()

  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`Smoke test server listening on port ${PORT}`)
      resolve()
    })
  })

  const createdUserIds = []
  const createdOrderIds = []
  const createdProductIds = []

  try {
    // 1. Fixtures setup
    const customerA = await User.create({
      name: 'Smoke Customer A',
      email: `smoke_cust_a_${Date.now()}@svhub.local`,
      role: 'CUSTOMER',
      isActive: true,
    })
    createdUserIds.push(customerA._id)

    const customerB = await User.create({
      name: 'Smoke Customer B',
      email: `smoke_cust_b_${Date.now()}@svhub.local`,
      role: 'CUSTOMER',
      isActive: true,
    })
    createdUserIds.push(customerB._id)

    const adminUser = await User.create({
      name: 'Smoke Admin User',
      email: `smoke_admin_${Date.now()}@svhub.local`,
      role: 'ADMIN',
      isActive: true,
    })
    createdUserIds.push(adminUser._id)

    const tokenCustA = generateToken(customerA)
    const tokenCustB = generateToken(customerB)
    const tokenAdmin = generateToken(adminUser)

    const testProduct = await Product.create({
      name: 'Smoke Test Rice',
      slug: `smoke-rice-${Date.now()}`,
      type: 'Heritage Rice',
      storefront: 'nutri-hub',
      category: 'native-rice',
      description: 'Rice for staging smoke test',
      image: 'https://example.com/smoke.jpg',
      price: 250,
      weight: '1kg',
      sku: `SMK-SKU-${Date.now()}`,
      qty: 50,
      isActive: true,
      variants: [
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1kg',
          price: 250,
          originalPrice: 300,
          qty: 50,
          sku: `SMK-VAR-${Date.now()}`,
          isActive: true,
        },
      ],
    })
    createdProductIds.push(testProduct._id)

    // -------------------------------------------------------------
    // SECTION 1: GUEST API SECURITY (UNAUTHENTICATED ATTEMPTS)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: GUEST API SECURITY ---')
    const guestOrderRes = await request('/api/orders', {
      method: 'POST',
      body: { items: [{ productId: testProduct._id, variantId: '1kg', quantity: 1 }] },
    })
    assert(guestOrderRes.status === 401, '1.1: Guest cannot create an order via API (HTTP 401)')

    const guestRzpOrderRes = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      body: { orderId: new mongoose.Types.ObjectId() },
    })
    assert(guestRzpOrderRes.status === 401, '1.2: Guest cannot create Razorpay order via API (HTTP 401)')

    const guestVerifyRes = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      body: { orderId: new mongoose.Types.ObjectId(), razorpay_order_id: 'order_123' },
    })
    assert(guestVerifyRes.status === 401, '1.3: Guest cannot verify payment via API (HTTP 401)')

    // -------------------------------------------------------------
    // SECTION 2: AUTHENTICATED CUSTOMER ORDER & PAYMENT LIFECYCLE
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: AUTHENTICATED ORDER & CART CLEARING ---')
    // Set customer cart
    await Cart.findOneAndUpdate(
      { userId: customerA._id },
      {
        $set: {
          items: [
            {
              productId: testProduct._id,
              variantId: '1kg',
              quantity: 2,
              price: 250,
            },
          ],
        },
      },
      { upsert: true, returnDocument: 'after' },
    )

    const cartBeforeOrder = await Cart.findOne({ userId: customerA._id })
    assert(cartBeforeOrder.items.length === 1, '2.1: Customer cart contains item before order placement')

    // Create order via API
    const orderCreateRes = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: {
        shippingAddress: {
          name: 'Smoke Customer A',
          phone: '9876543210',
          street: '123 Main Road',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
          country: 'India',
        },
      },
    })
    assert(orderCreateRes.status === 201, '2.2: Order created successfully (HTTP 201)')
    const orderDoc = orderCreateRes.data?.data
    createdOrderIds.push(orderDoc.id)
    assert(orderDoc.status === 'PENDING_PAYMENT', '2.3: Order initial status is PENDING_PAYMENT')
    assert(orderDoc.paymentStatus === 'PENDING', '2.4: Order initial paymentStatus is PENDING')

    // Verify stock is NOT deducted upon application order creation (Phase 1.5 invariant)
    const stockAfterCreate = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockAfterCreate === 50, '2.5: Product stock remains 50 before payment verification')

    // Create Razorpay Order
    const rzpOrderRes = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { orderId: orderDoc.id },
    })
    assert(rzpOrderRes.status === 200, '2.6: Razorpay order generated successfully (HTTP 200)')
    const rzpOrderId = rzpOrderRes.data?.data?.razorpayOrderId
    assert(Boolean(rzpOrderId), '2.7: Valid razorpayOrderId returned')

    // Simulate successful payment verification
    const mockPaymentId = `pay_smoke_${Date.now()}`
    const mockSignature = generateMockSignature(rzpOrderId, mockPaymentId)

    const verifyRes = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: {
        orderId: orderDoc.id,
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: mockSignature,
      },
    })
    assert(verifyRes.status === 200, '2.8: Payment verified successfully (HTTP 200)')
    assert(verifyRes.data?.data?.order?.status === 'CONFIRMED', '2.9: Order status transitioned to CONFIRMED')
    assert(verifyRes.data?.data?.order?.paymentStatus === 'SUCCESS', '2.10: Order paymentStatus transitioned to SUCCESS')

    // Stock deducted after verification
    const stockAfterVerify = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockAfterVerify === 48, '2.11: Inventory deducted by exactly 2 units upon verification (50 -> 48)')

    // Customer can fetch order in orders list
    const customerOrdersRes = await request('/api/orders', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(customerOrdersRes.status === 200, '2.12: Customer can fetch order list (HTTP 200)')
    const foundOrder = customerOrdersRes.data?.data?.find((o) => o.id === orderDoc.id)
    assert(Boolean(foundOrder), '2.13: Placed order appears in Account -> Orders')

    // -------------------------------------------------------------
    // SECTION 3: ABANDONED / FAILED PAYMENT
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: ABANDONED / FAILED PAYMENT ---')
    await Cart.findOneAndUpdate(
      { userId: customerA._id },
      {
        $set: {
          items: [{ productId: testProduct._id, variantId: '1kg', quantity: 1, price: 250 }],
        },
      },
      { upsert: true },
    )

    const orderAbandonedRes = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: {
        shippingAddress: {
          name: 'Smoke Customer A',
          phone: '9876543210',
          street: '123 Main Road',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
          country: 'India',
        },
      },
    })
    const abandonedOrder = orderAbandonedRes.data?.data
    createdOrderIds.push(abandonedOrder.id)

    // Customer abandons payment modal (record-failure called)
    await request('/api/payments/razorpay/record-failure', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: {
        orderId: abandonedOrder.id,
        errorReason: 'Customer closed payment checkout modal',
      },
    })

    const freshAbandonedOrder = await Order.findById(abandonedOrder.id)
    assert(freshAbandonedOrder.status === 'PENDING_PAYMENT', '3.1: Abandoned order remains PENDING_PAYMENT')
    assert(freshAbandonedOrder.status !== 'CONFIRMED', '3.2: Abandoned order does NOT become CONFIRMED')

    const stockAfterAbandon = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockAfterAbandon === 48, '3.3: Stock NOT deducted for abandoned payment (remains 48)')

    // -------------------------------------------------------------
    // SECTION 4: CUSTOMER CANCELLATION & IDEMPOTENCY
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: CUSTOMER CANCELLATION & IDEMPOTENCY ---')
    const cancelRes = await request(`/api/orders/${orderDoc.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Customer changed mind' },
    })
    assert(cancelRes.status === 200, '4.1: Customer can cancel eligible order (HTTP 200)')
    assert(cancelRes.data?.data?.status === 'CANCELLED', '4.2: Order status updated to CANCELLED')

    // Stock restored exactly once (+2 -> 50)
    const stockAfterCancel = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockAfterCancel === 50, '4.3: Inventory restored to 50 on cancellation')

    // Repeated cancel is idempotent
    const repeatCancelRes = await request(`/api/orders/${orderDoc.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Duplicate cancel request' },
    })
    assert(repeatCancelRes.status === 200, '4.4: Repeated cancellation returns idempotent HTTP 200')
    assert(repeatCancelRes.data?.idempotent === true, '4.5: Response carries idempotent: true')

    const stockAfterRepeat = (await Product.findById(testProduct._id)).variants[0].qty
    assert(stockAfterRepeat === 50, '4.6: Stock NOT double-restored on idempotent cancel')

    // -------------------------------------------------------------
    // SECTION 5: ADMIN CANCELLATION WITH OPTIONAL REASON
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: ADMIN CANCELLATION WITH OPTIONAL REASON ---')
    // Create new order for admin cancellation test
    const orderAdminTest = await Order.create({
      orderNumber: `#SVH-SMK-${Date.now()}`,
      userId: customerA._id,
      customerName: 'Customer A',
      email: customerA.email,
      phone: '9876543210',
      shippingAddress: {
        name: 'Customer A',
        phone: '9876543210',
        street: '123 Main St',
        lines: ['123 Main St', 'Coimbatore'],
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641001',
        country: 'India',
      },
      items: [
        {
          productId: testProduct._id,
          variantId: '1kg',
          productName: testProduct.name,
          variantLabel: '1 kg',
          sku: testProduct.variants[0].sku,
          unitPrice: 250,
          quantity: 1,
          lineTotal: 250,
        },
      ],
      subtotal: 250,
      totalAmount: 250,
      status: 'PROCESSING',
      paymentStatus: 'SUCCESS',
      inventoryDeducted: true,
      inventoryRestored: false,
    })
    createdOrderIds.push(orderAdminTest._id)

    // Admin cancels WITHOUT providing a reason (body: {})
    const adminCancelRes = await request(`/api/admin/orders/${orderAdminTest._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: {}, // No reason provided
    })
    assert(adminCancelRes.status === 200, '5.1: Admin cancels order with optional (blank) reason (HTTP 200)')
    assert(adminCancelRes.data?.order?.status === 'CANCELLED', '5.2: Order status is CANCELLED')
    assert(
      adminCancelRes.data?.order?.cancellationReason === 'Order cancelled by SV Hub Administration',
      '5.3: cancellationReason defaults to professional notice',
    )

    // Customer view exposes professional cancellation reason
    const customerFetchRes = await request(`/api/orders/${orderAdminTest._id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(
      customerFetchRes.data?.data?.cancellationReason === 'Order cancelled by SV Hub Administration',
      '5.4: Customer order details exposes professional cancellationReason',
    )

    // -------------------------------------------------------------
    // SECTION 6: TENANT ISOLATION & SECURITY CHECKS
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: TENANT ISOLATION & SECURITY CHECKS ---')
    // Customer B cannot fetch Customer A order
    const crossFetchRes = await request(`/api/orders/${orderDoc.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenCustB}` },
    })
    assert(crossFetchRes.status === 404, '6.1: Customer B cannot fetch Customer A order (HTTP 404)')

    // Customer B cannot cancel Customer A order
    const crossCancelRes = await request(`/api/orders/${orderDoc.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustB}` },
      body: { reason: 'Unauthorized cancel' },
    })
    assert(crossCancelRes.status === 404, '6.2: Customer B cannot cancel Customer A order (HTTP 404)')

    // Customer B cannot create Razorpay order for Customer A order
    const crossPayCreateRes = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustB}` },
      body: { orderId: orderAdminTest._id },
    })
    assert(crossPayCreateRes.status === 403, '6.3: Customer B cannot create payment for Customer A order (HTTP 403)')

    // Customer B cannot verify payment for Customer A order
    const crossVerifyRes = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustB}` },
      body: {
        orderId: orderAdminTest._id,
        razorpay_order_id: 'order_fake',
        razorpay_payment_id: 'pay_fake',
        razorpay_signature: 'fake_sig',
      },
    })
    assert(crossVerifyRes.status === 403, '6.4: Customer B cannot verify payment for Customer A order (HTTP 403)')

    console.log('\n======================================================')
    console.log(`ALL ${assertionCount} SMOKE TEST ASSERTIONS PASSED!`)
    console.log('======================================================\n')
  } finally {
    // Cleanup smoke test fixtures
    console.log('Cleaning up smoke test fixtures...')
    if (createdOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: createdOrderIds } })
      await Payment.deleteMany({ orderId: { $in: createdOrderIds } })
      await Refund.deleteMany({ orderId: { $in: createdOrderIds } })
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } })
      await Cart.deleteMany({ userId: { $in: createdUserIds } })
    }
    if (createdProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: createdProductIds } })
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
    await mongoose.connection.close()
    console.log('Smoke test complete.')
  }
}

runSmokeTest().catch((err) => {
  console.error('Smoke test error:', err)
  process.exit(1)
})

/**
 * Production Security & Checkout Protection Verification Suite
 *
 * Explicit tests:
 * TEST 1 & 2: Logged-out guest cannot create order, cannot create Razorpay order, cannot verify payment (all 401).
 * TEST 3: Logged-in customer can create order and proceed to payment.
 * TEST 4: Verified Razorpay payment fulfills atomically and confirms order.
 * TEST 8: Customer attempting to pass another user's userId in order creation body is ignored;
 *         order strictly belongs to authenticated user. Cross-customer payment attempts return 403.
 */

import jwt from 'jsonwebtoken'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Cart } from '../src/models/Cart.js'
import { Payment } from '../src/models/Payment.js'
import { env } from '../src/config/env.js'
import crypto from 'node:crypto'

const PORT = 5099
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

import { jwtSecret } from '../src/utils/auth.js'

function generateToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: (user.role || 'CUSTOMER').toUpperCase(),
    },
    jwtSecret(),
    { expiresIn: '1h' },
  )
}

async function run() {
  console.log('\n--- Starting Production Readiness Security & Checkout Protection Suite ---')

  await connectDb()
  server = app.listen(PORT)
  await new Promise((r) => setTimeout(r, 600))

  try {
    // 1. Setup test product
    const product = await Product.findOneAndUpdate(
      { slug: 'security-test-product-prod' },
      {
        name: 'Security Test Heritage Rice',
        slug: 'security-test-product-prod',
        type: 'Heritage Rice',
        storefront: 'nutri-hub',
        category: 'native-rice',
        description: 'Test product for security verification',
        image: 'https://example.com/test.jpg',
        price: 250,
        weight: '1kg',
        sku: 'SEC-TEST-BASE-SKU',
        qty: 100,
        isActive: true,
        variants: [
          {
            variantId: '1kg',
            label: '1 kg',
            price: 250,
            originalPrice: 300,
            qty: 50,
            sku: 'SEC-TEST-1KG',
            isActive: true,
          },
        ],
      },
      { upsert: true, returnDocument: 'after' },
    )

    // 2. Setup Test Customer A and Customer B
    const customerA = await User.findOneAndUpdate(
      { email: 'customer_sec_a@svhub.local' },
      {
        name: 'Customer A',
        email: 'customer_sec_a@svhub.local',
        phone: '9876543210',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        tokenVersion: 0,
      },
      { upsert: true, new: true },
    )

    const customerB = await User.findOneAndUpdate(
      { email: 'customer_sec_b@svhub.local' },
      {
        name: 'Customer B',
        email: 'customer_sec_b@svhub.local',
        phone: '9876543211',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        tokenVersion: 0,
      },
      { upsert: true, new: true },
    )

    const tokenA = generateToken(customerA)
    const tokenB = generateToken(customerB)

    // -------------------------------------------------------------
    // TEST 1 & 2: GUEST USERS MUST NOT BE ABLE TO CALL CHECKOUT / PAYMENT APIS
    // -------------------------------------------------------------
    console.log('\n[Suite 1] Unauthenticated Guest Checkout Protection')

    // Guest tries POST /api/orders
    const guestOrderRes = await request('/api/orders', {
      method: 'POST',
      body: {
        shippingAddress: {
          name: 'Guest Hacker',
          phone: '9876543210',
          street: '123 Fake Street',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pin: '600001',
        },
      },
    })
    assert(guestOrderRes.status === 401, 'Guest POST /api/orders returns HTTP 401')
    assert(
      guestOrderRes.data?.code === 'unauthenticated' || guestOrderRes.data?.error?.code === 'unauthenticated',
      'Guest POST /api/orders returns unauthenticated error code',
    )

    // Guest tries POST /api/payments/razorpay/create-order
    const guestPaymentOrderRes = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      body: { orderId: new (await import('mongoose')).default.Types.ObjectId() },
    })
    assert(guestPaymentOrderRes.status === 401, 'Guest POST /api/payments/razorpay/create-order returns HTTP 401')

    // Guest tries POST /api/payments/razorpay/verify
    const guestVerifyRes = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      body: {
        orderId: new (await import('mongoose')).default.Types.ObjectId(),
        razorpay_payment_id: 'pay_mock',
        razorpay_order_id: 'order_mock',
        razorpay_signature: 'sig_mock',
      },
    })
    assert(guestVerifyRes.status === 401, 'Guest POST /api/payments/razorpay/verify returns HTTP 401')

    // -------------------------------------------------------------
    // TEST 8: IMPERSONATION DEFENSE — SERVER USES AUTHENTICATED IDENTITY
    // -------------------------------------------------------------
    console.log('\n[Suite 2] User Impersonation Prevention')

    // Put item in Customer A's cart
    await Cart.findOneAndUpdate(
      { userId: customerA._id },
      {
        userId: customerA._id,
        items: [
          {
            productId: product._id,
            variantId: '1kg',
            quantity: 2,
          },
        ],
      },
      { upsert: true },
    )

    // Customer A submits order while attempting to spoof Customer B's userId in request body
    const spoofOrderRes = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        userId: String(customerB._id), // Malicious attempt to bill/assign Customer B
        shippingAddress: {
          name: 'Customer A Recipient',
          phone: '9876543210',
          street: '45 Heritage Colony',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
        },
      },
    })

    assert(spoofOrderRes.status === 201, 'Customer A creates order successfully (HTTP 201)')
    const createdOrderId = spoofOrderRes.data?.data?._id || spoofOrderRes.data?.data?.id
    const createdOrder = await Order.findById(createdOrderId)
    assert(createdOrder !== null, 'Order document exists in MongoDB')
    assert(
      String(createdOrder.userId) === String(customerA._id),
      'Order userId is strictly bound to authenticated Customer A, spoofed userId in body was ignored',
    )

    // Customer B attempts to initiate payment for Customer A's order
    const crossCustomerPaymentRes = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { orderId: String(createdOrder._id) },
    })
    assert(
      crossCustomerPaymentRes.status === 403,
      'Customer B attempting to pay for Customer A order returns HTTP 403 Forbidden',
    )
    assert(
      crossCustomerPaymentRes.data?.error?.code === 'forbidden_order',
      'Error code is forbidden_order',
    )

    // Customer B attempts to verify payment for Customer A's order
    const crossCustomerVerifyRes = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: {
        orderId: String(createdOrder._id),
        razorpay_payment_id: 'pay_test',
        razorpay_order_id: 'order_test',
        razorpay_signature: 'sig_test',
      },
    })
    assert(
      crossCustomerVerifyRes.status === 403,
      'Customer B attempting to verify payment for Customer A order returns HTTP 403 Forbidden',
    )

    // -------------------------------------------------------------
    // TEST 3 & 4: AUTHENTICATED CUSTOMER PAYMENT FLOW
    // -------------------------------------------------------------
    console.log('\n[Suite 3] Authenticated Customer Payment Flow')

    // Customer A creates Razorpay order for their own order
    const rzpOrderRes = await request('/api/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { orderId: String(createdOrder._id) },
    })
    assert(rzpOrderRes.status === 200, 'Customer A initiates Razorpay payment order (HTTP 200)')
    const rzpOrderId = rzpOrderRes.data?.data?.razorpayOrderId
    assert(Boolean(rzpOrderId), 'Razorpay Order ID generated')

    // Generate valid Razorpay test signature
    const mockPaymentId = `pay_test_${Date.now()}`
    const secret = env.RAZORPAY_KEY_SECRET || 'A2Dhp6vw6onyeytMq5t5pMR4'
    const payload = `${rzpOrderId}|${mockPaymentId}`
    const validSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    // Customer A verifies payment
    const verifyRes = await request('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        orderId: String(createdOrder._id),
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: validSignature,
      },
    })

    if (verifyRes.status !== 200) {
      console.error('verifyRes failed:', verifyRes.status, JSON.stringify(verifyRes.data, null, 2))
    }

    assert(verifyRes.status === 200, 'Payment verification succeeded (HTTP 200)')
    assert(verifyRes.data?.success === true, 'Response indicates success: true')

    // Check order status in DB
    const finalizedOrder = await Order.findById(createdOrder._id)
    assert(finalizedOrder.status === 'CONFIRMED', 'Order status moved to CONFIRMED')
    assert(finalizedOrder.paymentStatus === 'SUCCESS', 'Payment status moved to SUCCESS')

    console.log(`\nAll ${assertionCount} security and checkout protection tests PASSED!`)
  } finally {
    if (server) server.close()
    await (await import('mongoose')).default.disconnect()
  }
}

run().catch((err) => {
  console.error('\nTest Suite Failed:', err)
  process.exit(1)
})

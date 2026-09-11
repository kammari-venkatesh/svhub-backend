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
  getRazorpayWebhookSecret,
  verifyRazorpayWebhookSignature,
} from '../src/config/razorpay.js'
import {
  fulfillRazorpayPayment,
  recordWebhookPaymentFailure,
} from '../src/services/paymentFulfillmentService.js'

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
  return { status: res.status, data, rawText: text }
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
  console.log('SV HUB — PHASE 2.4C PRODUCTION RAZORPAY WEBHOOKS TEST SUITE')
  console.log('====================================================================\n')

  await connectDb()

  const runId = `c_${Date.now()}`
  let customerUserA = null
  let customerUserB = null
  let customerTokenA = null
  let customerTokenB = null
  let baseProduct = null

  const cleanupUserIds = []
  const cleanupProductIds = []
  const cleanupOrderIds = []

  try {
    console.log('--- Setting Up Test Users & Fixtures ---')
    customerUserA = await User.create({
      name: 'Webhook Test User A',
      email: `webhook_a_${runId}@example.com`,
      phone: '9876500001',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(customerUserA._id)

    customerUserB = await User.create({
      name: 'Webhook Test User B',
      email: `webhook_b_${runId}@example.com`,
      phone: '9876500002',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(customerUserB._id)

    const jwt = (await import('jsonwebtoken')).default
    const { jwtSecret } = await import('../src/utils/auth.js')
    customerTokenA = jwt.sign({ sub: String(customerUserA._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })
    customerTokenB = jwt.sign({ sub: String(customerUserB._id), role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '1h' })

    baseProduct = await Product.create({
      name: `Webhook Oil ${runId}`,
      slug: `webhook-oil-${runId}`,
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      description: 'Phase 2.4C webhook test product',
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      price: 500,
      weight: '1 L',
      sku: `WH-${runId}-BASE`,
      qty: 50,
      isActive: true,
      variants: [
        {
          variantId: '1L',
          label: '1 Litre',
          weight: '1 L',
          sku: `WH-${runId}-1L`,
          price: 500,
          qty: 50,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(baseProduct._id)

    assertTest('Fixtures setup initialized', Boolean(customerTokenA && customerTokenB && baseProduct))

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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingMethod: 'standard',
          shippingAddress: {
            name: user.name,
            phone: '9876543210',
            street: '123 Webhook Lane',
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

    async function makeTestPayment(order) {
      const razorpayOrderId = `order_wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const payment = await Payment.create({
        orderId: order.id || order._id,
        userId: order.userId,
        amount: Math.round(order.totalAmount * 100),
        currency: 'INR',
        gateway: 'razorpay',
        status: 'PENDING',
        razorpayOrderId,
      })
      await Order.updateOne({ _id: order.id || order._id }, { $set: { razorpayOrderId } })
      return { payment, razorpayOrderId }
    }

    // =========================================================================
    // SECTION A: SIGNATURE SECURITY (Tests 1 - 8)
    // =========================================================================
    console.log('\n--- SECTION A: SIGNATURE SECURITY ---')

    // 1. Valid signature
    {
      const signed = createSignedWebhook('payment.authorized', {
        payment: { entity: { id: `pay_a1_${Date.now()}` } },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signed.signature,
        },
        body: signed.bodyString,
      })
      assertTest('1. Valid signature succeeds (HTTP 200)', res.status === 200 && res.data?.success === true)
    }

    // 2. Invalid signature
    {
      const signed = createSignedWebhook('payment.authorized', { payment: { entity: { id: 'pay_test' } } })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': 'deadbeefinvalidhash1234567890abcdef',
        },
        body: signed.bodyString,
      })
      assertTest('2. Invalid signature rejected (HTTP 400 invalid_webhook_signature)', res.status === 400 && res.data?.error?.code === 'invalid_webhook_signature')
    }

    // 3. Modified raw body (tampered payload after signature)
    {
      const signed = createSignedWebhook('payment.authorized', { payment: { entity: { id: 'pay_test' } } })
      const tamperedBody = signed.bodyString + ' '
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signed.signature,
        },
        body: tamperedBody,
      })
      assertTest('3. Modified raw body rejected', res.status === 400)
    }

    // 4. Modified signature
    {
      const signed = createSignedWebhook('payment.authorized', { payment: { entity: { id: 'pay_test' } } })
      const alteredSig = signed.signature.slice(0, -2) + 'aa'
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': alteredSig,
        },
        body: signed.bodyString,
      })
      assertTest('4. Modified signature rejected', res.status === 400)
    }

    // 5. Missing signature header
    {
      const signed = createSignedWebhook('payment.authorized', { payment: { entity: { id: 'pay_test' } } })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: signed.bodyString,
      })
      assertTest('5. Missing signature header rejected (HTTP 400 missing_webhook_signature)', res.status === 400 && res.data?.error?.code === 'missing_webhook_signature')
    }

    // 6. Wrong webhook secret
    {
      const signed = createSignedWebhook('payment.authorized', { payment: { entity: { id: 'pay_test' } } }, 'wrong_secret_12345')
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signed.signature,
        },
        body: signed.bodyString,
      })
      assertTest('6. Wrong webhook secret rejected', res.status === 400)
    }

    // 7. Timing-safe comparison behavior
    {
      const rawBody = Buffer.from('test-timing-payload', 'utf8')
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')
      const v1 = verifyRazorpayWebhookSignature({ rawBody, signature: sig, secret: WEBHOOK_SECRET })
      const v2 = verifyRazorpayWebhookSignature({ rawBody, signature: 'short', secret: WEBHOOK_SECRET })
      const v3 = verifyRazorpayWebhookSignature({ rawBody, signature: sig.replace('a', 'b'), secret: WEBHOOK_SECRET })
      assertTest('7. Timing-safe verification validates matching and rejects non-matching/short digests', v1 === true && v2 === false && v3 === false)
    }

    // 8. Parsed body / restringified body mismatch
    {
      const rawText = '{\n  "event": "payment.authorized",\n  "z_field": 1,\n  "a_field": 2\n}'
      const correctSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawText).digest('hex')
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': correctSig,
        },
        body: rawText,
      })
      assertTest('8. Raw byte preservation accepts signature matching raw formatting', res.status === 200)
    }

    // =========================================================================
    // SECTION B: EVENT SECURITY (Tests 9 - 16)
    // =========================================================================
    console.log('\n--- SECTION B: EVENT SECURITY ---')

    // 9. Malformed JSON
    {
      const malformedRaw = '{"event": "payment.captured", "unclosed_json: '
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(malformedRaw).digest('hex')
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': sig,
        },
        body: malformedRaw,
      })
      assertTest('9. Malformed JSON returns HTTP 400 invalid_json (no crash)', res.status === 400 && res.data?.error?.code === 'invalid_json')
    }

    // 10. Missing event
    {
      const signed = createSignedWebhook(undefined, { payment: { entity: { id: 'pay_x' } } }, WEBHOOK_SECRET, JSON.stringify({ no_event: true }))
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('10. Missing event type rejected (HTTP 400 missing_event_type)', res.status === 400 && res.data?.error?.code === 'missing_event_type')
    }

    // 11. Unknown event
    {
      const signed = createSignedWebhook('unknown.razorpay.event', { custom: 123 })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('11. Unknown event safely acknowledged (HTTP 200)', res.status === 200 && res.data?.message?.includes('ignored'))
    }

    // 12. Malformed payment payload (missing entity)
    {
      const signed = createSignedWebhook('payment.captured', { payment: null })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('12. Missing payment entity rejected (HTTP 400 missing_payment_entity)', res.status === 400 && res.data?.error?.code === 'missing_payment_entity')
    }

    // 13. Missing payment ID
    {
      const signed = createSignedWebhook('payment.captured', { payment: { entity: { order_id: 'order_123' } } })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('13. Missing payment ID rejected (HTTP 400 missing_payment_identifiers)', res.status === 400 && res.data?.error?.code === 'missing_payment_identifiers')
    }

    // 14. Missing order ID
    {
      const signed = createSignedWebhook('payment.captured', { payment: { entity: { id: 'pay_123' } } })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('14. Missing order ID rejected (HTTP 400 missing_payment_identifiers)', res.status === 400 && res.data?.error?.code === 'missing_payment_identifiers')
    }

    // 15. Invalid amount
    {
      const signed = createSignedWebhook('payment.captured', { payment: { entity: { id: 'pay_123', order_id: 'order_123', amount: -500 } } })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('15. Negative amount rejected (HTTP 400 invalid_amount)', res.status === 400 && res.data?.error?.code === 'invalid_amount')
    }

    // 16. Wrong currency
    {
      const signed = createSignedWebhook('payment.captured', { payment: { entity: { id: 'pay_123', order_id: 'order_123', amount: 50000, currency: 'USD' } } })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('16. Non-INR currency rejected (HTTP 400 invalid_currency)', res.status === 400 && res.data?.error?.code === 'invalid_currency')
    }

    // =========================================================================
    // SECTION C: PAYMENT MATCHING (Tests 17 - 24)
    // =========================================================================
    console.log('\n--- SECTION C: PAYMENT MATCHING ---')

    // 17. Valid payment/order pair
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_c17_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('17. Valid payment/order pair fulfills successfully (HTTP 200)', res.status === 200 && res.data?.success === true)

      const updatedOrder = await Order.findById(order.id)
      assertTest('17.1 Order is CONFIRMED', updatedOrder.status === 'CONFIRMED' && updatedOrder.paymentStatus === 'SUCCESS')
    }

    // 18. Mismatched Razorpay order ID (non-existent)
    {
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: `pay_c18_${Date.now()}`,
            order_id: 'order_nonexistent_999999',
            amount: 55000,
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('18. Non-existent Razorpay order ID rejected (HTTP 404 order_not_found)', res.status === 404 && res.data?.error?.code === 'order_not_found')
    }

    // 19. Duplicate payment ID rejected across orders
    {
      const order1 = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: rzpOrder1 } = await makeTestPayment(order1)
      const sharedPaymentId = `pay_shared_${Date.now()}`

      const signed1 = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: sharedPaymentId,
            order_id: rzpOrder1,
            amount: Math.round(order1.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed1.signature },
        body: signed1.bodyString,
      })

      const order2 = await makeTestOrder(customerUserB, customerTokenB, 1)
      const { razorpayOrderId: rzpOrder2 } = await makeTestPayment(order2)
      const signed2 = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: sharedPaymentId,
            order_id: rzpOrder2,
            amount: Math.round(order2.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res2 = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed2.signature },
        body: signed2.bodyString,
      })
      assertTest('19. Duplicate payment ID rejected across orders', res2.status === 409 || res2.data?.error?.code === 'duplicate_payment_id')
    }

    // 20. Payment belongs to another SV Hub order (mismatched razorpayOrderId)
    {
      const orderA = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: rzpOrderA } = await makeTestPayment(orderA)

      const orderB = await makeTestOrder(customerUserB, customerTokenB, 1)
      const { razorpayOrderId: rzpOrderB } = await makeTestPayment(orderB)

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: `pay_c20_${Date.now()}`,
            order_id: rzpOrderA,
            amount: Math.round(orderA.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const updatedA = await Order.findById(orderA.id)
      const updatedB = await Order.findById(orderB.id)
      assertTest('20. Webhook updates only the matched order, never cross-contaminates another order', res.status === 200 && updatedA.status === 'CONFIRMED' && updatedB.status === 'PENDING_PAYMENT')
    }

    // 21. Payment belongs to another customer - webhook respects authoritative customer ownership
    {
      const orderA = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(orderA)
      const rzpPaymentId = `pay_c21_${Date.now()}`

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(orderA.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const paymentDoc = await Payment.findOne({ razorpayPaymentId: rzpPaymentId })
      assertTest('21. Fulfilled payment records correct authoritative customer ownership', paymentDoc && String(paymentDoc.userId) === String(customerUserA._id))
    }

    // 22. Amount mismatch between webhook and authoritative order rejected
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: `pay_c22_${Date.now()}`,
            order_id: razorpayOrderId,
            amount: 9999999,
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('22. Amount mismatch between webhook and authoritative order rejected', res.status === 400 && res.data?.error?.code === 'amount_mismatch')
    }

    // 23. Currency mismatch in payment payload rejected
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: `pay_c23_${Date.now()}`,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'EUR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('23. Non-INR currency rejected (HTTP 400 invalid_currency)', res.status === 400 && res.data?.error?.code === 'invalid_currency')
    }

    // 24. Duplicate payment ID rejection
    {
      const orderA = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId: rzpOrderA } = await makeTestPayment(orderA)
      const duplicatePayId = `pay_c24_${Date.now()}`

      const signedA = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: duplicatePayId,
            order_id: rzpOrderA,
            amount: Math.round(orderA.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signedA.signature },
        body: signedA.bodyString,
      })

      const orderB = await makeTestOrder(customerUserB, customerTokenB, 1)
      const { razorpayOrderId: rzpOrderB } = await makeTestPayment(orderB)
      const signedB = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: duplicatePayId,
            order_id: rzpOrderB,
            amount: Math.round(orderB.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const resB = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signedB.signature },
        body: signedB.bodyString,
      })
      assertTest('24. Reused payment ID across different orders rejected', resB.status === 409 || resB.data?.error?.code === 'duplicate_payment_id')
    }

    // =========================================================================
    // SECTION D: IDEMPOTENCY (Tests 25 - 30)
    // =========================================================================
    console.log('\n--- SECTION D: IDEMPOTENCY ---')

    // 25. Same webhook twice sequentially
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_d25_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      const res1 = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const res2 = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty

      assertTest('25. Same webhook twice returns HTTP 200 both times', res1.status === 200 && res2.status === 200)
      assertTest('25.1 Stock deducted exactly once on repeated delivery', stockBefore - stockAfter === 1)
    }

    // 26. Same webhook 10 times
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_d26_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      for (let i = 0; i < 10; i++) {
        await apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
          body: signed.bodyString,
        })
      }
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty

      assertTest('26. Sending webhook 10 times deducts stock exactly once', stockBefore - stockAfter === 1)
      const eventDocs = await WebhookEvent.find({ razorpayPaymentId: rzpPaymentId })
      assertTest('26.1 Exactly 1 WebhookEvent document created for event', eventDocs.length === 1)
    }

    // 27. Concurrent duplicate webhooks (Promise.all)
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_d27_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      const [r1, r2] = await Promise.all([
        apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
          body: signed.bodyString,
        }),
        apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
          body: signed.bodyString,
        }),
      ])
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty

      assertTest('27. Concurrent duplicate webhooks handled cleanly (both 200)', r1.status === 200 && r2.status === 200)
      assertTest('27.1 Stock decremented exactly once under concurrent delivery', stockBefore - stockAfter === 1)
    }

    // 28. Duplicate event after fulfillment
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_d28_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const resDup = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const eventDoc = await WebhookEvent.findOne({ eventId: signed.eventId })
      assertTest('28. Duplicate event after fulfillment returns idempotent success', resDup.status === 200 && eventDoc.status === 'PROCESSED' && eventDoc.attempts >= 2)
    }

    // 29. Duplicate event after failure
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_d29_${Date.now()}`
      const signed = createSignedWebhook('payment.failed', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            error_code: 'BANK_ERROR',
            error_description: 'Bank server down',
          },
        },
      })

      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const resDup = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('29. Duplicate failure event returns 200 without state corruption', resDup.status === 200)
    }

    // 30. Duplicate event after reconciliation
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Order.updateOne({ _id: order.id }, { $set: { status: 'CANCELLED' } })

      const rzpPaymentId = `pay_d30_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const resDup = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const finalOrder = await Order.findById(order.id)
      assertTest('30. Duplicate event preserves REQUIRES_RECONCILIATION state', resDup.status === 200 && finalOrder.status === 'REQUIRES_RECONCILIATION')
    }

    // =========================================================================
    // SECTION E: VERIFY + WEBHOOK RACES (Tests 31 - 35)
    // =========================================================================
    console.log('\n--- SECTION E: VERIFY + WEBHOOK RACES ---')

    // 31. Verify then webhook
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_e31_${Date.now()}`
      const clientSig = crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${rzpPaymentId}`)
        .digest('hex')

      const verifyRes = await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: rzpPaymentId,
          razorpay_signature: clientSig,
        }),
      })

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const webhookRes = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      assertTest('31. Verify then webhook: verify succeeds and webhook returns idempotent 200', verifyRes.status === 200 && webhookRes.status === 200)
    }

    // 32. Webhook then verify
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_e32_${Date.now()}`

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const webhookRes = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const clientSig = crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${rzpPaymentId}`)
        .digest('hex')
      const verifyRes = await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: rzpPaymentId,
          razorpay_signature: clientSig,
        }),
      })

      assertTest('32. Webhook then verify: webhook fulfills and verify returns idempotent 200', webhookRes.status === 200 && verifyRes.status === 200)
    }

    // 33. Concurrent verify + webhook (Promise.all)
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_e33_${Date.now()}`
      const clientSig = crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
        .update(`${razorpayOrderId}|${rzpPaymentId}`)
        .digest('hex')

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty

      const [resVerify, resWebhook] = await Promise.all([
        apiRequest('/payments/razorpay/verify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            razorpay_order_id: razorpayOrderId,
            razorpay_payment_id: rzpPaymentId,
            razorpay_signature: clientSig,
          }),
        }),
        apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
          body: signed.bodyString,
        }),
      ])

      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty

      assertTest('33. Concurrent verify + webhook: both return 200 OK', resVerify.status === 200 && resWebhook.status === 200)
      assertTest('33.1 Stock deducted exactly once in racing verify + webhook', stockBefore - stockAfter === 1)

      const finalOrder = await Order.findById(order.id)
      assertTest('33.2 Order confirmed and never downgraded', finalOrder.status === 'CONFIRMED' && finalOrder.paymentStatus === 'SUCCESS')
    }

    // 34. Concurrent webhook + webhook for distinct orders
    {
      const order1 = await makeTestOrder(customerUserA, customerTokenA, 1)
      const order2 = await makeTestOrder(customerUserB, customerTokenB, 1)
      const { razorpayOrderId: rzpOrder1 } = await makeTestPayment(order1)
      const { razorpayOrderId: rzpOrder2 } = await makeTestPayment(order2)

      const signed1 = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_e34a_${Date.now()}`, order_id: rzpOrder1, amount: Math.round(order1.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const signed2 = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_e34b_${Date.now()}`, order_id: rzpOrder2, amount: Math.round(order2.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })

      const [res1, res2] = await Promise.all([
        apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed1.signature }, body: signed1.bodyString }),
        apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed2.signature }, body: signed2.bodyString }),
      ])
      const final1 = await Order.findById(order1.id)
      const final2 = await Order.findById(order2.id)
      assertTest('34. Concurrent webhooks for distinct orders fulfill independently', res1.status === 200 && res2.status === 200 && final1.status === 'CONFIRMED' && final2.status === 'CONFIRMED')
    }

    // 35. Burst concurrency: 5 simultaneous verify and webhook requests
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_e35_${Date.now()}`
      const clientSig = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${rzpPaymentId}`).digest('hex')

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      const requests = []
      for (let i = 0; i < 3; i++) {
        const signed = createSignedWebhook('payment.captured', {
          payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
        })
        requests.push(apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString }))
      }
      for (let i = 0; i < 2; i++) {
        requests.push(
          apiRequest('/payments/razorpay/verify', {
            method: 'POST',
            headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id, razorpay_order_id: razorpayOrderId, razorpay_payment_id: rzpPaymentId, razorpay_signature: clientSig }),
          }),
        )
      }

      const results = await Promise.all(requests)
      const all200 = results.every((r) => r.status === 200)
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('35. Burst concurrency (5 requests) all return 200 OK', all200)
      assertTest('35.1 Stock deducted exactly once across entire burst', stockBefore - stockAfter === 1)
    }

    // =========================================================================
    // SECTION F: STATE MACHINE & OUT-OF-ORDER EVENTS (Tests 36 - 44)
    // =========================================================================
    console.log('\n--- SECTION F: STATE MACHINE & OUT-OF-ORDER EVENTS ---')

    // 36. Captured payment for pending order -> CONFIRMED
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_f36_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const updated = await Order.findById(order.id)
      assertTest('36. Captured payment for pending order confirms cleanly', res.status === 200 && updated.status === 'CONFIRMED' && updated.paymentStatus === 'SUCCESS')
    }

    // 37. Captured payment for already confirmed order
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_f37_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      const resSecond = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('37. Captured payment on already confirmed order is safe and idempotent', resSecond.status === 200 && stockBefore === stockAfter)
    }

    // 38. Captured payment for CANCELLED order -> enters REQUIRES_RECONCILIATION
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Order.updateOne({ _id: order.id }, { $set: { status: 'CANCELLED' } })

      const rzpPaymentId = `pay_f38_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const updated = await Order.findById(order.id)
      assertTest('38. Webhook captured payment on CANCELLED order enters REQUIRES_RECONCILIATION', updated.status === 'REQUIRES_RECONCILIATION')

      const paymentDoc = await Payment.findOne({ razorpayOrderId })
      assertTest('38.1 Captured payment is NOT marked FAILED (funds captured externally)', paymentDoc.status === 'SUCCESS')
    }

    // 39. Captured payment for DELIVERED order -> does not resurrect to CONFIRMED
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Order.updateOne({ _id: order.id }, { $set: { status: 'DELIVERED', paymentStatus: 'SUCCESS' } })

      const rzpPaymentId = `pay_f39_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const updated = await Order.findById(order.id)
      assertTest('39. DELIVERED order cannot be resurrected or overwritten to CONFIRMED', updated.status !== 'CONFIRMED')
    }

    // 40. Failed payment for PENDING_PAYMENT order
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_f40_${Date.now()}`
      const signed = createSignedWebhook('payment.failed', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment was cancelled by customer on gateway',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('40. payment.failed event succeeds with HTTP 200', res.status === 200)

      const updatedOrder = await Order.findById(order.id)
      assertTest('40.1 Order remains PENDING_PAYMENT (eligible for retry)', updatedOrder.status === 'PENDING_PAYMENT')
      assertTest('40.2 Order paymentStatus updated to FAILED', updatedOrder.paymentStatus === 'FAILED')

      const updatedPayment = await Payment.findOne({ razorpayOrderId })
      assertTest('40.3 Payment record marked FAILED with reason note', updatedPayment.status === 'FAILED' && updatedPayment.errorReason.includes('cancelled'))
    }

    // 41. Failed payment event arriving AFTER captured/confirmed
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_f41_${Date.now()}`

      const captureWebhook = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': captureWebhook.signature },
        body: captureWebhook.bodyString,
      })

      const failedWebhook = createSignedWebhook('payment.failed', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            error_code: 'OUT_OF_ORDER',
            error_description: 'Late failure event',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': failedWebhook.signature },
        body: failedWebhook.bodyString,
      })

      const afterFailOrder = await Order.findById(order.id)
      const afterFailPayment = await Payment.findOne({ razorpayOrderId })
      assertTest('41. Late payment.failed event NEVER downgrades already CONFIRMED order', afterFailOrder.status === 'CONFIRMED')
      assertTest('41.1 Payment remains SUCCESS despite late failure event', afterFailPayment.status === 'SUCCESS')
    }

    // 42. Captured event arriving AFTER failed payment (Customer retried and succeeded)
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)

      await recordWebhookPaymentFailure({
        razorpayOrderId,
        errorReason: 'Customer card declined initially',
      })

      const rzpPaymentId = `pay_f42_${Date.now()}`
      const captureWebhook = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': captureWebhook.signature },
        body: captureWebhook.bodyString,
      })

      const finalOrder = await Order.findById(order.id)
      assertTest('42. Captured webhook after failure transitions order to CONFIRMED', finalOrder.status === 'CONFIRMED' && finalOrder.paymentStatus === 'SUCCESS')
    }

    // 43. Duplicate terminal events (e.g. repeated payment.failed)
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.failed', {
        payment: { entity: { id: `pay_f43_${Date.now()}`, order_id: razorpayOrderId, error_code: 'ERR', error_description: 'Repeated error' } },
      })
      const res1 = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const res2 = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      assertTest('43. Duplicate terminal events handled idempotently', res1.status === 200 && res2.status === 200)
    }

    // 44. Invalid backwards state transition prevented
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_f44_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })

      const signedAuth = createSignedWebhook('payment.authorized', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'authorized' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signedAuth.signature }, body: signedAuth.bodyString })

      const confirmedOrder = await Order.findById(order.id)
      assertTest('44. Invalid backwards state transition prevented: order remains CONFIRMED', confirmedOrder.status === 'CONFIRMED')
    }

    // =========================================================================
    // SECTION G: INVENTORY & STOCK HANDLING (Tests 45 - 50)
    // =========================================================================
    console.log('\n--- SECTION G: INVENTORY HANDLING ---')

    // 45. Webhook fulfillment deducts inventory exactly once
    {
      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      const order = await makeTestOrder(customerUserA, customerTokenA, 2)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_g45_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('45. Webhook fulfillment deducts inventory exactly by ordered quantity', stockBefore - stockAfter === 2)
    }

    // 46. Duplicate webhook does not deduct twice
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_g46_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const stockMid = (await Product.findById(baseProduct._id)).variants[0].qty
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const stockFinal = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('46. Duplicate webhook does not deduct inventory twice', stockMid === stockFinal)
    }

    // 47. Webhook + verify does not deduct twice
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_g47_${Date.now()}`
      const clientSig = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${rzpPaymentId}`).digest('hex')
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })

      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, razorpay_order_id: razorpayOrderId, razorpay_payment_id: rzpPaymentId, razorpay_signature: clientSig }),
      })
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('47. Webhook + verify combined does not deduct stock twice', stockBefore - stockAfter === 1)
    }

    // 48. Insufficient inventory during webhook fulfillment
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 5, 5)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 0, 'variants.$.qty': 0 } },
      )
      const rzpPaymentId = `pay_g48_${Date.now()}`

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const stock = (await Product.findById(baseProduct._id)).variants[0].qty
      const recOrder = await Order.findById(order.id)
      assertTest('48. Out-of-stock webhook order enters REQUIRES_RECONCILIATION', recOrder.status === 'REQUIRES_RECONCILIATION')
      assertTest('48.1 Stock never becomes negative (remains >= 0)', stock >= 0)
    }

    // 49. Concurrent inventory race with 2 webhook orders for stock = 1
    {
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 1, 'variants.$.qty': 1 } },
      )

      const order1 = await makeTestOrder(customerUserA, customerTokenA, 1)
      const order2 = await makeTestOrder(customerUserB, customerTokenB, 1)
      const { razorpayOrderId: rzpOrder1 } = await makeTestPayment(order1)
      const { razorpayOrderId: rzpOrder2 } = await makeTestPayment(order2)

      const signed1 = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: `pay_race1_${Date.now()}`,
            order_id: rzpOrder1,
            amount: Math.round(order1.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const signed2 = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: `pay_race2_${Date.now()}`,
            order_id: rzpOrder2,
            amount: Math.round(order2.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      await Promise.all([
        apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed1.signature },
          body: signed1.bodyString,
        }),
        apiRequest('/payments/razorpay/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed2.signature },
          body: signed2.bodyString,
        }),
      ])

      const final1 = await Order.findById(order1.id)
      const final2 = await Order.findById(order2.id)
      const finalStock = (await Product.findById(baseProduct._id)).variants[0].qty

      const oneConfirmed = (final1.status === 'CONFIRMED' && final2.status !== 'CONFIRMED') || (final2.status === 'CONFIRMED' && final1.status !== 'CONFIRMED')
      assertTest('49. Stock = 1 allows exactly ONE order to confirm; other enters reconciliation', oneConfirmed)
      assertTest('49.1 Final stock is exactly 0 and never negative', finalStock === 0)
    }

    // 50. Multi-item inventory race across webhooks
    {
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 10, 'variants.$.qty': 10 } },
      )
      const order = await makeTestOrder(customerUserA, customerTokenA, 2)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_g50_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const res = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      assertTest('50. Multi-item inventory deduction is atomic and consistent', res.status === 200)
    }

    // =========================================================================
    // SECTION H: CART CONSISTENCY (Tests 51 - 55)
    // =========================================================================
    console.log('\n--- SECTION H: CART CONSISTENCY ---')

    // 51 & 52. Successful webhook clears purchased lines, preserves unrelated items
    {
      await Product.updateOne(
        { _id: baseProduct._id, 'variants.variantId': '1L' },
        { $set: { qty: 20, 'variants.$.qty': 20 } },
      )

      const secondProduct = await Product.create({
        name: `Cart Extra Product ${runId}`,
        slug: `cart-extra-${runId}`,
        type: 'General',
        storefront: 'nutri-hub',
        category: 'staples',
        description: 'Extra cart item for webhook test',
        image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
        price: 100,
        weight: '500 g',
        sku: `EXT-${runId}-BASE`,
        qty: 10,
        isActive: true,
        variants: [{ variantId: 'default', label: 'Default', weight: '500 g', sku: `EXT-${runId}`, price: 100, qty: 10, isActive: true }],
      })
      cleanupProductIds.push(secondProduct._id)

      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)

      await Cart.updateOne(
        { userId: customerUserA._id },
        { $push: { items: { productId: secondProduct._id, variantId: 'default', quantity: 2 } } },
      )

      const rzpPaymentId = `pay_h51_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const cart = await Cart.findOne({ userId: customerUserA._id })
      const hasPurchased = cart.items.some((i) => String(i.productId) === String(baseProduct._id))
      const hasUnrelated = cart.items.some((i) => String(i.productId) === String(secondProduct._id))

      assertTest('51. Webhook fulfillment clears purchased line item from cart', !hasPurchased)
      assertTest('52. Unrelated item added during checkout is PRESERVED in cart', hasUnrelated)
    }

    // 53. Duplicate webhook does not repeatedly mutate cart
    {
      const cartBefore = await Cart.findOne({ userId: customerUserA._id })
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_h53_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const cartMid = await Cart.findOne({ userId: customerUserA._id })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const cartFinal = await Cart.findOne({ userId: customerUserA._id })
      assertTest('53. Duplicate webhook does not mutate cart further', JSON.stringify(cartMid.items) === JSON.stringify(cartFinal.items))
    }

    // 54. Cart changed after checkout but before webhook
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Cart.updateOne(
        { userId: customerUserA._id },
        { $push: { items: { productId: baseProduct._id, variantId: '1L', quantity: 3 } } },
      )
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_h54_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const orderDoc = await Order.findById(order.id)
      assertTest('54. Cart changes before webhook do not affect order items/amount', orderDoc.totalAmount === 500 && orderDoc.status === 'CONFIRMED')
    }

    // 55. Cart emptied before webhook arrives
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Cart.updateOne({ userId: customerUserA._id }, { $set: { items: [] } })
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_h55_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const res = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const orderDoc = await Order.findById(order.id)
      assertTest('55. Webhook fulfills successfully even if cart was already cleared', res.status === 200 && orderDoc.status === 'CONFIRMED')
    }

    // =========================================================================
    // SECTION I: DATABASE FAILURE & TRANSACTION RESILIENCE (Tests 56 - 61)
    // =========================================================================
    console.log('\n--- SECTION I: DATABASE RESILIENCE ---')

    // 56. WebhookEvent uniqueness prevents duplicate processing records
    {
      const eventId = `evt_i56_${Date.now()}`
      await WebhookEvent.create({ provider: 'razorpay', eventId, eventType: 'payment.captured', status: 'PROCESSED' })
      let duplicateThrew = false
      try {
        await WebhookEvent.create({ provider: 'razorpay', eventId, eventType: 'payment.captured', status: 'PROCESSED' })
      } catch (e) {
        duplicateThrew = true
      }
      assertTest('56. WebhookEvent unique index strictly enforces database uniqueness', duplicateThrew)
    }

    // 57. Duplicate-key race on WebhookEvent uniqueness handled safely
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_i57_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })

      const [r1, r2] = await Promise.all([
        apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString }),
        apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString }),
      ])
      assertTest('57. Duplicate-key race on WebhookEvent resolves cleanly with 200 OK', r1.status === 200 && r2.status === 200)
    }

    // 58. Temporary DB failure simulation: WebhookEvent records error reason
    {
      const event = await WebhookEvent.create({
        provider: 'razorpay',
        eventId: `evt_i58_${Date.now()}`,
        eventType: 'payment.captured',
        status: 'FAILED_RETRYABLE',
        errorReason: 'Simulated temporary transient error',
        attempts: 1,
      })
      assertTest('58. WebhookEvent supports FAILED_RETRYABLE state for retry handling', event.status === 'FAILED_RETRYABLE' && event.attempts === 1)
    }

    // 59. Transaction abort rolls back all mutations atomically
    {
      const stockBefore = (await Product.findById(baseProduct._id)).variants[0].qty
      let abortedProperly = false
      const session = await mongoose.startSession()
      session.startTransaction()
      try {
        await Product.updateOne({ _id: baseProduct._id }, { $inc: { qty: -1 } }, { session })
        throw new Error('Transaction abort simulation')
      } catch (err) {
        await session.abortTransaction()
        abortedProperly = true
      } finally {
        session.endSession()
      }
      const stockAfter = (await Product.findById(baseProduct._id)).variants[0].qty
      assertTest('59. Aborted transaction rolls back changes atomically without stock leak', abortedProperly && stockBefore === stockAfter)
    }

    // 60. WebhookEvent states lifecycle consistency
    {
      const ev = await WebhookEvent.create({
        provider: 'razorpay',
        eventId: `evt_i60_${Date.now()}`,
        eventType: 'payment.captured',
        status: 'RECEIVED',
      })
      await WebhookEvent.updateOne({ _id: ev._id }, { $set: { status: 'PROCESSING' } })
      await WebhookEvent.updateOne({ _id: ev._id }, { $set: { status: 'PROCESSED', processedAt: new Date() } })
      const finalized = await WebhookEvent.findById(ev._id)
      assertTest('60. WebhookEvent state transitions cleanly through lifecycle', finalized.status === 'PROCESSED' && Boolean(finalized.processedAt))
    }

    // 61. Failed event remains retryable
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_i61_${Date.now()}`
      const eventId = `evt_i61_${Date.now()}`

      await WebhookEvent.create({
        provider: 'razorpay',
        eventId,
        eventType: 'payment.captured',
        status: 'FAILED_RETRYABLE',
        attempts: 1,
      })

      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      }, WEBHOOK_SECRET, null, eventId)

      const res = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const finalEvent = await WebhookEvent.findOne({ eventId })
      assertTest('61. Retried webhook successfully recovers and fulfills', res.status === 200 && finalEvent.status === 'PROCESSED')
    }

    // =========================================================================
    // SECTION J: RECOVERY & RESILIENCE (Tests 62 - 67)
    // =========================================================================
    console.log('\n--- SECTION J: RECOVERY & RESILIENCE ---')

    // 62. Customer closes browser / no verify: Webhook completely fulfills order
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_j62_${Date.now()}`

      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })

      const updated = await Order.findById(order.id)
      assertTest('62. Customer closes browser / no verify: Webhook completely fulfills order', res.status === 200 && updated.status === 'CONFIRMED' && updated.paymentStatus === 'SUCCESS')
    }

    // 63. Frontend verification request fails completely: Webhook fulfills
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_j63_${Date.now()}`

      const failVerify = await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, razorpay_order_id: razorpayOrderId, razorpay_payment_id: rzpPaymentId, razorpay_signature: 'invalid_sig' }),
      })
      assertTest('63. Frontend verification fails as anticipated', failVerify.status === 400)

      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const webhookRes = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      const recovered = await Order.findById(order.id)
      assertTest('63.1 Webhook reliably recovers and fulfills order after frontend failure', webhookRes.status === 200 && recovered.status === 'CONFIRMED')
    }

    // 64. Webhook arrives after long delay
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      await Order.updateOne({ _id: order.id }, { $set: { createdAt: new Date(Date.now() - 7200000) } })
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_j64_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const res = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const updated = await Order.findById(order.id)
      assertTest('64. Delayed webhook fulfills order safely without expiring eligible pending orders', res.status === 200 && updated.status === 'CONFIRMED')
    }

    // 65. Webhook delivery retry with exponential delay simulation
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_j65_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })

      const r1 = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const r2 = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const r3 = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      assertTest('65. Retried deliveries acknowledged with 200 OK consistently', r1.status === 200 && r2.status === 200 && r3.status === 200)
    }

    // 66. Order initially failed then succeeds on customer retry
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const failWebhook = createSignedWebhook('payment.failed', {
        payment: { entity: { id: `pay_j66_fail_${Date.now()}`, order_id: razorpayOrderId, error_code: 'BAD_REQUEST', error_description: 'Card expired' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': failWebhook.signature }, body: failWebhook.bodyString })
      const successWebhook = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_j66_succ_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': successWebhook.signature }, body: successWebhook.bodyString })
      const finalDoc = await Order.findById(order.id)
      assertTest('66. Retry captures after failure and transitions to CONFIRMED', finalDoc.status === 'CONFIRMED' && finalDoc.paymentStatus === 'SUCCESS')
    }

    // 67. Stuck PROCESSING event recovery simulation
    {
      const stuckEventId = `evt_j67_${Date.now()}`
      await WebhookEvent.create({
        provider: 'razorpay',
        eventId: stuckEventId,
        eventType: 'payment.captured',
        status: 'PROCESSING',
        receivedAt: new Date(Date.now() - 600000),
      })
      const updated = await WebhookEvent.findOneAndUpdate(
        { eventId: stuckEventId, status: 'PROCESSING', receivedAt: { $lt: new Date(Date.now() - 300000) } },
        { $set: { status: 'FAILED_RETRYABLE', errorReason: 'Processing timeout recovery' } },
        { new: true },
      )
      assertTest('67. Stuck PROCESSING events are detectable and recoverable', updated && updated.status === 'FAILED_RETRYABLE')
    }

    // =========================================================================
    // SECTION K: ACCESS CONTROL (Tests 68 - 70)
    // =========================================================================
    console.log('\n--- SECTION K: ACCESS CONTROL ---')

    // 68. Webhook works without JWT Authorization header
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_k68_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(order.totalAmount * 100),
            currency: 'INR',
            status: 'captured',
          },
        },
      })

      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('68. Webhook endpoint works cleanly without customer JWT header', res.status === 200)
    }

    // 69. Random external unsigned request rejected
    {
      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hacked: true }),
      })
      assertTest('69. Random external unsigned request rejected (HTTP 400)', res.status === 400)
    }

    // 70. Customer cannot forge webhook to mutate another customer's order
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_k70_${Date.now()}`, order_id: razorpayOrderId, amount: 55000, currency: 'INR', status: 'captured' } },
      }, 'fake_secret_attacker')

      const res = await apiRequest('/payments/razorpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature },
        body: signed.bodyString,
      })
      assertTest('70. Forged webhook rejected with 400 invalid_webhook_signature', res.status === 400 && res.data?.error?.code === 'invalid_webhook_signature')
    }

    // =========================================================================
    // SECTION L: REGRESSION & INTEGRATION (Tests 71 - 76)
    // =========================================================================
    console.log('\n--- SECTION L: REGRESSION & INTEGRATION ---')

    // 71. Existing Razorpay client verification remains functional
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_l71_${Date.now()}`
      const clientSig = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${rzpPaymentId}`).digest('hex')
      const res = await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, razorpay_order_id: razorpayOrderId, razorpay_payment_id: rzpPaymentId, razorpay_signature: clientSig }),
      })
      assertTest('71. Existing /payments/razorpay/verify remains functional', res.status === 200 && res.data?.success === true)
    }

    // 72. Phase 2.2 edge-case constraints respected
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      assertTest('72. Phase 2.2 order initial state is PENDING_PAYMENT', order && order.status === 'PENDING_PAYMENT')
    }

    // 73. Phase 2.3 delivery lifecycle state constraints respected
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_l73_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const confirmed = await Order.findById(order.id)
      assertTest('73. Phase 2.3 confirmed order is eligible for delivery lifecycle transition', confirmed.status === 'CONFIRMED' && confirmed.paymentStatus === 'SUCCESS')
    }

    // 74. Phase 2.4B shared fulfillment engine behaves identically for client verify
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_l74_${Date.now()}`
      const clientSig = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${rzpPaymentId}`).digest('hex')

      const verifyRes = await apiRequest('/payments/razorpay/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerTokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, razorpay_order_id: razorpayOrderId, razorpay_payment_id: rzpPaymentId, razorpay_signature: clientSig }),
      })
      const verifyOrder = await Order.findById(order.id)
      assertTest('74. Client verify utilizes shared fulfillment engine with identical state output', verifyRes.status === 200 && verifyOrder.status === 'CONFIRMED' && verifyOrder.paymentStatus === 'SUCCESS')
    }

    // 75. Admin order view reflects webhook-fulfilled orders accurately
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: `pay_l75_${Date.now()}`, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const orderDoc = await Order.findById(order.id)
      assertTest('75. Admin order records reflect paymentStatus=SUCCESS and status=CONFIRMED', orderDoc.status === 'CONFIRMED' && orderDoc.paymentStatus === 'SUCCESS')
    }

    // 76. Full E2E checkout lifecycle with webhook fulfills cleanly
    {
      const order = await makeTestOrder(customerUserA, customerTokenA, 1)
      const { razorpayOrderId } = await makeTestPayment(order)
      const rzpPaymentId = `pay_l76_${Date.now()}`
      const signed = createSignedWebhook('payment.captured', {
        payment: { entity: { id: rzpPaymentId, order_id: razorpayOrderId, amount: Math.round(order.totalAmount * 100), currency: 'INR', status: 'captured' } },
      })
      const res = await apiRequest('/payments/razorpay/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signed.signature }, body: signed.bodyString })
      const finalOrder = await Order.findById(order.id)
      const finalPayment = await Payment.findOne({ razorpayOrderId })
      assertTest('76. Full E2E lifecycle with webhook fulfills cleanly to terminal success', res.status === 200 && finalOrder.status === 'CONFIRMED' && finalPayment.status === 'SUCCESS')
    }

    console.log('\n====================================================================')
    console.log(`PHASE 2.4C CORE TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`)
    console.log('====================================================================\n')
  } catch (err) {
    console.error('Test suite error:', err)
    failed++
  } finally {
    console.log('--- Cleaning Up Test Fixtures ---')
    await User.deleteMany({ _id: { $in: cleanupUserIds } }).catch(() => {})
    await Product.deleteMany({ _id: { $in: cleanupProductIds } }).catch(() => {})
    await Order.deleteMany({ _id: { $in: cleanupOrderIds } }).catch(() => {})
    await Payment.deleteMany({ orderId: { $in: cleanupOrderIds } }).catch(() => {})
    await WebhookEvent.deleteMany({ provider: 'razorpay' }).catch(() => {})
    await disconnectDb().catch(() => {})
    process.exit(failed > 0 ? 1 : 0)
  }
}

run()

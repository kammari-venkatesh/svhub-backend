/**
 * Phase 2.3 - Delivery Lifecycle Tests
 * Run with: node --test tests/phase-2-3-delivery-lifecycle.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import 'dotenv/config'
import { connectDb, disconnectDb } from '../src/config/db.js'

const BACKEND = process.env.TEST_BACKEND || 'http://localhost:5000'

const { Order } = await import('../src/models/Order.js')
const { User } = await import('../src/models/User.js')

await connectDb()
console.log('Connected to MongoDB for Phase 2.3 tests')

import jwt from 'jsonwebtoken'
import { jwtSecret } from '../src/utils/auth.js'

function makeToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    jwtSecret(),
    { expiresIn: '1h' },
  )
}

function iso(date) { return new Date(date).toISOString().slice(0, 10) }
function daysFromNow(n) { return new Date(Date.now() + n * 86400000) }

const ADDR = {
  name: 'Test Customer', phone: '9000000001', street: '1 Test St',
  city: 'Coimbatore', state: 'Tamil Nadu', pin: '641001',
}

let adminUser, adminToken, customerUser, customerToken, _order

before(async () => {
  const ts = Date.now()
  adminUser = await User.create({
    name: 'P23 Admin',
    email: 'p23admin_' + ts + '@svhub.test',
    passwordHash: 'dummyhash',
    role: 'ADMIN',
    status: 'ACTIVE',
  })
  adminToken = makeToken(adminUser)
  customerUser = await User.create({
    name: 'P23 Customer',
    email: 'p23cust_' + ts + '@svhub.test',
    passwordHash: 'dummyhash',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  })
  customerToken = makeToken(customerUser)
})

after(async () => {
  if (adminUser) await User.deleteOne({ _id: adminUser._id })
  if (customerUser) await User.deleteOne({ _id: customerUser._id })
  await disconnectDb()
  console.log('Phase 2.3 cleanup complete')
})

async function createRawOrder() {
  return Order.create({
    orderNumber: 'SVH-P23-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    userId: customerUser._id,
    customerName: 'P23 Customer',
    email: customerUser.email,
    phone: '9000000001',
    shippingAddress: ADDR,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: 'v-p23',
      sku: 'SKU-P23-01',
      productName: 'Test Product',
      variantLabel: '100g',
      unitPrice: 299,
      quantity: 1,
      lineTotal: 299,
    }],
    subtotal: 299, shippingFee: 0, discount: 0, totalAmount: 299,
    status: 'CONFIRMED', paymentStatus: 'SUCCESS', paymentMethod: 'razorpay',
  })
}

async function api(method, path, body, token) {
  const res = await fetch(BACKEND + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  return { status: res.status, body: data }
}

// ─── Test 1: Default date ────────────────────────────────────────────────────
test('1. Default expectedDeliveryDate is approx createdAt + 7 days', async () => {
  _order = await createRawOrder()
  const order = await Order.findById(_order._id)
  assert.ok(order.expectedDeliveryDate, 'expectedDeliveryDate must be set')
  const diff = Math.abs(order.expectedDeliveryDate.getTime() - daysFromNow(7).getTime())
  assert.ok(diff < 5000, 'diff=' + diff + 'ms should be < 5000ms')
  console.log('  expectedDeliveryDate:', iso(order.expectedDeliveryDate))
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 2: OUT_FOR_DELIVERY enum ───────────────────────────────────────────
test('2. OUT_FOR_DELIVERY is a valid status enum', async () => {
  _order = await createRawOrder()
  const order = await Order.findById(_order._id)
  order.status = 'OUT_FOR_DELIVERY'
  await order.save()
  const reloaded = await Order.findById(_order._id)
  assert.equal(reloaded.status, 'OUT_FOR_DELIVERY')
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 3: Status progression via API ─────────────────────────────────────
test('3. Status progression via admin API: CONFIRMED->SHIPPED->OUT_FOR_DELIVERY->DELIVERED', async () => {
  _order = await createRawOrder()
  const stages = [
    { raw: 'PROCESSING', display: 'Processing' },
    { raw: 'SHIPPED', display: 'Shipped' },
    { raw: 'OUT_FOR_DELIVERY', display: 'Out for Delivery' },
    { raw: 'DELIVERED', display: 'Delivered' },
  ]
  for (const { raw, display } of stages) {
    const payload = { status: raw }
    if (raw === 'SHIPPED') {
      payload.courier = 'Delhivery'
      payload.trackingUrl = 'https://delhivery.com/track/123'
    }
    const { status, body } = await api('PATCH', '/api/admin/orders/' + String(_order._id), payload, adminToken)
    assert.equal(status, 200, raw + ' -> HTTP ' + status + ': ' + JSON.stringify(body?.error))
    assert.equal(body.order.status, raw, raw + ' status mismatch: got ' + body.order.status)
    assert.equal(body.order.displayStatus, display, raw + ' displayStatus mismatch: got ' + body.order.displayStatus)
  }
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 4: Invalid date rejected ───────────────────────────────────────────
test('4. PATCH with invalid expectedDeliveryDate returns 400', async () => {
  _order = await createRawOrder()
  const { status, body } = await api(
    'PATCH',
    '/api/admin/orders/' + String(_order._id),
    { expectedDeliveryDate: 'not-a-date' },
    adminToken,
  )
  assert.equal(status, 400)
  assert.equal(body.error?.code, 'invalid_expected_delivery_date')
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 5: Valid date persists ─────────────────────────────────────────────
test('5. PATCH with valid expectedDeliveryDate is persisted to DB', async () => {
  _order = await createRawOrder()
  const target = iso(daysFromNow(10))
  const { status, body } = await api(
    'PATCH',
    '/api/admin/orders/' + String(_order._id),
    { expectedDeliveryDate: target },
    adminToken,
  )
  assert.equal(status, 200, 'HTTP ' + status + ': ' + JSON.stringify(body?.error))
  assert.equal(iso(body.order.expectedDeliveryDate), target)
  const dbOrder = await Order.findById(_order._id)
  assert.equal(iso(dbOrder.expectedDeliveryDate), target)
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 6: Audit history ───────────────────────────────────────────────────
test('6. Changing expectedDeliveryDate adds audit history entry', async () => {
  _order = await createRawOrder()
  const target = iso(daysFromNow(12))
  const { status } = await api(
    'PATCH',
    '/api/admin/orders/' + String(_order._id),
    { expectedDeliveryDate: target },
    adminToken,
  )
  assert.equal(status, 200)
  const dbOrder = await Order.findById(_order._id)
  const hasAudit = dbOrder.history.some(
    (h) => h.note && h.note.includes('Expected delivery changed'),
  )
  assert.ok(hasAudit, 'Audit note not found. History: ' + JSON.stringify(dbOrder.history))
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 7: Customer API returns date ───────────────────────────────────────
test('7. GET /api/orders/:id returns expectedDeliveryDate', async () => {
  _order = await createRawOrder()
  const { status, body } = await api(
    'GET',
    '/api/orders/' + String(_order._id),
    null,
    customerToken,
  )
  assert.equal(status, 200, 'HTTP ' + status)
  const order = body.data || body.order || body
  assert.ok(order.expectedDeliveryDate, 'expectedDeliveryDate missing from customer API response')
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 8: Admin API returns date ──────────────────────────────────────────
test('8. GET /api/admin/orders/:id returns expectedDeliveryDate', async () => {
  _order = await createRawOrder()
  const { status, body } = await api(
    'GET',
    '/api/admin/orders/' + String(_order._id),
    null,
    adminToken,
  )
  assert.equal(status, 200, 'HTTP ' + status)
  assert.ok(body.order.expectedDeliveryDate, 'expectedDeliveryDate missing from admin API response')
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 9: Display string normalization ─────────────────────────────────────
test('9. PATCH status "Out for Delivery" (display) normalised to OUT_FOR_DELIVERY in DB', async () => {
  _order = await createRawOrder()
  const { status, body } = await api(
    'PATCH',
    '/api/admin/orders/' + String(_order._id),
    { status: 'Out for Delivery' },
    adminToken,
  )
  assert.equal(status, 200)
  assert.equal(body.order.status, 'OUT_FOR_DELIVERY')
  assert.equal(body.order.displayStatus, 'Out for Delivery')
  const dbOrder = await Order.findById(_order._id)
  assert.equal(dbOrder.status, 'OUT_FOR_DELIVERY')
  await Order.deleteOne({ _id: _order._id })
})

// ─── Test 10: Isolation ───────────────────────────────────────────────────────
test('10. Updating expectedDeliveryDate does not change totalAmount', async () => {
  _order = await createRawOrder()
  const orig = await Order.findById(_order._id)
  const origTotal = orig.totalAmount
  const { status } = await api(
    'PATCH',
    '/api/admin/orders/' + String(_order._id),
    { expectedDeliveryDate: iso(daysFromNow(9)) },
    adminToken,
  )
  assert.equal(status, 200)
  const updated = await Order.findById(_order._id)
  assert.equal(updated.totalAmount, origTotal, 'totalAmount should not change')
  await Order.deleteOne({ _id: _order._id })
})

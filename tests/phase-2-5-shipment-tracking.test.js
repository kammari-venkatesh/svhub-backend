/**
 * Phase 2.5 - Shipment Tracking Tests
 * Run with: node --test tests/phase-2-5-shipment-tracking.test.js
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import 'dotenv/config'
import { connectDb, disconnectDb } from '../src/config/db.js'

const BACKEND = process.env.TEST_BACKEND || 'http://localhost:5000'
const { Order } = await import('../src/models/Order.js')
const { User } = await import('../src/models/User.js')
await connectDb()
console.log('Connected to MongoDB for Phase 2.5 shipment-tracking tests')

import jwt from 'jsonwebtoken'
import { jwtSecret } from '../src/utils/auth.js'

function makeToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, jwtSecret(), { expiresIn: '1h' })
}

const ADDR = { name: 'P25 Customer', phone: '9000000025', street: '25 Track Rd', city: 'Chennai', state: 'Tamil Nadu', pin: '600001' }
let adminUser, adminToken, customerUser, customerToken, otherUser, otherToken

before(async () => {
  const ts = Date.now()
  adminUser = await User.create({ name: 'P25 Admin', email: 'p25admin_' + ts + '@svhub.test', passwordHash: 'dummyhash', role: 'ADMIN', status: 'ACTIVE' })
  adminToken = makeToken(adminUser)
  customerUser = await User.create({ name: 'P25 Customer', email: 'p25cust_' + ts + '@svhub.test', passwordHash: 'dummyhash', role: 'CUSTOMER', status: 'ACTIVE' })
  customerToken = makeToken(customerUser)
  otherUser = await User.create({ name: 'P25 Other', email: 'p25other_' + ts + '@svhub.test', passwordHash: 'dummyhash', role: 'CUSTOMER', status: 'ACTIVE' })
  otherToken = makeToken(otherUser)
})

after(async () => {
  await User.deleteMany({ email: { $regex: /^p25/ } })
  await disconnectDb()
  console.log('Phase 2.5 cleanup complete')
})

async function createOrder(status = 'PROCESSING') {
  return Order.create({
    orderNumber: 'SVH-P25-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
    userId: customerUser._id, customerName: 'P25 Customer', email: customerUser.email, phone: '9000000025',
    shippingAddress: ADDR,
    items: [{ productId: new mongoose.Types.ObjectId(), variantId: 'v-p25', sku: 'SKU-P25-01', productName: 'Track Product', variantLabel: '250g', unitPrice: 199, quantity: 2, lineTotal: 398 }],
    subtotal: 398, shippingFee: 40, discount: 0, totalAmount: 438,
    status, paymentStatus: 'SUCCESS', paymentMethod: 'razorpay',
  })
}

async function api(method, path, body, token) {
  const res = await fetch(BACKEND + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

async function patchOrder(orderId, payload) {
  return api('PATCH', '/api/admin/orders/' + orderId, payload, adminToken)
}

test('1. SHIPPED without courier returns 400 shipment_info_required', async () => {
  const order = await createOrder('PROCESSING')
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', trackingUrl: 'https://delhivery.com/track/ABC' })
  assert.equal(status, 400, JSON.stringify(body))
  assert.equal(body.error?.code, 'shipment_info_required')
  await Order.deleteOne({ _id: order._id })
})

test('2. SHIPPED without trackingUrl returns 400 shipment_info_required', async () => {
  const order = await createOrder('PROCESSING')
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery' })
  assert.equal(status, 400, JSON.stringify(body))
  assert.equal(body.error?.code, 'shipment_info_required')
  await Order.deleteOne({ _id: order._id })
})

test('3. SHIPPED with javascript: URL returns 400', async () => {
  const order = await createOrder('PROCESSING')
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery', trackingUrl: 'javascript:alert(1)' })
  assert.equal(status, 400, JSON.stringify(body))
  assert.ok(['shipment_info_required', 'invalid_tracking_url'].includes(body.error?.code), 'code=' + body.error?.code)
  await Order.deleteOne({ _id: order._id })
})

test('4. SHIPPED with data: URL returns 400', async () => {
  const order = await createOrder('PROCESSING')
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery', trackingUrl: 'data:text/html,<script>xss</script>' })
  assert.equal(status, 400, JSON.stringify(body))
  assert.ok(['shipment_info_required', 'invalid_tracking_url'].includes(body.error?.code), 'code=' + body.error?.code)
  await Order.deleteOne({ _id: order._id })
})

test('5. SHIPPED with file: URL returns 400', async () => {
  const order = await createOrder('PROCESSING')
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery', trackingUrl: 'file:///etc/passwd' })
  assert.equal(status, 400, JSON.stringify(body))
  assert.ok(['shipment_info_required', 'invalid_tracking_url'].includes(body.error?.code), 'code=' + body.error?.code)
  await Order.deleteOne({ _id: order._id })
})

test('6. SHIPPED with valid https:// URL succeeds and persists', async () => {
  const order = await createOrder('PROCESSING')
  const url = 'https://www.delhivery.com/track/package/XYZ99901'
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery', trackingUrl: url })
  assert.equal(status, 200, JSON.stringify(body?.error))
  assert.equal(body.order?.status, 'SHIPPED')
  const dbOrder = await Order.findById(order._id)
  assert.equal(dbOrder.trackingUrl, url)
  assert.equal(dbOrder.courier, 'Delhivery')
  await Order.deleteOne({ _id: order._id })
})

test('7. SHIPPED with valid http:// URL succeeds and persists', async () => {
  const order = await createOrder('PROCESSING')
  const url = 'http://track.dtdc.com/track?consignment=TEST001'
  const { status, body } = await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'DTDC', trackingUrl: url })
  assert.equal(status, 200, JSON.stringify(body?.error))
  const dbOrder = await Order.findById(order._id)
  assert.equal(dbOrder.trackingUrl, url)
  await Order.deleteOne({ _id: order._id })
})

test('8. Admin GET order response includes trackingUrl', async () => {
  const order = await createOrder('PROCESSING')
  const url = 'https://bluedart.com/track/BD001'
  await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'BlueDart', trackingUrl: url })
  const { status, body } = await api('GET', '/api/admin/orders/' + order._id, null, adminToken)
  assert.equal(status, 200, JSON.stringify(body?.error))
  assert.equal(body.order?.trackingUrl, url)
  await Order.deleteOne({ _id: order._id })
})

test('9. Customer GET own order response includes trackingUrl', async () => {
  const order = await createOrder('PROCESSING')
  const url = 'https://shiprocket.co/tracking/TRK001'
  await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Shiprocket', trackingUrl: url })
  const { status, body } = await api('GET', '/api/orders/' + order._id, null, customerToken)
  assert.equal(status, 200, JSON.stringify(body?.error))
  const data = body.data || body.order || body
  assert.equal(data.trackingUrl, url)
  await Order.deleteOne({ _id: order._id })
})

test('10. Customer cannot retrieve another customers order', async () => {
  const order = await createOrder('SHIPPED')
  const { status } = await api('GET', '/api/orders/' + order._id, null, otherToken)
  assert.equal(status, 404)
  await Order.deleteOne({ _id: order._id })
})

test('11. Legacy SHIPPED order without trackingUrl does not break', async () => {
  const order = await Order.create({
    orderNumber: 'SVH-P25-LEGACY-' + Date.now(),
    userId: customerUser._id, customerName: 'P25 Customer', email: customerUser.email, phone: '9000000025',
    shippingAddress: ADDR,
    items: [{ productId: new mongoose.Types.ObjectId(), variantId: 'v-leg', sku: 'SKU-LEG', productName: 'Legacy', variantLabel: '100g', unitPrice: 99, quantity: 1, lineTotal: 99 }],
    subtotal: 99, shippingFee: 0, discount: 0, totalAmount: 99,
    status: 'SHIPPED', paymentStatus: 'SUCCESS', paymentMethod: 'razorpay',
    courier: null, trackingUrl: null,
  })
  const { status: as, body: ab } = await api('GET', '/api/admin/orders/' + order._id, null, adminToken)
  assert.equal(as, 200)
  assert.equal(ab.order?.trackingUrl, null)
  const { status: cs, body: cb } = await api('GET', '/api/orders/' + order._id, null, customerToken)
  assert.equal(cs, 200)
  const data = cb.data || cb.order || cb
  assert.equal(data.trackingUrl, null)
  await Order.deleteOne({ _id: order._id })
})

test('12. SHIPPED transition adds status history entry', async () => {
  const order = await createOrder('PROCESSING')
  await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery', trackingUrl: 'https://delhivery.com/track/HIST001' })
  const dbOrder = await Order.findById(order._id)
  const entry = dbOrder.history.find((h) => h.status === 'SHIPPED')
  assert.ok(entry, 'No SHIPPED history entry found')
  assert.ok(entry.at, 'SHIPPED history entry missing timestamp')
  await Order.deleteOne({ _id: order._id })
})

test('13. PROCESSING transition does not require trackingUrl', async () => {
  const order = await createOrder('CONFIRMED')
  const { status, body } = await patchOrder(String(order._id), { status: 'PROCESSING' })
  assert.equal(status, 200, JSON.stringify(body?.error))
  assert.equal(body.order?.status, 'PROCESSING')
  await Order.deleteOne({ _id: order._id })
})

test('14. DELIVERED order: trackingUrl still accessible via customer API', async () => {
  const order = await createOrder('PROCESSING')
  const url = 'https://delhivery.com/track/DELIVERED001'
  await patchOrder(String(order._id), { status: 'SHIPPED', courier: 'Delhivery', trackingUrl: url })
  await patchOrder(String(order._id), { status: 'DELIVERED' })
  const { status, body } = await api('GET', '/api/orders/' + order._id, null, customerToken)
  assert.equal(status, 200)
  const data = body.data || body.order || body
  assert.equal(data.trackingUrl, url)
  await Order.deleteOne({ _id: order._id })
})

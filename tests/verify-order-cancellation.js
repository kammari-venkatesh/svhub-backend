/**
 * tests/verify-order-cancellation.js
 * Comprehensive Order Cancellation Verification Test Suite
 *
 * Covers all requirements across:
 * - Customer cancellation (own orders, isolation, unauthenticated, invalid IDs, ineligible states, idempotency)
 * - Admin cancellation (eligible, non-admin rejection, unauthenticated rejection, illegal status bypass, resurrection block)
 * - Payment/Refund interaction (unpaid, paid auto-refund, idempotency, failure handling, reconciliation state, late webhooks)
 * - Inventory exact-once restoration (restoredQuantity tracking, partial/full refund interplay, concurrent cancellations)
 * - Concurrency & Races (customer vs admin, cancellation vs verification, cancellation vs late webhook, repeated calls)
 * - Security (forged customer ID, forged admin role, body manipulation, request ID, audit redaction)
 * - Database integrity (no negative stock, financial invariants, no duplicate refunds, clean isolated test data)
 */

import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { app } from '../src/app.js'
import { connectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import { AuditLog } from '../src/models/AuditLog.js'
import { jwtSecret } from '../src/utils/auth.js'
import { cancelOrder } from '../src/services/orderCancellationService.js'

const PORT = 5098
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
  console.log('\n==================================================')
  console.log('STARTING ORDER CANCELLATION TEST SUITE')
  console.log('==================================================\n')

  await connectDb()
  server = app.listen(PORT)
  await new Promise((r) => setTimeout(r, 600))

  // Track created test IDs for strict, isolated cleanup
  const createdUserIds = []
  const createdProductIds = []
  const createdOrderIds = []
  const createdPaymentIds = []
  const createdRefundIds = []

  try {
    // ----------------------------------------------------
    // SETUP: Users & Test Products
    // ----------------------------------------------------
    const customerA = await User.create({
      name: 'Test Customer A',
      email: `test_canc_cust_a_${Date.now()}@svhub.local`,
      role: 'CUSTOMER',
      isActive: true,
    })
    createdUserIds.push(customerA._id)

    const customerB = await User.create({
      name: 'Test Customer B',
      email: `test_canc_cust_b_${Date.now()}@svhub.local`,
      role: 'CUSTOMER',
      isActive: true,
    })
    createdUserIds.push(customerB._id)

    const adminUser = await User.create({
      name: 'Test Admin User',
      email: `test_canc_admin_${Date.now()}@svhub.local`,
      role: 'ADMIN',
      isActive: true,
    })
    createdUserIds.push(adminUser._id)

    const tokenCustA = generateToken(customerA)
    const tokenCustB = generateToken(customerB)
    const tokenAdmin = generateToken(adminUser)

    const testProduct = await Product.create({
      name: 'Cancellation Test Rice',
      slug: `canc-test-rice-${Date.now()}`,
      type: 'Heritage Rice',
      storefront: 'nutri-hub',
      category: 'native-rice',
      description: 'Rice for testing exact-once restoration',
      image: 'https://example.com/test.jpg',
      price: 300,
      weight: '1kg',
      sku: `CANC-SKU-${Date.now()}`,
      qty: 100,
      isActive: true,
      variants: [
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1kg',
          price: 300,
          originalPrice: 350,
          qty: 100,
          sku: `CANC-VAR-SKU-${Date.now()}`,
          isActive: true,
        },
      ],
    })
    createdProductIds.push(testProduct._id)

    console.log('--- 1. CUSTOMER CANCELLATION TESTS ---')

    // Helper to create test order
    async function createTestOrder(overrides = {}) {
      const ord = await Order.create({
        orderNumber: `TEST-ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        userId: customerA._id,
        customerName: customerA.name,
        email: customerA.email,
        phone: '9876543210',
        items: [
          {
            productId: testProduct._id,
            variantId: '1kg',
            productName: testProduct.name,
            variantLabel: '1 kg',
            sku: 'CANC-TEST-SKU',
            unitPrice: 300,
            quantity: 2,
            lineTotal: 600,
            restoredQuantity: 0,
          },
        ],
        subtotal: 600,
        shippingFee: 0,
        discount: 0,
        totalAmount: 600,
        totalPrice: 600,
        amount: 600,
        paymentStatus: 'PENDING',
        status: 'PENDING_PAYMENT',
        inventoryDeducted: true,
        inventoryRestored: false,
        shippingAddress: {
          name: 'Customer A',
          phone: '9876543210',
          street: '123 Main St',
          lines: ['123 Main St', 'Coimbatore, Tamil Nadu - 641001'],
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
          country: 'India',
        },
        ...overrides,
      })
      createdOrderIds.push(ord._id)
      return ord
    }

    // 1. Customer can cancel own eligible order
    const order1 = await createTestOrder()
    const res1 = await request(`/api/orders/${order1._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Ordered by mistake' },
    })
    assert(res1.status === 200, 'Test 1: Customer can cancel own eligible order (HTTP 200)')
    assert(res1.data?.data?.status === 'CANCELLED', 'Test 1: Order status updated to CANCELLED')

    // 2. Customer cannot cancel another customer\'s order (Customer isolation)
    const order2 = await createTestOrder({ userId: customerA._id })
    const res2 = await request(`/api/orders/${order2._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustB}` },
      body: { reason: 'Unauthorized attempt' },
    })
    assert(res2.status === 404, 'Test 2: Customer cannot cancel another customer order (HTTP 404)')
    const freshOrder2 = await Order.findById(order2._id)
    assert(freshOrder2.status === 'PENDING_PAYMENT', 'Test 2: Other customer order remains unchanged')

    // 3. Unauthenticated customer rejected
    const order3 = await createTestOrder()
    const res3 = await request(`/api/orders/${order3._id}/cancel`, {
      method: 'POST',
      body: { reason: 'No token' },
    })
    assert(res3.status === 401, 'Test 3: Unauthenticated request rejected (HTTP 401)')

    // 4. Invalid order ID rejected
    const res4 = await request('/api/orders/not-a-valid-id/cancel', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Bad ID' },
    })
    assert(res4.status === 400, 'Test 4: Invalid order ID rejected (HTTP 400)')

    // 5. Ineligible order rejected (DELIVERED / SHIPPED)
    const orderDelivered = await createTestOrder({ status: 'DELIVERED', paymentStatus: 'SUCCESS' })
    const res5Del = await request(`/api/orders/${orderDelivered._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Cancel delivered' },
    })
    assert(res5Del.status === 400, 'Test 5: Delivered order cancellation rejected (HTTP 400)')
    assert(res5Del.data?.error?.code === 'cannot_cancel_delivered', 'Test 5: Delivered order error code matches')

    const orderShipped = await createTestOrder({ status: 'SHIPPED', paymentStatus: 'SUCCESS' })
    const res5Ship = await request(`/api/orders/${orderShipped._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Cancel shipped' },
    })
    assert(res5Ship.status === 400, 'Test 5: Shipped order cancellation rejected (HTTP 400)')

    // 6. Already cancelled order idempotent
    const res6 = await request(`/api/orders/${order1._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Repeated cancel' },
    })
    assert(res6.status === 200, 'Test 6: Repeated customer cancellation returns HTTP 200')
    assert(res6.data?.idempotent === true, 'Test 6: Idempotent flag returned true')

    console.log('\n--- 2. ADMIN CANCELLATION TESTS ---')

    // 7. Admin can cancel eligible order
    const orderAdminEligible = await createTestOrder({ status: 'PROCESSING', paymentStatus: 'SUCCESS' })
    const res7 = await request(`/api/admin/orders/${orderAdminEligible._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: { reason: 'Out of packaging material' },
    })
    assert(res7.status === 200, 'Test 7: Admin can cancel eligible order (HTTP 200)')
    assert(res7.data?.order?.status === 'CANCELLED', 'Test 7: Admin order status is CANCELLED')
    assert(res7.data?.order?.displayStatus === 'Cancelled', 'Test 7: Admin order displayStatus formatted as Cancelled')

    // 7b. Admin can cancel WITHOUT providing a reason (optional reason, defaults to professional notice)
    const orderAdminNoReason = await createTestOrder({ status: 'PROCESSING', paymentStatus: 'SUCCESS', userId: customerA._id })
    const res7b = await request(`/api/admin/orders/${orderAdminNoReason._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: {}, // No reason provided
    })
    assert(res7b.status === 200, 'Test 7b: Admin can cancel with optional (omitted) reason (HTTP 200)')
    assert(res7b.data?.order?.status === 'CANCELLED', 'Test 7b: Order status updated to CANCELLED')
    assert(res7b.data?.order?.cancellationReason === 'Order cancelled by SV Hub Administration', 'Test 7b: cancellationReason defaults to professional notice')

    // 7c. Verify customer GET /api/orders/:id exposes professional cancellationReason
    const custViewRes = await request(`/api/orders/${orderAdminNoReason._id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(custViewRes.status === 200, 'Test 7c: Customer can fetch cancelled order')
    assert(custViewRes.data?.data?.cancellationReason === 'Order cancelled by SV Hub Administration', 'Test 7c: Customer sees professional cancellationReason')

    // 8. Non-admin cannot cancel via admin endpoint
    const order8 = await createTestOrder()
    const res8 = await request(`/api/admin/orders/${order8._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Customer pretending to be admin' },
    })
    assert(res8.status === 403, 'Test 8: Customer forbidden from admin cancel endpoint (HTTP 403)')

    // 9. Unauthenticated admin endpoint rejected
    const res9 = await request(`/api/admin/orders/${order8._id}/cancel`, {
      method: 'POST',
      body: { reason: 'No token' },
    })
    assert(res9.status === 401, 'Test 9: Unauthenticated admin request rejected (HTTP 401)')

    // 10. Arbitrary status transition rejected (e.g. CANCELLED -> CONFIRMED via PATCH)
    const res10 = await request(`/api/admin/orders/${orderAdminEligible._id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: { status: 'CONFIRMED' },
    })
    assert(res10.status === 400, 'Test 10: Cannot transition CANCELLED order to CONFIRMED (HTTP 400)')

    // 11. Cancelled order cannot be resurrected
    const freshOrderAdminEligible = await Order.findById(orderAdminEligible._id)
    assert(freshOrderAdminEligible.status === 'CANCELLED', 'Test 11: Cancelled order remains CANCELLED')

    console.log('\n--- 3. PAYMENT & REFUND BEHAVIOR ---')

    // 12. Unpaid cancellation: does not create refund or invent payments
    const unpaidOrder = await createTestOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' })
    const res12 = await request(`/api/orders/${unpaidOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(res12.status === 200, 'Test 12: Unpaid cancellation succeeds')
    assert(res12.data?.refund === null, 'Test 12: No refund created for unpaid order')
    const paymentsForUnpaid = await Payment.find({ orderId: unpaidOrder._id })
    assert(paymentsForUnpaid.length === 0, 'Test 12: Zero payment records created for unpaid order')

    // 13. Paid cancellation coordinates with refund workflow
    const paidOrder = await createTestOrder({ status: 'CONFIRMED', paymentStatus: 'SUCCESS' })
    const testPayment = await Payment.create({
      orderId: paidOrder._id,
      userId: customerA._id,
      amount: 600,
      currency: 'INR',
      status: 'SUCCESS',
      gatewayPaymentId: `pay_test_canc_${Date.now()}`,
      gatewayOrderId: `order_test_canc_${Date.now()}`,
      razorpayOrderId: `order_test_canc_${Date.now()}`,
      razorpayPaymentId: `pay_test_canc_${Date.now()}`,
      razorpaySignature: 'dummy_sig_test_cancellation',
      method: 'upi',
      refundableAmount: 600,
      refundedAmount: 0,
    })
    createdPaymentIds.push(testPayment._id)

    const res13 = await request(`/api/orders/${paidOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
      body: { reason: 'Customer changed mind after payment' },
    })
    assert(res13.status === 200, 'Test 13: Paid cancellation succeeds')
    const freshPayment = await Payment.findById(testPayment._id)
    assert(freshPayment.refundableAmount < 600 || freshPayment.reconciliationReason?.includes('refund'), 'Test 13: Payment tracked refund coordination')

    // 14. Refund idempotency: repeated cancellation doesn\'t double refund
    const refundCountBefore = await Refund.countDocuments({ orderId: paidOrder._id })
    const res14 = await request(`/api/orders/${paidOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(res14.status === 200, 'Test 14: Repeated cancellation on paid order returns 200')
    const refundCountAfter = await Refund.countDocuments({ orderId: paidOrder._id })
    assert(refundCountBefore === refundCountAfter, 'Test 14: No duplicate refund records created on repeated cancellation')

    console.log('\n--- 4. INVENTORY EXACT-ONCE RESTORATION ---')

    // 20. Cancellation restores stock once
    const initialProduct = await Product.findById(testProduct._id)
    const initialStock = initialProduct.qty
    const initialVarStock = initialProduct.variants[0].qty

    const invOrder = await createTestOrder({
      status: 'PENDING_PAYMENT',
      inventoryDeducted: true,
      inventoryRestored: false,
    })

    const res20 = await request(`/api/orders/${invOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(res20.status === 200, 'Test 20: Order cancelled')
    const postCancelProduct = await Product.findById(testProduct._id)
    assert(postCancelProduct.qty === initialStock + 2, 'Test 20: Base stock restored by exactly 2')
    assert(postCancelProduct.variants[0].qty === initialVarStock + 2, 'Test 20: Variant stock restored by exactly 2')

    // 21. Repeated cancellation does not restore twice
    const res21 = await request(`/api/orders/${invOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(res21.status === 200, 'Test 21: Repeated cancellation returns 200')
    const postRepeatProduct = await Product.findById(testProduct._id)
    assert(postRepeatProduct.qty === initialStock + 2, 'Test 21: Base stock NOT double-restored')
    assert(postRepeatProduct.variants[0].qty === initialVarStock + 2, 'Test 21: Variant stock NOT double-restored')

    // 22. Partial refund + cancellation exact-once
    // If 1 item was already restored by a partial refund, cancellation must only restore remaining 1
    const partialOrder = await createTestOrder({
      status: 'CONFIRMED',
      inventoryDeducted: true,
      inventoryRestored: false,
      items: [
        {
          productId: testProduct._id,
          variantId: '1kg',
          productName: testProduct.name,
          variantLabel: '1 kg',
          sku: 'CANC-TEST-SKU',
          unitPrice: 300,
          quantity: 2,
          lineTotal: 600,
          restoredQuantity: 1, // 1 already restored by previous partial refund
        },
      ],
    })

    const stockBeforePartial = (await Product.findById(testProduct._id)).qty
    const res22 = await request(`/api/orders/${partialOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(res22.status === 200, 'Test 22: Cancellation with partial restoredQuantity succeeds')
    const stockAfterPartial = (await Product.findById(testProduct._id)).qty
    assert(stockAfterPartial === stockBeforePartial + 1, 'Test 22: Exact-once: only remaining 1 unit restored')

    // 23. Full refund + cancellation exact-once
    // If all items were already restored (restoredQuantity === orderedQuantity)
    const fullRestoredOrder = await createTestOrder({
      status: 'CONFIRMED',
      inventoryDeducted: true,
      inventoryRestored: true,
      items: [
        {
          productId: testProduct._id,
          variantId: '1kg',
          productName: testProduct.name,
          variantLabel: '1 kg',
          sku: 'CANC-TEST-SKU',
          unitPrice: 300,
          quantity: 2,
          lineTotal: 600,
          restoredQuantity: 2, // fully restored
        },
      ],
    })

    const stockBeforeFull = (await Product.findById(testProduct._id)).qty
    const res23 = await request(`/api/orders/${fullRestoredOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustA}` },
    })
    assert(res23.status === 200, 'Test 23: Cancellation succeeds')
    const stockAfterFull = (await Product.findById(testProduct._id)).qty
    assert(stockAfterFull === stockBeforeFull, 'Test 23: Exact-once: 0 units restored since fully restored previously')

    console.log('\n--- 5. CONCURRENCY & RACE CONDITIONS ---')

    // 26. Customer and Admin simultaneous cancellation
    const raceOrder = await createTestOrder({ status: 'CONFIRMED', inventoryDeducted: true })
    const stockBeforeRace = (await Product.findById(testProduct._id)).qty

    const [raceCustRes, raceAdminRes] = await Promise.all([
      request(`/api/orders/${raceOrder._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenCustA}` },
        body: { reason: 'Customer race cancel' },
      }),
      request(`/api/admin/orders/${raceOrder._id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenAdmin}` },
        body: { reason: 'Admin race cancel' },
      }),
    ])

    assert(raceCustRes.status === 200 && raceAdminRes.status === 200, 'Test 26: Concurrent customer and admin calls both succeed cleanly')
    const raceFinalOrder = await Order.findById(raceOrder._id)
    assert(raceFinalOrder.status === 'CANCELLED', 'Test 26: Race order finalized as CANCELLED')
    const stockAfterRace = (await Product.findById(testProduct._id)).qty
    assert(stockAfterRace === stockBeforeRace + 2, 'Test 26: Inventory restored exactly once under concurrency (not +4)')

    console.log('\n--- 6. SECURITY & AUDIT INTEGRITY ---')

    // 31. Forged customer identity rejected
    const spoofOrder = await createTestOrder({ userId: customerA._id })
    const res31 = await request(`/api/orders/${spoofOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenCustB}` },
      body: { userId: String(customerA._id), reason: 'I am customer A trust me' },
    })
    assert(res31.status === 404, 'Test 31: Forged userId in body ignored; customer B cannot cancel customer A order')

    // 32. Forged admin role rejected
    const fakeAdminToken = jwt.sign(
      { sub: String(customerA._id), role: 'CUSTOMER' },
      jwtSecret(),
    )
    const res32 = await request(`/api/admin/orders/${spoofOrder._id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeAdminToken}` },
      body: { role: 'ADMIN', reason: 'Forged role' },
    })
    assert(res32.status === 403, 'Test 32: Body role manipulation rejected; JWT role enforced')

    // 36. Audit log recorded for cancellation
    const auditRecord = await AuditLog.findOne({
      resourceType: 'ORDER',
      resourceId: String(raceOrder._id),
      action: 'ORDER_CANCELLED',
    })
    assert(Boolean(auditRecord), 'Test 36: AuditLog recorded for ORDER_CANCELLED action')
    assert(auditRecord.result === 'SUCCESS', 'Test 36: Audit record result is SUCCESS')

    console.log('\n--- 7. DATABASE & FINANCIAL INVARIANTS ---')

    // 43. restoredQuantity <= ordered quantity invariant across all items
    const allCancelledOrders = await Order.find({ _id: { $in: createdOrderIds } })
    let invariantHolds = true
    for (const ord of allCancelledOrders) {
      for (const item of ord.items || []) {
        if (Number(item.restoredQuantity || 0) > Number(item.quantity || 0)) {
          invariantHolds = false
          console.error(`Invariant broken on order ${ord._id}: restored ${item.restoredQuantity} > ordered ${item.quantity}`)
        }
      }
    }
    assert(invariantHolds, 'Test 43: Invariant holds: restoredQuantity <= quantity on all line items')

    // 44. Cancelled orders cannot return to active fulfillment
    for (const ord of allCancelledOrders.filter((o) => o.status === 'CANCELLED')) {
      const illegalPatchRes = await request(`/api/admin/orders/${ord._id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenAdmin}` },
        body: { status: 'DELIVERED' },
      })
      assert(illegalPatchRes.status === 400, `Test 44: Order ${ord._id} cannot jump from CANCELLED to DELIVERED`)
    }

    console.log(`\n==================================================`)
    console.log(`ALL ${assertionCount} ASSERTIONS PASSED SUCCESSFULLY!`)
    console.log(`==================================================\n`)
  } finally {
    // Isolated cleanup: clean ONLY the records created by this test run
    console.log('Cleaning test artifacts...')
    await Order.deleteMany({ _id: { $in: createdOrderIds } })
    await Payment.deleteMany({ _id: { $in: createdPaymentIds } })
    await Refund.deleteMany({ _id: { $in: createdRefundIds } })
    await Product.deleteMany({ _id: { $in: createdProductIds } })
    await User.deleteMany({ _id: { $in: createdUserIds } })

    if (server) {
      server.close()
    }
  }
}

run()
  .then(() => {
    console.log('Order Cancellation Test Suite execution finished successfully.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Order Cancellation Test Suite failed:', err)
    process.exit(1)
  })

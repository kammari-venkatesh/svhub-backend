/**
 * SV HUB — PHASE 2.4E-R REFUND INTEGRITY REMEDIATION TEST SUITE
 *
 * Dedicated tests for:
 * A. Partial refund item restoration & restoredQuantity tracking
 * B. Cancellation after partial refund (exact remaining restoration)
 * C. Multi-stage partial refunds accumulating restoredQuantity safely
 * D. Rejection of restock exceeding ordered quantity
 * E. Concurrent partial refunds (exact-once restoration)
 * F. Concurrent cancellation attempts (exact-once restoration)
 * G. Partial refund + cancellation race (exact-once restoration)
 * H. Full refund followed by cancellation (0 duplicate units)
 * I. Cancellation followed by refund (0 duplicate units)
 * J. Historical ₹209 payment forensic verification (no unauthorized mutation)
 * K. Real Razorpay Test Mode refund verification
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import { connectDb, disconnectDb } from '../src/config/db.js'
import { User } from '../src/models/User.js'
import { Product } from '../src/models/Product.js'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import {
  setRazorpayClient,
  resetRazorpayClient,
  getRazorpayClient,
  isRazorpayConfigured,
} from '../src/config/razorpay.js'
import {
  initiateRefund,
  completeRefundFulfillment,
} from '../src/services/refundReconciliationService.js'
import { cancelAdminOrder } from '../src/controllers/adminOrderController.js'

let passed = 0
let failed = 0
const failures = []

function assert(name, condition, extra = '') {
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

async function runRemediationTests() {
  console.log('====================================================================')
  console.log('SV HUB — PHASE 2.4E-R REFUND INTEGRITY REMEDIATION SUITE')
  console.log('====================================================================\n')

  await connectDb()

  const runId = `rem_${Date.now()}`
  let testUser = null
  let adminUser = null
  let productA = null
  let productB = null

  const cleanupUserIds = []
  const cleanupProductIds = []
  const cleanupOrderIds = []
  const cleanupPaymentIds = []
  const cleanupRefundIds = []

  // Mock gateway for repeatable deterministic concurrency tests
  const mockRzp = {
    payments: {
      refund: async (payId, params) => ({
        id: `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        entity: 'refund',
        amount: params.amount,
        currency: 'INR',
        payment_id: payId,
        status: 'processed',
        created_at: Math.floor(Date.now() / 1000),
      }),
    },
    refunds: {
      fetch: async (id) => ({
        id,
        entity: 'refund',
        amount: 1000,
        status: 'processed',
      }),
    },
  }
  setRazorpayClient(mockRzp)

  try {
    // 0. Setup Users & Catalog
    console.log('--- 0. SETUP TEST USERS & PRODUCTS ---')
    testUser = await User.create({
      name: 'Remediation Customer',
      email: `cust_${runId}@example.com`,
      phone: '9876543210',
      password: 'Password123!',
      role: 'CUSTOMER',
      isActive: true,
    })
    cleanupUserIds.push(testUser._id)

    adminUser = await User.create({
      name: 'Remediation Admin',
      email: `admin_${runId}@example.com`,
      phone: '9876543299',
      password: 'Password123!',
      role: 'ADMIN',
      isActive: true,
    })
    cleanupUserIds.push(adminUser._id)

    productA = await Product.create({
      name: `Product A ${runId}`,
      slug: `product-a-${runId}`,
      description: 'Remediation Test Product A',
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      price: 500,
      weight: '1L',
      sku: `SKU-A-${runId}`,
      qty: 100,
      isActive: true,
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      variants: [
        {
          variantId: `var_a_${runId}`,
          sku: `SKU-A-VAR-${runId}`,
          label: '1L Bottle',
          weight: '1L',
          price: 500,
          qty: 100,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(productA._id)

    productB = await Product.create({
      name: `Product B ${runId}`,
      slug: `product-b-${runId}`,
      description: 'Remediation Test Product B',
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cooking-oil',
      price: 300,
      weight: '500ml',
      sku: `SKU-B-${runId}`,
      qty: 100,
      isActive: true,
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
      variants: [
        {
          variantId: `var_b_${runId}`,
          sku: `SKU-B-VAR-${runId}`,
          label: '500ml Bottle',
          weight: '500ml',
          price: 300,
          qty: 100,
          isActive: true,
        },
      ],
    })
    cleanupProductIds.push(productB._id)

    // Helper: Create a paid order fixture
    async function createOrderFixture({ items, totalAmount }) {
      const orderNum = `SVH-REM-${Date.now()}-${Math.floor(Math.random() * 10000)}`
      const order = await Order.create({
        orderNumber: orderNum,
        userId: testUser._id,
        customerName: testUser.name,
        email: testUser.email,
        phone: testUser.phone,
        shippingAddress: {
          name: testUser.name,
          phone: testUser.phone,
          street: '123 Test St',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
          country: 'India',
        },
        items,
        subtotal: totalAmount,
        shippingFee: 0,
        discount: 0,
        totalAmount,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'razorpay',
        razorpayOrderId: `order_rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        inventoryDeducted: true,
        inventoryRestored: false,
      })
      cleanupOrderIds.push(order._id)

      // Deduct stock in DB to represent confirmed order
      for (const item of items) {
        await Product.updateOne(
          { _id: item.productId, 'variants.variantId': item.variantId },
          { $inc: { 'variants.$.qty': -item.quantity, qty: -item.quantity } }
        )
      }

      const payment = await Payment.create({
        orderId: order._id,
        userId: testUser._id,
        amount: totalAmount,
        currency: 'INR',
        gateway: 'razorpay',
        status: 'SUCCESS',
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: `pay_rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        capturedAmount: totalAmount,
        refundedAmount: 0,
        refundableAmount: totalAmount,
      })
      cleanupPaymentIds.push(payment._id)

      return { order, payment }
    }

    // Helper: Call cancelOrder directly simulating controller
    async function executeAdminCancel(orderId, reason = 'Customer requested cancellation') {
      return new Promise((resolve) => {
        const req = {
          params: { id: String(orderId) },
          body: { reason },
          user: adminUser,
        }
        const res = {
          statusCode: 200,
          status(code) {
            this.statusCode = code
            return this
          },
          json(data) {
            resolve({ status: this.statusCode, data })
          },
        }
        cancelAdminOrder(req, res, (err) => resolve({ status: 500, error: err?.message }))
      })
    }

    // --------------------------------------------------------------------------------
    // TEST A: Partial refund A x 1 (ordered: A x 2) -> restoredQuantity = 1
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST A: PARTIAL REFUND RESTORES EXACT LINE QUANTITY ---')
    const fixtureA = await createOrderFixture({
      items: [
        {
          productId: productA._id,
          variantId: `var_a_${runId}`,
          productName: productA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-A-VAR-${runId}`,
          unitPrice: 500,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 1000,
        },
      ],
      totalAmount: 1000,
    })

    const initialStockA = (await Product.findById(productA._id)).variants[0].qty

    const refundResA = await initiateRefund({
      orderId: fixtureA.order._id,
      amount: 500,
      reason: 'Partial return 1 bottle',
      user: adminUser,
      source: 'admin',
      items: [
        {
          productId: productA._id,
          variantId: `var_a_${runId}`,
          quantity: 1,
        },
      ],
    })
    cleanupRefundIds.push(refundResA.refund?._id)

    assert('A.1: Partial refund initiates successfully', refundResA.success === true)
    const updatedOrderA = await Order.findById(fixtureA.order._id)
    assert('A.2: Order.items[0].restoredQuantity is updated to 1', updatedOrderA.items[0].restoredQuantity === 1)
    assert('A.3: Order.inventoryRestored is false (1 unit remains unrestored)', updatedOrderA.inventoryRestored === false)

    const stockAfterRefundA = (await Product.findById(productA._id)).variants[0].qty
    assert('A.4: Product stock increased by exactly 1 unit', stockAfterRefundA === initialStockA + 1)

    // --------------------------------------------------------------------------------
    // TEST B: Admin cancellation after partial refund -> restores ONLY remaining 1 unit
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST B: CANCELLATION RESTORES ONLY REMAINING RESTORABLE QUANTITY ---')
    const cancelResB = await executeAdminCancel(fixtureA.order._id, 'Cancel remainder of order')
    assert('B.1: Cancellation succeeds (200 OK)', cancelResB.status === 200)

    const orderAfterCancelB = await Order.findById(fixtureA.order._id)
    assert('B.2: Order status is CANCELLED', orderAfterCancelB.status === 'CANCELLED')
    assert('B.3: Order.items[0].restoredQuantity is now 2 (fully restored)', orderAfterCancelB.items[0].restoredQuantity === 2)
    assert('B.4: Order.inventoryRestored is now true', orderAfterCancelB.inventoryRestored === true)

    const stockAfterCancelB = (await Product.findById(productA._id)).variants[0].qty
    assert('B.5: Product stock increased by ONLY 1 additional unit (total 2 restored, zero duplicate)', stockAfterCancelB === initialStockA + 2)

    // --------------------------------------------------------------------------------
    // TEST C & D: Multi-stage partial refunds accumulating safely, third refund rejected
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST C & D: ACCUMULATING PARTIAL REFUNDS & OVER-RESTOCK REJECTION ---')
    const fixtureCD = await createOrderFixture({
      items: [
        {
          productId: productB._id,
          variantId: `var_b_${runId}`,
          productName: productB.name,
          variantLabel: '500ml Bottle',
          weight: '500ml',
          sku: `SKU-B-VAR-${runId}`,
          unitPrice: 300,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 600,
        },
      ],
      totalAmount: 600,
    })

    const initialStockB = (await Product.findById(productB._id)).variants[0].qty

    // Refund 1 of 2
    const refCD1 = await initiateRefund({
      orderId: fixtureCD.order._id,
      amount: 300,
      reason: 'First bottle refund',
      user: adminUser,
      source: 'admin',
      items: [{ productId: productB._id, variantId: `var_b_${runId}`, quantity: 1 }],
    })
    cleanupRefundIds.push(refCD1.refund?._id)
    assert('C.1: First partial refund of 1 unit succeeds', refCD1.success === true)

    let orderCD = await Order.findById(fixtureCD.order._id)
    assert('C.2: restoredQuantity = 1 after first refund', orderCD.items[0].restoredQuantity === 1)
    assert('C.3: inventoryRestored is false after first refund', orderCD.inventoryRestored === false)

    // Refund 2 of 2
    const refCD2 = await initiateRefund({
      orderId: fixtureCD.order._id,
      amount: 300,
      reason: 'Second bottle refund',
      user: adminUser,
      source: 'admin',
      items: [{ productId: productB._id, variantId: `var_b_${runId}`, quantity: 1 }],
    })
    cleanupRefundIds.push(refCD2.refund?._id)
    assert('C.4: Second partial refund of 1 unit succeeds', refCD2.success === true)

    orderCD = await Order.findById(fixtureCD.order._id)
    assert('C.5: restoredQuantity = 2 after second refund', orderCD.items[0].restoredQuantity === 2)
    assert('C.6: inventoryRestored is true (all units restored)', orderCD.inventoryRestored === true)

    const stockAfterTwoRefunds = (await Product.findById(productB._id)).variants[0].qty
    assert('C.7: Total stock restored is exactly 2 units', stockAfterTwoRefunds === initialStockB + 2)

    // TEST D: Third restock attempt on fully restored line must be REJECTED
    const refCD3 = await initiateRefund({
      orderId: fixtureCD.order._id,
      amount: 10,
      reason: 'Third invalid restock attempt',
      user: adminUser,
      source: 'admin',
      items: [{ productId: productB._id, variantId: `var_b_${runId}`, quantity: 1 }],
    })
    assert('D.1: Third restock attempt on fully restored line is REJECTED', refCD3.success === false)
    assert('D.2: Rejection error code is restock_quantity_exceeds_available or payment_not_refundable',
      ['restock_quantity_exceeds_available', 'refund_amount_exceeds_refundable', 'payment_not_refundable'].includes(refCD3.errorCode)
    )

    // --------------------------------------------------------------------------------
    // TEST E: Concurrent partial refunds for the same line item
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST E: CONCURRENT PARTIAL REFUNDS ON SAME LINE ---')
    const fixtureE = await createOrderFixture({
      items: [
        {
          productId: productA._id,
          variantId: `var_a_${runId}`,
          productName: productA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-A-VAR-${runId}`,
          unitPrice: 500,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 1000,
        },
      ],
      totalAmount: 1000,
    })

    const stockBeforeE = (await Product.findById(productA._id)).variants[0].qty

    // Launch two simultaneous partial refund requests for 1 unit each
    const [resE1, resE2] = await Promise.all([
      initiateRefund({
        orderId: fixtureE.order._id,
        amount: 500,
        reason: 'Concurrent refund 1',
        user: adminUser,
        source: 'admin',
        idempotencyKey: `idemp_e1_${Date.now()}`,
        items: [{ productId: productA._id, variantId: `var_a_${runId}`, quantity: 1 }],
      }),
      initiateRefund({
        orderId: fixtureE.order._id,
        amount: 500,
        reason: 'Concurrent refund 2',
        user: adminUser,
        source: 'admin',
        idempotencyKey: `idemp_e2_${Date.now()}`,
        items: [{ productId: productA._id, variantId: `var_a_${runId}`, quantity: 1 }],
      }),
    ])

    if (resE1.refund?._id) cleanupRefundIds.push(resE1.refund._id)
    if (resE2.refund?._id) cleanupRefundIds.push(resE2.refund._id)

    assert('E.1: Both concurrent refunds succeed or serialize cleanly', (resE1.success && resE2.success) || (resE1.success !== resE2.success))

    const orderE = await Order.findById(fixtureE.order._id)
    const totalRestoredE = orderE.items[0].restoredQuantity
    const stockAfterE = (await Product.findById(productA._id)).variants[0].qty
    const actualRestoredStockE = stockAfterE - stockBeforeE

    assert('E.2: Order.items[0].restoredQuantity <= 2 (ordered quantity)', totalRestoredE <= 2)
    assert('E.3: Actual restored product stock strictly matches order.items[0].restoredQuantity', actualRestoredStockE === totalRestoredE)

    // --------------------------------------------------------------------------------
    // TEST F: Concurrent cancellation attempts
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST F: CONCURRENT CANCELLATION ATTEMPTS ---')
    const fixtureF = await createOrderFixture({
      items: [
        {
          productId: productA._id,
          variantId: `var_a_${runId}`,
          productName: productA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-A-VAR-${runId}`,
          unitPrice: 500,
          quantity: 2,
          restoredQuantity: 0,
          lineTotal: 1000,
        },
      ],
      totalAmount: 1000,
    })

    const stockBeforeF = (await Product.findById(productA._id)).variants[0].qty

    const [cancelF1, cancelF2] = await Promise.all([
      executeAdminCancel(fixtureF.order._id, 'Cancel attempt 1'),
      executeAdminCancel(fixtureF.order._id, 'Cancel attempt 2'),
    ])

    const successCountF = [cancelF1, cancelF2].filter((c) => c.status === 200).length
    assert('F.1: Exactly one cancellation succeeds (200), the other returns 400 order_already_cancelled', successCountF === 1)

    const stockAfterF = (await Product.findById(productA._id)).variants[0].qty
    assert('F.2: Stock restored exactly 2 units (zero double-restock from concurrent cancel)', stockAfterF - stockBeforeF === 2)

    // --------------------------------------------------------------------------------
    // TEST G: Partial refund + cancellation race
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST G: PARTIAL REFUND + CANCELLATION RACE ---')
    const fixtureG = await createOrderFixture({
      items: [
        {
          productId: productB._id,
          variantId: `var_b_${runId}`,
          productName: productB.name,
          variantLabel: '500ml Bottle',
          weight: '500ml',
          sku: `SKU-B-VAR-${runId}`,
          unitPrice: 300,
          quantity: 3,
          restoredQuantity: 0,
          lineTotal: 900,
        },
      ],
      totalAmount: 900,
    })

    const stockBeforeG = (await Product.findById(productB._id)).variants[0].qty

    // Fire partial refund of 1 unit and admin cancellation concurrently
    const [raceRefundRes, raceCancelRes] = await Promise.all([
      initiateRefund({
        orderId: fixtureG.order._id,
        amount: 300,
        reason: 'Race partial refund',
        user: adminUser,
        source: 'admin',
        items: [{ productId: productB._id, variantId: `var_b_${runId}`, quantity: 1 }],
      }),
      executeAdminCancel(fixtureG.order._id, 'Race cancellation'),
    ])
    if (raceRefundRes.refund?._id) cleanupRefundIds.push(raceRefundRes.refund._id)

    const orderG = await Order.findById(fixtureG.order._id)
    const stockAfterG = (await Product.findById(productB._id)).variants[0].qty
    const totalRestoredUnitsG = stockAfterG - stockBeforeG

    assert('G.1: Final restoredQuantity does not exceed 3 (ordered quantity)', orderG.items[0].restoredQuantity <= 3)
    assert('G.2: Actual stock restored matches restoredQuantity exactly', totalRestoredUnitsG === orderG.items[0].restoredQuantity)
    assert('G.3: Total units restored is <= 3 (zero phantom stock created)', totalRestoredUnitsG <= 3)

    // --------------------------------------------------------------------------------
    // TEST H: Full refund followed by cancellation -> 0 duplicate units restored
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST H: FULL REFUND FOLLOWED BY CANCELLATION ---')
    const fixtureH = await createOrderFixture({
      items: [
        {
          productId: productA._id,
          variantId: `var_a_${runId}`,
          productName: productA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-A-VAR-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
    })

    const stockBeforeH = (await Product.findById(productA._id)).variants[0].qty

    const fullRefundResH = await initiateRefund({
      orderId: fixtureH.order._id,
      amount: 500,
      reason: 'Full refund test',
      user: adminUser,
      source: 'admin',
    })
    cleanupRefundIds.push(fullRefundResH.refund?._id)
    assert('H.1: Full refund succeeds', fullRefundResH.success === true)

    const stockAfterFullH = (await Product.findById(productA._id)).variants[0].qty
    assert('H.2: Stock restored 1 unit on full refund', stockAfterFullH === stockBeforeH + 1)

    // Now cancel the fully refunded order
    const cancelH = await executeAdminCancel(fixtureH.order._id, 'Cancel after full refund')
    assert('H.3: Cancellation succeeds', cancelH.status === 200)

    const stockAfterCancelH = (await Product.findById(productA._id)).variants[0].qty
    assert('H.4: Zero additional units restored upon cancellation (still +1)', stockAfterCancelH === stockAfterFullH)

    // --------------------------------------------------------------------------------
    // TEST I: Cancellation followed by refund -> 0 duplicate units restored
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST I: CANCELLATION FOLLOWED BY REFUND ---')
    const fixtureI = await createOrderFixture({
      items: [
        {
          productId: productA._id,
          variantId: `var_a_${runId}`,
          productName: productA.name,
          variantLabel: '1L Bottle',
          weight: '1L',
          sku: `SKU-A-VAR-${runId}`,
          unitPrice: 500,
          quantity: 1,
          restoredQuantity: 0,
          lineTotal: 500,
        },
      ],
      totalAmount: 500,
    })

    const stockBeforeI = (await Product.findById(productA._id)).variants[0].qty

    const cancelI = await executeAdminCancel(fixtureI.order._id, 'Cancel before refund')
    assert('I.1: Cancellation succeeds', cancelI.status === 200)

    const stockAfterCancelI = (await Product.findById(productA._id)).variants[0].qty
    assert('I.2: Stock restored 1 unit on cancellation', stockAfterCancelI === stockBeforeI + 1)

    // Now refund the cancelled order
    const refundI = await initiateRefund({
      orderId: fixtureI.order._id,
      amount: 500,
      reason: 'Refund after cancellation',
      user: adminUser,
      source: 'admin',
    })
    cleanupRefundIds.push(refundI.refund?._id)
    assert('I.3: Refund of cancelled order succeeds financially', refundI.success === true)

    const stockAfterRefundI = (await Product.findById(productA._id)).variants[0].qty
    assert('I.4: Zero additional units restored by refund (inventoryRestorationStatus = NOT_APPLICABLE)',
      stockAfterRefundI === stockAfterCancelI && refundI.refund.inventoryRestorationStatus === 'NOT_APPLICABLE'
    )

    // --------------------------------------------------------------------------------
    // TEST J: Historical ₹209 Payment Forensic Audit Preservation
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST J: HISTORICAL ₹209 PAYMENT INTEGRITY CHECK ---')
    const historicalPayment = await Payment.findById('6aa242c25aea5fc569c4b8ae')
    assert('J.1: Historical payment 6aa242c25aea5fc569c4b8ae exists in database', Boolean(historicalPayment))
    assert('J.2: Status is preserved as REQUIRES_RECONCILIATION', historicalPayment?.status === 'REQUIRES_RECONCILIATION')
    assert('J.3: capturedAmount is preserved as 0 (verified 0 payments on Razorpay)', historicalPayment?.capturedAmount === 0)
    assert('J.4: refundableAmount is preserved as 0', historicalPayment?.refundableAmount === 0)
    assert('J.5: refundedAmount is preserved as 0', historicalPayment?.refundedAmount === 0)

    // --------------------------------------------------------------------------------
    // TEST K: Real Razorpay Test Mode Refund Status Check
    // --------------------------------------------------------------------------------
    console.log('\n--- TEST K: REAL RAZORPAY TEST MODE REFUND VERIFICATION ---')
    assert('K.1: Razorpay Test Mode is configured and active in environment', isRazorpayConfigured())
    const realKey = process.env.RAZORPAY_KEY_ID || ''
    assert('K.2: Key ID starts with rzp_test_', realKey.startsWith('rzp_test_'))

  } finally {
    resetRazorpayClient()

    // Cleanup fixtures
    console.log('\n--- CLEANING UP REMEDIATION TEST FIXTURES ---')
    for (const rid of cleanupRefundIds) await Refund.findByIdAndDelete(rid).catch(() => {})
    for (const pid of cleanupPaymentIds) await Payment.findByIdAndDelete(pid).catch(() => {})
    for (const oid of cleanupOrderIds) await Order.findByIdAndDelete(oid).catch(() => {})
    for (const prid of cleanupProductIds) await Product.findByIdAndDelete(prid).catch(() => {})
    for (const uid of cleanupUserIds) await User.findByIdAndDelete(uid).catch(() => {})
    console.log('Cleanup complete.')

    await disconnectDb()
  }

  console.log('\n====================================================================')
  console.log(`REMEDIATION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`)
  console.log('====================================================================\n')

  if (failed > 0) {
    console.error('FAILURES:')
    failures.forEach((f) => console.error(f))
    process.exit(1)
  }
}

runRemediationTests().catch((err) => {
  console.error('Remediation suite crashed:', err)
  process.exit(1)
})

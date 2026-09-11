import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'
import { Payment } from '../src/models/Payment.js'

let passed = 0
let failed = 0

function assertTest(name, condition, details = '') {
  if (condition) { console.log(`[PASS] ${name}`); passed++ }
  else { console.error(`[FAIL] ${name}${details ? ' — ' + details : ''}`); failed++ }
}

async function run() {
  console.log('====================================================================')
  console.log('SV HUB — PHASE 2.4I-P3 PAYMENT SCHEMA DEFAULT REGRESSION')
  console.log('====================================================================\n')

  await connectDb()

  const runId = Date.now()
  // Use bare ObjectIds — Payment schema validates ObjectId type, not existence
  const fakeOrderId = new mongoose.Types.ObjectId()
  const fakeUserId  = new mongoose.Types.ObjectId()
  const createdIds  = []

  try {
    // TEST A: new Payment({ amount:500 }) — no capturedAmount provided — must default to 0
    console.log('--- TEST A: new Payment({ amount:500 }) capturedAmount default ---')
    const payA = new Payment({
      orderId: fakeOrderId, userId: fakeUserId,
      amount: 500, currency: 'INR', gateway: 'razorpay',
      status: 'PENDING', razorpayOrderId: `order_p3a_${runId}`,
    })
    assertTest('A.1: In-memory default capturedAmount === 0 (not derived from amount)', payA.capturedAmount === 0, `Got: ${payA.capturedAmount}`)
    assertTest('A.2: capturedAmount !== amount (500)', payA.capturedAmount !== 500, `Got: ${payA.capturedAmount}`)
    await payA.save()
    createdIds.push(payA._id)
    const payADb = await Payment.findById(payA._id)
    assertTest('A.3: Persisted capturedAmount === 0', payADb.capturedAmount === 0, `Got: ${payADb.capturedAmount}`)
    assertTest('A.4: amount still 500 in DB', payADb.amount === 500, `Got: ${payADb.amount}`)

    // TEST B: new Payment({ amount:500, capturedAmount:0 }) — explicit 0 preserved
    console.log('\n--- TEST B: Explicit capturedAmount: 0 preserved ---')
    const payB = new Payment({
      orderId: fakeOrderId, userId: fakeUserId,
      amount: 500, capturedAmount: 0, currency: 'INR', gateway: 'razorpay',
      status: 'PENDING', razorpayOrderId: `order_p3b_${runId}`,
    })
    assertTest('B.1: In-memory explicit 0 preserved', payB.capturedAmount === 0, `Got: ${payB.capturedAmount}`)
    await payB.save()
    createdIds.push(payB._id)
    const payBDb = await Payment.findById(payB._id)
    assertTest('B.2: Persisted explicit 0 unchanged', payBDb.capturedAmount === 0, `Got: ${payBDb.capturedAmount}`)

    // TEST C: Successful fulfillment sets capturedAmount = amount
    console.log('\n--- TEST C: Successful fulfillment sets capturedAmount = amount ---')
    const payC = await Payment.create({
      orderId: fakeOrderId, userId: fakeUserId,
      amount: 750, capturedAmount: 0, refundedAmount: 0, refundableAmount: 0,
      currency: 'INR', gateway: 'razorpay', status: 'PENDING',
      razorpayOrderId: `order_p3c_${runId}`,
    })
    createdIds.push(payC._id)
    assertTest('C.1: Pre-fulfillment capturedAmount === 0', payC.capturedAmount === 0)
    payC.status = 'SUCCESS'
    payC.capturedAmount = payC.amount
    payC.refundedAmount = payC.refundedAmount ?? 0
    payC.refundableAmount = Math.max(0, payC.capturedAmount - payC.refundedAmount)
    await payC.save()
    const payCDb = await Payment.findById(payC._id)
    assertTest('C.2: Post-fulfillment capturedAmount === amount (750)', payCDb.capturedAmount === 750, `Got: ${payCDb.capturedAmount}`)
    assertTest('C.3: refundableAmount === 750', payCDb.refundableAmount === 750, `Got: ${payCDb.refundableAmount}`)
    assertTest('C.4: Invariant capturedAmount >= refundedAmount', payCDb.capturedAmount >= payCDb.refundedAmount)
    assertTest('C.5: Invariant refundableAmount = capturedAmount - refundedAmount', payCDb.refundableAmount === payCDb.capturedAmount - payCDb.refundedAmount)

    // TEST D: Failed payment capturedAmount stays 0
    console.log('\n--- TEST D: Failed payment capturedAmount stays 0 ---')
    const payD = await Payment.create({
      orderId: fakeOrderId, userId: fakeUserId,
      amount: 300, capturedAmount: 0, refundedAmount: 0, refundableAmount: 0,
      currency: 'INR', gateway: 'razorpay', status: 'PENDING',
      razorpayOrderId: `order_p3d_${runId}`,
    })
    createdIds.push(payD._id)
    payD.status = 'FAILED'
    payD.errorReason = 'Card declined by test bank'
    await payD.save()
    const payDDb = await Payment.findById(payD._id)
    assertTest('D.1: Failed payment capturedAmount === 0', payDDb.capturedAmount === 0, `Got: ${payDDb.capturedAmount}`)
    assertTest('D.2: Failed payment refundedAmount === 0', payDDb.refundedAmount === 0)
    assertTest('D.3: capturedAmount >= refundedAmount for failed payment', payDDb.capturedAmount >= payDDb.refundedAmount)

    // TEST E: Refund does NOT modify capturedAmount
    console.log('\n--- TEST E: Refund path never modifies capturedAmount ---')
    const payE = await Payment.create({
      orderId: fakeOrderId, userId: fakeUserId,
      amount: 1000, capturedAmount: 1000, refundedAmount: 0, refundableAmount: 1000,
      currency: 'INR', gateway: 'razorpay', status: 'SUCCESS',
      razorpayOrderId: `order_p3e_${runId}`,
    })
    createdIds.push(payE._id)
    const refundAmt = 300
    const newRefunded   = (payE.refundedAmount || 0) + refundAmt
    const newRefundable = Math.max(0, payE.capturedAmount - newRefunded)
    payE.refundedAmount   = Math.round(newRefunded   * 100) / 100
    payE.refundableAmount = Math.round(newRefundable * 100) / 100
    payE.status = 'PARTIALLY_REFUNDED'
    // capturedAmount intentionally NOT written — mirrors refundReconciliationService
    await payE.save()
    const payEDb = await Payment.findById(payE._id)
    assertTest('E.1: capturedAmount unchanged at 1000 after refund', payEDb.capturedAmount === 1000, `Got: ${payEDb.capturedAmount}`)
    assertTest('E.2: refundedAmount === 300', payEDb.refundedAmount === 300, `Got: ${payEDb.refundedAmount}`)
    assertTest('E.3: refundableAmount === 700', payEDb.refundableAmount === 700, `Got: ${payEDb.refundableAmount}`)
    assertTest('E.4: refundedAmount <= capturedAmount', payEDb.refundedAmount <= payEDb.capturedAmount)
    assertTest('E.5: refundableAmount = capturedAmount - refundedAmount', payEDb.refundableAmount === payEDb.capturedAmount - payEDb.refundedAmount)

    // TEST F: Schema min constraint blocks negative capturedAmount
    console.log('\n--- TEST F: Schema min constraint ---')
    let blocked = false
    try {
      const payF = new Payment({
        orderId: fakeOrderId, userId: fakeUserId,
        amount: 200, capturedAmount: -1, currency: 'INR', gateway: 'razorpay',
        status: 'PENDING', razorpayOrderId: `order_p3f_${runId}`,
      })
      await payF.validate()
    } catch { blocked = true }
    assertTest('F.1: Negative capturedAmount rejected by schema min constraint', blocked)

    // TEST G: Global DB invariants across entire Payment collection
    console.log('\n--- TEST G: Global DB financial invariants ---')
    const allPayments = await Payment.find({})
    let violations = 0
    for (const p of allPayments) {
      if (p.capturedAmount < 0 || p.refundedAmount < 0 || p.refundableAmount < 0 || p.refundedAmount > p.capturedAmount) violations++
    }
    assertTest('G.1: All payments satisfy financial invariants', violations === 0, `${violations} violation(s) found`)
    const hist = await Payment.findById('6aa242c25aea5fc569c4b8ae')
    assertTest('G.2: Historical ₹209 payment capturedAmount === 0 (unmodified)', !hist || hist.capturedAmount === 0, `Got: ${hist?.capturedAmount}`)

  } finally {
    if (createdIds.length) await Payment.deleteMany({ _id: { $in: createdIds } })
    await disconnectDb()
  }

  console.log('\n====================================================================')
  console.log(`PHASE 2.4I-P3 SCHEMA REGRESSION: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================================\n')
  return { passed, failed }
}

run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0)).catch(err => { console.error(err); process.exit(1) })

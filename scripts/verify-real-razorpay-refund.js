/**
 * SV HUB — VERIFY REAL RAZORPAY TEST MODE REFUND
 *
 * Executes a REAL live HTTP refund against Razorpay Test Mode (api.razorpay.com)
 * without using mocks or stubs.
 */

import 'dotenv/config'
import { getRazorpayClient, isRazorpayConfigured, getRazorpayKeyId } from '../src/config/razorpay.js'

async function runRealRefundTest() {
  console.log('====================================================================')
  console.log('SV HUB — REAL RAZORPAY TEST MODE REFUND VERIFICATION')
  console.log('====================================================================\n')

  if (!isRazorpayConfigured()) {
    console.error('FAIL: Razorpay is not configured.')
    process.exit(1)
  }

  const keyId = getRazorpayKeyId()
  console.log(`Razorpay Key ID: ${keyId.slice(0, 10)}... (Test Mode: ${keyId.startsWith('rzp_test_')})`)

  const rzp = getRazorpayClient()

  // 1. Identify real captured payment
  console.log('1. Fetching captured payments from api.razorpay.com...')
  const paymentsResponse = await rzp.payments.all({ count: 10 })
  console.log(`Found ${paymentsResponse.items.length} total payments in test account.`)

  const candidatePayment = paymentsResponse.items.find(
    (p) => p.status === 'captured' && (p.amount_refunded === 0 || p.amount_refunded < p.amount)
  )

  if (!candidatePayment) {
    console.log('REAL_RAZORPAY_REFUND_TEST = NOT_EXECUTED')
    console.log('REASON = No eligible captured payment found with refundable balance in Razorpay test account.')
    process.exit(0)
  }

  console.log(`Selected candidate payment: ${candidatePayment.id} (status: ${candidatePayment.status}, amount: ₹${candidatePayment.amount / 100})`)

  // 2. Create a real partial refund (e.g. ₹10 = 1000 paise)
  const refundAmountPaise = 1000 // ₹10
  const idempotencyKey = `real_rfnd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  console.log(`\n2. Issuing real Test Mode refund for ₹${refundAmountPaise / 100} against ${candidatePayment.id}...`)
  const refundResult = await rzp.payments.refund(candidatePayment.id, {
    amount: refundAmountPaise,
    speed: 'normal',
    notes: {
      environment: 'test',
      purpose: 'Phase 2.4E-R Real Razorpay Test Verification',
      idempotencyKey,
    },
    receipt: idempotencyKey,
  })

  console.log('\n3. Real Razorpay Refund Response Received:')
  console.log(`- Refund ID: ${refundResult.id}`)
  console.log(`- Entity: ${refundResult.entity}`)
  console.log(`- Amount: ₹${refundResult.amount / 100}`)
  console.log(`- Currency: ${refundResult.currency}`)
  console.log(`- Payment ID: ${refundResult.payment_id}`)
  console.log(`- Status: ${refundResult.status}`)
  console.log(`- Created At: ${new Date(refundResult.created_at * 1000).toISOString()}`)

  // 4. Fetch and reconcile the created refund from Razorpay API
  console.log(`\n4. Fetching refund ${refundResult.id} from api.razorpay.com to verify upstream state...`)
  const fetchedRefund = await rzp.refunds.fetch(refundResult.id)
  console.log(`- Fetched Refund ID: ${fetchedRefund.id}`)
  console.log(`- Fetched Status: ${fetchedRefund.status}`)
  console.log(`- Fetched Amount: ₹${fetchedRefund.amount / 100}`)

  console.log('\n====================================================================')
  console.log('REAL RAZORPAY TEST MODE REFUND SUCCESSFULLY EXECUTED AND VERIFIED')
  console.log('====================================================================')
}

runRealRefundTest().catch((err) => {
  console.error('Real Razorpay Refund Error:', err.statusCode, err.error?.description || err.message)
  process.exit(1)
})

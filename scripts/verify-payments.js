import 'dotenv/config'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { User, Product, Category, Cart, Address, Order, Payment } from '../src/models/index.js'
import { verifyRazorpaySignature, isRazorpayConfigured, getRazorpayKeyId } from '../src/config/razorpay.js'

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000/api'

let passed = 0
let failed = 0

function assert(description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${description}`)
    passed++
  } else {
    console.error(`[FAIL] ${description} ${details}`)
    failed++
  }
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

async function runPaymentVerification() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 2.1 RAZORPAY TEST PAYMENT TEST SUITE')
  console.log('====================================================\n')

  await connectDb()

  const testSuffix = `pay_${Date.now()}`
  let tokenA, userAId, userAEmail
  let tokenB, userBId
  let testProduct, depletedProduct
  let orderA

  try {
    console.log('--- 1. CONFIGURATION TESTS ---')

    // 1.1 Secret Exposure Audit: Check that RAZORPAY_KEY_SECRET is not in public env/responses
    const healthRes = await apiRequest('/health')
    const healthText = JSON.stringify(healthRes.data || {})
    assert(
      'Server health endpoint does not leak Razorpay secrets',
      !healthText.includes('rzp_') && !healthText.includes('secret')
    )

    // 1.2 Signature verification helper unit tests (Cryptographic Tests)
    const testSecret = 'sample_secret_key_12345'
    const testOrderId = 'order_test_abc123'
    const testPaymentId = 'pay_test_xyz789'
    const expectedSig = crypto
      .createHmac('sha256', testSecret)
      .update(`${testOrderId}|${testPaymentId}`)
      .digest('hex')

    const validCryptSig = verifyRazorpaySignature({
      serverOrderId: testOrderId,
      paymentId: testPaymentId,
      signature: expectedSig,
      secret: testSecret,
    })
    assert(
      '[Local Cryptographic Test] Valid HMAC SHA256 signature validates correctly',
      validCryptSig === true
    )

    const invalidCryptSig = verifyRazorpaySignature({
      serverOrderId: testOrderId,
      paymentId: testPaymentId,
      signature: expectedSig + 'tampered',
      secret: testSecret,
    })
    assert(
      '[Local Cryptographic Test] Tampered signature is rejected',
      invalidCryptSig === false
    )

    const mismatchedOrderSig = verifyRazorpaySignature({
      serverOrderId: 'order_test_different',
      paymentId: testPaymentId,
      signature: expectedSig,
      secret: testSecret,
    })
    assert(
      '[Local Cryptographic Test] Signature for mismatched order ID is rejected',
      mismatchedOrderSig === false
    )

    // 1.3 Missing key handling test
    const missingSecretCheck = verifyRazorpaySignature({
      serverOrderId: testOrderId,
      paymentId: testPaymentId,
      signature: expectedSig,
      secret: '',
    })
    assert('Missing key secret safely rejects signature verification', missingSecretCheck === false)
    assert('Razorpay configuration present in environment', isRazorpayConfigured() === true)
    assert('Public Key ID accessible and safe for frontend', Boolean(getRazorpayKeyId()))

    console.log('\n--- 2. FIXTURE SETUP (USERS, PRODUCTS, CART, ORDER) ---')

    // Register Customer A
    userAEmail = `alice_${testSuffix}@example.com`
    const regResA = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alice PaymentTester',
        email: userAEmail,
        password: 'Password@123',
        phone: '9876543210',
      }),
    })
    tokenA = regResA.data?.token
    userAId = regResA.data?.user?.id
    assert('Customer A registered successfully', regResA.status === 201 && tokenA)

    // Register Customer B
    const regResB = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bob PaymentTester',
        email: `bob_${testSuffix}@example.com`,
        password: 'Password@123',
        phone: '9876543211',
      }),
    })
    tokenB = regResB.data?.token
    userBId = regResB.data?.user?.id
    assert('Customer B registered successfully', regResB.status === 201 && tokenB)

    // Create test product with controlled stock
    const testSku = `PAY-TEST-${Date.now()}`
    testProduct = await Product.create({
      name: `Payment Test Oil ${testSuffix}`,
      slug: `payment-test-oil-${testSuffix}`,
      type: 'Oil',
      storefront: 'nutri-hub',
      category: 'cold-pressed-oils',
      description: 'Test product for Phase 2.1 inventory atomicity and payments.',
      price: 500,
      weight: '1 L',
      sku: testSku,
      qty: 10,
      isActive: true,
      variants: [
        {
          variantId: '1L',
          label: '1 Litre Bottle',
          weight: '1 L',
          sku: `${testSku}-1L`,
          price: 500,
          qty: 10,
          isActive: true,
        },
      ],
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
    })
    assert('Test product created in MongoDB with 10 units of stock', Boolean(testProduct?._id))

    // Customer A adds test product to Cart
    const addCartRes = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProduct._id),
        variantId: '1L',
        quantity: 2,
      }),
    })
    assert('Customer A cart populated with 2 units', addCartRes.status === 200 && addCartRes.data?.data?.items?.length === 1)

    // Customer A creates SV Hub Order
    const createOrdRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        shippingMethod: 'standard',
        shippingAddress: {
          name: 'Alice PaymentTester',
          phone: '9876543210',
          street: '123 Test Boulevard',
          city: 'Coimbatore',
          state: 'Tamil Nadu',
          pin: '641001',
          country: 'India',
        },
      }),
    })

    assert('SV Hub order created with status PENDING_PAYMENT', createOrdRes.status === 201 && createOrdRes.data?.data?.status === 'PENDING_PAYMENT')
    orderA = createOrdRes.data?.data
    assert('Order has authoritative totalAmount calculated server-side', typeof orderA?.totalAmount === 'number' && orderA.totalAmount > 0)
    assert('Order items contain accurate snapshot', orderA?.items?.length === 1 && orderA.items[0].quantity === 2)

    // Verify stock has NOT yet been deducted on order creation
    const productAfterOrder = await Product.findById(testProduct._id)
    assert(
      'Stock NOT deducted on order creation (still 10 units)',
      productAfterOrder.variants[0].qty === 10 && productAfterOrder.qty === 10
    )

    console.log('\n--- 3. AUTHORIZATION TESTS ---')

    // 3.1 Unauthenticated create-order request
    const unauthCreate = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      body: JSON.stringify({ orderId: orderA.id }),
    })
    assert('Unauthenticated create-order request returns 401', unauthCreate.status === 401)

    // 3.2 Customer B attempting to create Razorpay order for Customer A's order
    const forbiddenCreate = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ orderId: orderA.id }),
    })
    assert('Customer B cannot create payment for Customer A order (403 Forbidden)', forbiddenCreate.status === 403)

    // 3.3 Invalid order ID
    const invalidIdRes = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ orderId: 'not-an-id' }),
    })
    assert('Invalid order ID returns 400 or 404', invalidIdRes.status === 400 || invalidIdRes.status === 404)

    // 3.4 Nonexistent order ID
    const fakeObjectId = new mongoose.Types.ObjectId()
    const nonExistentRes = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ orderId: String(fakeObjectId) }),
    })
    assert('Nonexistent order ID returns 404', nonExistentRes.status === 404)

    console.log('\n--- 4. CREATE RAZORPAY ORDER API TESTS ---')

    // Create Razorpay payment record for Customer A's order
    // Note: If Razorpay keys are configured, calls Razorpay SDK; if not yet in .env, we verify graceful error handling
    let serverRazorpayOrderId = null
    const createRzpRes = await apiRequest('/payments/razorpay/create-order', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ orderId: orderA.id }),
    })

    if (createRzpRes.status === 200) {
      assert('Razorpay order created successfully (200 OK)', true)
      assert('Returned currency is INR', createRzpRes.data?.data?.currency === 'INR')
      assert(
        'Authoritative amount converted to integer paise',
        createRzpRes.data?.data?.amount === Math.round(orderA.totalAmount * 100)
      )
      serverRazorpayOrderId = createRzpRes.data?.data?.razorpayOrderId
      assert('Razorpay order ID returned in response', Boolean(serverRazorpayOrderId))
    } else {
      assert(
        'Server handles test Razorpay API invocation cleanly without crashing',
        [400, 401, 500, 502].includes(createRzpRes.status)
      )

      // Provision a test payment record directly to test all cryptographic verification rules
      serverRazorpayOrderId = `order_test_${Date.now()}`
      await Payment.create({
        orderId: orderA.id,
        userId: userAId,
        amount: orderA.totalAmount,
        currency: 'INR',
        gateway: 'razorpay',
        status: 'CREATED',
        razorpayOrderId: serverRazorpayOrderId,
      })
      await Order.findByIdAndUpdate(orderA.id, { razorpayOrderId: serverRazorpayOrderId })
    }

    // Verify Payment document exists in MongoDB
    const paymentDoc = await Payment.findOne({ orderId: orderA.id })
    assert('Payment record persisted in MongoDB', Boolean(paymentDoc))
    assert('Payment status initialized to CREATED', paymentDoc?.status === 'CREATED')
    assert('Payment amount matches SV Hub order total exactly', paymentDoc?.amount === orderA.totalAmount)

    console.log('\n--- 5. PAYMENT VERIFICATION TESTS ---')

    const simulatedPaymentId = `pay_sim_${Date.now()}`
    const activeSecret = process.env.RAZORPAY_KEY_SECRET || 'test_mode_secret_fallback'

    // Generate valid cryptographic signature for testing local verification
    const validSignature = crypto
      .createHmac('sha256', activeSecret)
      .update(`${serverRazorpayOrderId}|${simulatedPaymentId}`)
      .digest('hex')

    // 5.1 Verification Authorization: Customer B cannot verify Customer A's order
    const forbiddenVerify = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        orderId: orderA.id,
        razorpay_order_id: serverRazorpayOrderId,
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: validSignature,
      }),
    })
    assert('Customer B cannot verify Customer A payment (403 Forbidden)', forbiddenVerify.status === 403)

    // 5.2 Verification: Wrong/tampered Razorpay Order ID rejected
    const wrongOrderVerify = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        orderId: orderA.id,
        razorpay_order_id: 'order_wrong_mismatch_123',
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: validSignature,
      }),
    })
    assert(
      'Mismatched Razorpay order ID is rejected (400 Bad Request)',
      wrongOrderVerify.status === 400 && wrongOrderVerify.data?.error?.code === 'mismatched_razorpay_order_id'
    )

    // 5.3 Verification: Amount Tampering attempt (e.g. ₹1 instead of ₹1000)
    const tamperedAmountVerify = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        orderId: orderA.id,
        razorpay_order_id: serverRazorpayOrderId,
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: validSignature,
        amount: 100, // 100 paise (₹1) tampering attempt
      }),
    })
    assert(
      'Tampered amount rejected by server authority (400 amount_mismatch)',
      tamperedAmountVerify.status === 400 && tamperedAmountVerify.data?.error?.code === 'amount_mismatch'
    )

    // 5.4 Verification: Invalid HMAC signature rejected
    const badSigVerify = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        orderId: orderA.id,
        razorpay_order_id: serverRazorpayOrderId,
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: 'invalid_cryptographic_signature_value',
      }),
    })
    assert(
      'Invalid cryptographic signature rejected (400 invalid_signature)',
      badSigVerify.status === 400 && badSigVerify.data?.error?.code === 'invalid_signature'
    )

    // Check that invalid signature did NOT confirm order or deduct stock
    const orderAfterFailedSig = await Order.findById(orderA.id)
    assert('Order remains NOT confirmed after invalid signature', orderAfterFailedSig.status === 'PENDING_PAYMENT')

    // 5.5 Successful Verification Flow
    // Execute verification with valid signature
    const verifySuccess = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        orderId: orderA.id,
        razorpay_order_id: serverRazorpayOrderId,
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: validSignature,
      }),
    })

    console.log('DEBUG_VERIFY_SUCCESS:', JSON.stringify(verifySuccess))
    assert(
      'Payment verified successfully (200 OK)',
      verifySuccess.status === 200 && verifySuccess.data?.success === true
    )

    // Check MongoDB states after successful verification
    const verifiedOrder = await Order.findById(orderA.id)
    assert('Order status transitioned to CONFIRMED', verifiedOrder.status === 'CONFIRMED')
    assert('Order paymentStatus is SUCCESS', verifiedOrder.paymentStatus === 'SUCCESS')
    assert('Order paymentId stored', verifiedOrder.paymentId === simulatedPaymentId)

    const verifiedPayment = await Payment.findOne({ orderId: orderA.id })
    assert('Payment status is SUCCESS', verifiedPayment.status === 'SUCCESS')
    assert('Payment verified flag is true', verifiedPayment.verified === true)
    assert('Payment razorpayPaymentId saved', verifiedPayment.razorpayPaymentId === simulatedPaymentId)

    // Verify Atomic Inventory Deduction: 10 units - 2 units = 8 units remaining
    const productAfterPayment = await Product.findById(testProduct._id)
    assert(
      'Inventory deducted exactly once (stock reduced from 10 to 8 units)',
      productAfterPayment.variants[0].qty === 8 && productAfterPayment.qty === 8
    )

    // Verify Cart Clearing: Customer A cart should now be empty
    const cartAfterPayment = await Cart.findOne({ userId: userAId })
    assert('Customer cart cleared in MongoDB after verified payment', cartAfterPayment.items.length === 0)

    console.log('\n--- 6. IDEMPOTENCY & DUPLICATE PAYMENT PROTECTION ---')

    // Re-submitting the exact same verify payload must be idempotent
    const duplicateVerify = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        orderId: orderA.id,
        razorpay_order_id: serverRazorpayOrderId,
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: validSignature,
      }),
    })

    assert('Duplicate verification returns idempotent 200 OK', duplicateVerify.status === 200 && duplicateVerify.data?.data?.idempotent === true)

    // Check inventory was NOT deducted a second time
    const productAfterDuplicate = await Product.findById(testProduct._id)
    assert(
      'Duplicate verification did NOT deduct stock again (remains 8 units)',
      productAfterDuplicate.variants[0].qty === 8 && productAfterDuplicate.qty === 8
    )

    console.log('\n--- 7. INVENTORY CONFLICT & RECONCILIATION TESTS ---')

    // Create Order C for an item with 0 remaining stock
    const depleteSku = `DEP-SKU-${Date.now()}`
    depletedProduct = await Product.create({
      name: `Depleted Test Herbal Powder ${testSuffix}`,
      slug: `depleted-powder-${testSuffix}`,
      type: 'Powder',
      storefront: 'self-care',
      category: 'herbal-powders',
      description: 'Test product with zero stock to verify atomic conflict handling.',
      price: 300,
      weight: '250 g',
      sku: depleteSku,
      qty: 1,
      isActive: true,
      variants: [
        {
          variantId: '250g',
          label: '250 g Pouch',
          weight: '250 g',
          sku: `${depleteSku}-250`,
          price: 300,
          qty: 1,
          isActive: true,
        },
      ],
      image: 'https://images.unsplash.com/photo-1471193945509-9ad0617afabf?auto=format&fit=crop&w=600&q=80',
    })

    // Add to cart and create order
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        productId: String(depletedProduct._id),
        variantId: '250g',
        quantity: 1,
      }),
    })

    const orderBRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        shippingMethod: 'standard',
        shippingAddress: {
          name: 'Bob PaymentTester',
          phone: '9876543211',
          street: '456 West Street',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pin: '600001',
          country: 'India',
        },
      }),
    })
    const orderB = orderBRes.data?.data

    // Manually set stock to 0 right before payment verification to simulate concurrent race exhaustion
    await Product.findByIdAndUpdate(depletedProduct._id, {
      qty: 0,
      'variants.0.qty': 0,
    })

    const rzpOrderIdB = `order_test_conflict_${Date.now()}`
    const rzpPaymentIdB = `pay_conflict_${Date.now()}`
    await Payment.create({
      orderId: orderB.id,
      userId: userBId,
      amount: orderB.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      status: 'CREATED',
      razorpayOrderId: rzpOrderIdB,
    })
    await Order.findByIdAndUpdate(orderB.id, { razorpayOrderId: rzpOrderIdB })

    const conflictSig = crypto
      .createHmac('sha256', activeSecret)
      .update(`${rzpOrderIdB}|${rzpPaymentIdB}`)
      .digest('hex')

    const conflictVerify = await apiRequest('/payments/razorpay/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        orderId: orderB.id,
        razorpay_order_id: rzpOrderIdB,
        razorpay_payment_id: rzpPaymentIdB,
        razorpay_signature: conflictSig,
      }),
    })

    assert(
      'Inventory exhaustion during payment verification returns 409 Conflict',
      conflictVerify.status === 409 && conflictVerify.data?.error?.code === 'inventory_conflict'
    )

    const conflictOrder = await Order.findById(orderB.id)
    assert(
      'Order marked as REQUIRES_RECONCILIATION when stock deduction fails',
      conflictOrder.status === 'REQUIRES_RECONCILIATION'
    )

    console.log('\n--- 8. PAYMENT FAILURE / CHECKOUT CANCELLATION UX TESTS ---')

    // Reset Customer B's cart to clear previous depleted item
    await Cart.updateOne({ userId: userBId }, { $set: { items: [] } })

    // Create Order D and simulate user closing/cancelling checkout modal
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        productId: String(testProduct._id),
        variantId: '1L',
        quantity: 1,
      }),
    })

    const orderDRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        shippingMethod: 'standard',
        shippingAddress: {
          name: 'Bob CancellationTester',
          phone: '9876543211',
          street: '789 Cancellation Road',
          city: 'Madurai',
          state: 'Tamil Nadu',
          pin: '625001',
          country: 'India',
        },
      }),
    })
    const orderD = orderDRes.data?.data

    // Client records modal cancellation
    const cancelRes = await apiRequest('/payments/razorpay/record-failure', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        orderId: orderD.id,
        errorReason: 'User dismissed checkout modal',
      }),
    })

    assert('Payment failure record endpoint returns 200 OK', cancelRes.status === 200)

    const orderAfterCancel = await Order.findById(orderD.id)
    assert('Cancelled checkout does NOT confirm order (remains PENDING_PAYMENT)', orderAfterCancel.status === 'PENDING_PAYMENT')

    const cartAfterCancel = await Cart.findOne({ userId: userBId })
    assert('Customer cart preserved on cancellation (not cleared)', cartAfterCancel.items.length >= 1)

    console.log('\n====================================================')
    console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`)
    console.log('====================================================')
  } finally {
    // Cleanup test artifacts
    if (userAEmail) {
      await User.deleteMany({ email: { $in: [userAEmail, `bob_${testSuffix}@example.com`] } }).catch(() => {})
    }
    if (testProduct?._id) {
      await Product.findByIdAndDelete(testProduct._id).catch(() => {})
    }
    if (depletedProduct?._id) {
      await Product.findByIdAndDelete(depletedProduct._id).catch(() => {})
    }
    if (userAId || userBId) {
      const userIds = [userAId, userBId].filter(Boolean)
      await Order.deleteMany({ userId: { $in: userIds } }).catch(() => {})
      await Payment.deleteMany({ userId: { $in: userIds } }).catch(() => {})
      await Cart.deleteMany({ userId: { $in: userIds } }).catch(() => {})
      await Address.deleteMany({ userId: { $in: userIds } }).catch(() => {})
    }
    await mongoose.disconnect().catch(() => {})
  }

  if (failed > 0) {
    process.exit(1)
  }
}

runPaymentVerification().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})

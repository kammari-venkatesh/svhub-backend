import dotenv from 'dotenv'
import crypto from 'node:crypto'

dotenv.config({ path: './.env' })

const BASE_URL = 'https://svhub-backend.vercel.app/api'
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || ''

async function runExhaustiveTest() {
  console.log('====================================================================')
  console.log('EXHAUSTIVE MULTI-SUBSYSTEM VERIFICATION OF DEPLOYED BACKEND')
  console.log('Target: ' + BASE_URL)
  console.log('Timestamp: ' + new Date().toISOString())
  console.log('====================================================================\n')

  let passed = 0
  let failed = 0

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(`[PASS] ${name} ${extra}`)
      passed++
    } else {
      console.error(`[FAIL] ${name} ${extra}`)
      failed++
    }
  }

  // ----------------------------------------------------
  // STAGE 1: HEALTH & SERVERLESS STABILITY
  // ----------------------------------------------------
  console.log('>>> STAGE 1: HEALTH & SERVERLESS STABILITY <<<')
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now()
    const res = await fetch(`${BASE_URL}/health`)
    const latency = Date.now() - t0
    const data = await res.json()
    assert(`Ping #${i} (/health) returns 200 OK in ${latency}ms`, res.status === 200)
    assert(`Ping #${i} reports database: 'connected'`, data.database === 'connected' && data.status === 'ok')
  }

  const hRes = await fetch(`${BASE_URL}/health`)
  assert('Security Header: X-Content-Type-Options: nosniff', hRes.headers.get('x-content-type-options') === 'nosniff')
  assert('Security Header: X-Frame-Options: DENY', hRes.headers.get('x-frame-options') === 'DENY')
  assert('Security Header: Strict-Transport-Security configured', Boolean(hRes.headers.get('strict-transport-security')))
  assert('Tracing Header: X-Request-Id exists', Boolean(hRes.headers.get('x-request-id')))

  // ----------------------------------------------------
  // STAGE 2: PUBLIC CATALOG, SEARCH & SETTINGS
  // ----------------------------------------------------
  console.log('\n>>> STAGE 2: CATALOG, PRODUCTS, CATEGORIES & STORE SETTINGS <<<')
  const catRes = await fetch(`${BASE_URL}/categories`)
  const catData = await catRes.json()
  assert('GET /categories returns 200 OK', catRes.status === 200)
  assert('Categories count >= 4', Array.isArray(catData.data) && catData.data.length >= 4, `(${catData.data.length} categories)`)

  const prodRes = await fetch(`${BASE_URL}/products?page=1&limit=10&sort=price-asc`)
  const prodData = await prodRes.json()
  assert('GET /products with pagination & sort returns 200 OK', prodRes.status === 200)
  assert('Total catalog count is populated', prodData.pagination?.total >= 30, `(${prodData.pagination?.total} products)`)
  assert('Products list is an array', Array.isArray(prodData.data) && prodData.data.length > 0)

  const product1 = prodData.data[0]
  const product2 = prodData.data[1] || prodData.data[0]
  assert('Sample product has valid price & variants', product1.price > 0 && Array.isArray(product1.variants), `(${product1.name} - ₹${product1.price})`)

  // Single product fetch
  const singleRes = await fetch(`${BASE_URL}/products/${product1.id}`)
  const singleData = await singleRes.json()
  assert('GET /products/:id returns single product', singleRes.status === 200)
  assert('Product name matches', (singleData.data?.name || singleData.name) === product1.name)

  // Store settings
  const setRes = await fetch(`${BASE_URL}/settings/public`)
  const setData = await setRes.json()
  assert('GET /settings/public returns 200 OK', setRes.status === 200)
  assert('Settings has INR currency', setData.data?.currency === 'INR')
  assert('Settings has standard shipping fee', typeof setData.data?.standardShippingFee === 'number')

  // ----------------------------------------------------
  // STAGE 3: AUTHENTICATION, JWT & AUTHORIZATION
  // ----------------------------------------------------
  console.log('\n>>> STAGE 3: AUTHENTICATION & ACCESS CONTROL <<<')
  const timestamp = Date.now()
  const userA_Email = `user_a_${timestamp}@svhub.in`
  const userB_Email = `user_b_${timestamp}@svhub.in`
  const password = 'TestUser@123'
  const phoneA = '9' + String(Math.floor(100000000 + Math.random() * 900000000))
  const phoneB = '9' + String(Math.floor(100000000 + Math.random() * 900000000))

  // Register User A
  const regARes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'User A', email: userA_Email, password, phone: phoneA }),
  })
  const regAData = await regARes.json()
  assert('Register User A returns 201/200', regARes.status === 201 || regARes.status === 200)
  const tokenA = regAData.token || regAData.data?.token
  assert('User A has valid JWT token', Boolean(tokenA))

  // Duplicate email rejection
  const dupRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'User A Dup', email: userA_Email, password, phone: phoneA }),
  })
  assert('Duplicate email registration is rejected', dupRes.status === 400 || dupRes.status === 409)

  // Register User B
  const regBRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'User B', email: userB_Email, password, phone: phoneB }),
  })
  const regBData = await regBRes.json()
  const tokenB = regBData.token || regBData.data?.token
  assert('Register User B succeeds', Boolean(tokenB))

  // Authenticate /auth/me for User A
  const meRes = await fetch(`${BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const meData = await meRes.json()
  assert('GET /auth/me returns User A profile', meRes.status === 200)
  assert('Profile email matches User A', (meData.user?.email || meData.data?.email) === userA_Email)

  // Tampered/Invalid JWT
  const badJwtRes = await fetch(`${BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer forged.tampered.token.abc` },
  })
  assert('Tampered JWT is rejected with 401', badJwtRes.status === 401)

  // Customer attempting Admin route
  const adminAttemptRes = await fetch(`${BASE_URL}/admin/orders`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert('Customer token accessing admin route is forbidden (403)', adminAttemptRes.status === 403)

  // ----------------------------------------------------
  // STAGE 4: SHOPPING CART MANAGEMENT
  // ----------------------------------------------------
  console.log('\n>>> STAGE 4: SHOPPING CART OPERATIONS <<<')
  const v1 = product1.variants?.[0]?.variantId || product1.variants?.[0]?.id || 'standard'

  // Add Item 1 (qty: 2)
  const addCartRes = await fetch(`${BASE_URL}/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ productId: product1.id, variantId: v1, quantity: 2 }),
  })
  const addCartData = await addCartRes.json()
  assert('POST /cart/items adds item 1', addCartRes.status === 200)
  let cartItems = addCartData.cart?.items || addCartData.data?.items || addCartData.items || []
  assert('Cart item quantity is 2', cartItems.find((i) => (i.productId?.id || i.productId) === product1.id)?.quantity === 2)

  // Add Item 2 if available
  if (product2.id !== product1.id) {
    const v2 = product2.variants?.[0]?.variantId || product2.variants?.[0]?.id || 'standard'
    const addCart2 = await fetch(`${BASE_URL}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ productId: product2.id, variantId: v2, quantity: 1 }),
    })
    assert('POST /cart/items adds item 2', addCart2.status === 200)
  }

  // Get persistent cart
  const getCartRes = await fetch(`${BASE_URL}/cart`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const getCartData = await getCartRes.json()
  assert('GET /cart returns updated items', getCartRes.status === 200)
  const finalCartItems = getCartData.cart?.items || getCartData.data?.items || getCartData.items || []
  assert('Cart has expected lines', finalCartItems.length >= 1)

  // ----------------------------------------------------
  // STAGE 5: ADDRESS BOOK
  // ----------------------------------------------------
  console.log('\n>>> STAGE 5: ADDRESS BOOK MANAGEMENT <<<')
  const addrRes = await fetch(`${BASE_URL}/addresses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: 'User A Recipient',
      phone: phoneA,
      street: 'Plot 42, Hitech City Main Road',
      city: 'Hyderabad',
      state: 'Telangana',
      pin: '500081',
      label: 'Office',
    }),
  })
  const addrData = await addrRes.json()
  assert('POST /addresses creates address', addrRes.status === 201 || addrRes.status === 200)
  const addressId = addrData.data?.id || addrData.address?._id || addrData.address?.id || addrData.data?._id || addrData._id
  assert('Address ID is returned', Boolean(addressId))

  // List addresses
  const listAddrRes = await fetch(`${BASE_URL}/addresses`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  const listAddrData = await listAddrRes.json()
  assert('GET /addresses lists customer addresses', listAddrRes.status === 200)
  const addrs = listAddrData.data || listAddrData.addresses || []
  assert('Created address appears in customer address list', addrs.some((a) => (a.id || a._id) === addressId))

  // ----------------------------------------------------
  // STAGE 6: ORDER PLACEMENT & RAZORPAY GATEWAY
  // ----------------------------------------------------
  console.log('\n>>> STAGE 6: ORDER PLACEMENT & RAZORPAY INTEGRATION <<<')
  const orderRes = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      addressId,
      notes: 'Stage 6 Verification Order',
    }),
  })
  const orderData = await orderRes.json()
  assert('POST /orders places new order', orderRes.status === 201 || orderRes.status === 200)
  const order = orderData.order || orderData.data
  const orderId = order?.id || order?._id
  assert('Order has human-readable orderNumber', Boolean(order?.orderNumber), `(${order?.orderNumber})`)
  assert('Order status is PENDING_PAYMENT', order?.status === 'PENDING_PAYMENT')
  assert('Order paymentStatus is PENDING', order?.paymentStatus === 'PENDING')
  assert('Authoritative total calculated', order?.totalAmount > 0, `(Total: ₹${order?.totalAmount})`)

  // IDOR check: User B attempting to view User A's order
  const idorRes = await fetch(`${BASE_URL}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  })
  assert('Cross-customer order access (IDOR) is rejected with 404', idorRes.status === 404)

  // Owner accessing their own order
  const ownerRes = await fetch(`${BASE_URL}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert('Order owner accessing order succeeds with 200', ownerRes.status === 200)

  // Create Razorpay Gateway Order
  const rzpRes = await fetch(`${BASE_URL}/payments/razorpay/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ orderId }),
  })
  const rzpData = await rzpRes.json()
  assert('POST /payments/razorpay/create-order returns 200 OK', rzpRes.status === 200)
  const rzpOrderId = rzpData.data?.razorpayOrderId || rzpData.razorpayOrderId || rzpData.data?.orderId || rzpData.orderId
  assert('Razorpay order created upstream on api.razorpay.com', Boolean(rzpOrderId && rzpOrderId.startsWith('order_')), `(${rzpOrderId})`)
  const expectedPaise = Math.round(order?.totalAmount * 100)
  const actualPaise = rzpData.data?.amount || rzpData.amount
  assert('Gateway paise matches local order total * 100', actualPaise === expectedPaise, `(${actualPaise} paise)`)

  // ----------------------------------------------------
  // STAGE 7: WEBHOOK INGRESS & HMAC CRYPTOGRAPHY
  // ----------------------------------------------------
  console.log('\n>>> STAGE 7: WEBHOOK SECURITY & HMAC VERIFICATION <<<')
  // 1. Missing signature
  const whNoSig = await fetch(`${BASE_URL}/payments/razorpay/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'payment.captured' }),
  })
  assert('Webhook rejects request without signature (400)', whNoSig.status === 400)

  // 2. Invalid signature
  const whBadSig = await fetch(`${BASE_URL}/payments/razorpay/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': '0000000000000000000000000000000000000000000000000000000000000000',
    },
    body: JSON.stringify({ event: 'payment.captured' }),
  })
  assert('Webhook rejects request with invalid HMAC signature (400)', whBadSig.status === 400)

  // 3. Valid signature test (if secret present)
  if (WEBHOOK_SECRET) {
    const rawPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_test_stage7_' + Date.now(),
            entity: 'payment',
            amount: 10000,
            currency: 'INR',
            status: 'failed',
            order_id: 'order_test_fake',
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    })

    const validSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawPayload).digest('hex')

    const whValid = await fetch(`${BASE_URL}/payments/razorpay/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': validSig,
      },
      body: rawPayload,
    })
    const whValidData = await whValid.json()
    assert('Webhook with valid HMAC signature returns 200 OK', whValid.status === 200, `(Response: ${JSON.stringify(whValidData)})`)
  } else {
    console.log('[SKIP] Skipping valid signature test (WEBHOOK_SECRET not loaded locally)')
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n====================================================================')
  console.log(`EXHAUSTIVE TEST COMPLETE: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================================')

  if (failed > 0) process.exit(1)
}

runExhaustiveTest().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})

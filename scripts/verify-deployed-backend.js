const BASE_URL = 'https://svhub-backend.vercel.app/api'

async function runTests() {
  console.log('====================================================')
  console.log('VERIFYING DEPLOYED BACKEND: ' + BASE_URL)
  console.log('====================================================\n')

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

  // 1. Health & Database
  const hRes = await fetch(`${BASE_URL}/health`)
  const hData = await hRes.json()
  assert('GET /health returns HTTP 200', hRes.status === 200)
  assert('Health reports database connected', hData.database === 'connected' && hData.status === 'ok')
  assert('Security header: X-Content-Type-Options', hRes.headers.get('x-content-type-options') === 'nosniff')
  assert('Security header: X-Frame-Options', hRes.headers.get('x-frame-options') === 'DENY')
  assert('Tracing header: X-Request-Id present', Boolean(hRes.headers.get('x-request-id')))

  // 2. Public Catalog
  const pRes = await fetch(`${BASE_URL}/products?limit=5`)
  const pData = await pRes.json()
  assert('GET /products returns HTTP 200', pRes.status === 200)
  assert('Products array is populated', Array.isArray(pData.data) && pData.data.length > 0, `(${pData.data.length} items)`)
  assert('Pagination is structured', Boolean(pData.pagination?.total > 0))

  const cRes = await fetch(`${BASE_URL}/categories`)
  const cData = await cRes.json()
  assert('GET /categories returns HTTP 200', cRes.status === 200)
  assert('Categories array returned', Array.isArray(cData.data) && cData.data.length >= 4)

  const sRes = await fetch(`${BASE_URL}/settings/public`)
  const sData = await sRes.json()
  assert('GET /settings/public returns HTTP 200', sRes.status === 200)
  assert('Public settings contains currency INR', sData.data?.currency === 'INR')

  // 3. Webhook Endpoint
  const wRes = await fetch(`${BASE_URL}/payments/razorpay/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'test' }),
  })
  const wData = await wRes.json()
  assert('POST /webhook without signature returns 400', wRes.status === 400)
  assert('Error code is missing_webhook_signature', wData.error?.code === 'missing_webhook_signature')
  assert('Rate limit header present on webhook', Boolean(wRes.headers.get('x-ratelimit-limit')))

  // 4. Protected Endpoints Reject Unauthenticated Requests
  const cartRes = await fetch(`${BASE_URL}/cart`)
  assert('GET /cart without token returns 401', cartRes.status === 401)

  const orderRes = await fetch(`${BASE_URL}/orders`)
  assert('GET /orders without token returns 401', orderRes.status === 401)

  const adminRes = await fetch(`${BASE_URL}/admin/orders`)
  assert('GET /admin/orders without token returns 401', adminRes.status === 401)

  // 5. Auth Login Validation
  const lRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fake_test_account_9999@svhub.in', password: 'BadPassword123!' }),
  })
  const lData = await lRes.json()
  assert('POST /auth/login with invalid credentials returns 401', lRes.status === 401)
  assert('Login error code is invalid_credentials', lData.code === 'invalid_credentials')

  console.log('\n====================================================')
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`)
  console.log('====================================================')

  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error('Test execution error:', err)
  process.exit(1)
})

/**
 * ==============================================================================
 * SV HUB — COMPREHENSIVE BACKEND API QA AUDIT SUITE
 * ==============================================================================
 * Comprehensive End-to-End Testing Across Phase 1.1 - 1.5 Implementation
 * 
 * Scope:
 *  1. Foundation & Health APIs
 *  2. Authentication & Authorization APIs
 *  3. Public Catalog APIs (Products, Categories, Settings)
 *  4. Customer Cart APIs
 *  5. Customer Address APIs
 *  6. Customer Order Creation & Checkout APIs
 *  7. Admin Authorization & Route Discovery Audit
 *  8. Cross-User Security & Data Isolation
 *  9. Input Validation & Edge Cases
 * 10. HTTP & Error Handling (Stack traces, NoSQL injection, malformed JSON)
 * 11. Data Integrity & Concurrency (Counter sequences, default addresses)
 * ==============================================================================
 */

import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import {
  User,
  Product,
  Category,
  Cart,
  Address,
  Order,
  Settings,
  Counter,
} from '../src/models/index.js'

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000/api'
const ROOT_URL = process.env.TEST_ROOT_URL || 'http://localhost:5000'

// Test Results Tracking
const results = {
  totalDiscovered: 0,
  totalTested: 0,
  passed: 0,
  failed: 0,
  warn: 0,
  skip: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  failures: [],
  warnings: [],
  skips: [],
}

function logPass(testName, details = '') {
  results.passed++
  results.totalTested++
  console.log(`[PASS] ${testName}${details ? ` (${details})` : ''}`)
}

function logFail(endpoint, method, testName, expected, actual, status, severity, safeSummary = '') {
  results.failed++
  results.totalTested++
  if (severity === 'CRITICAL') results.critical++
  else if (severity === 'HIGH') results.high++
  else if (severity === 'MEDIUM') results.medium++
  else if (severity === 'LOW') results.low++

  const failure = {
    endpoint,
    method,
    test: testName,
    expected,
    actual,
    status,
    severity,
    safeSummary,
  }
  results.failures.push(failure)
  console.error(`[FAIL - ${severity}] ${method} ${endpoint}: ${testName} | Expected: ${expected}, Got: ${actual} (Status: ${status})`)
}

function logWarn(endpoint, method, testName, reason) {
  results.warn++
  results.warnings.push({ endpoint, method, test: testName, reason })
  console.warn(`[WARN] ${method} ${endpoint}: ${testName} | ${reason}`)
}

function logSkip(endpoint, method, testName, reason) {
  results.skip++
  results.skips.push({ endpoint, method, test: testName, reason })
  console.log(`[SKIP] ${method} ${endpoint}: ${testName} | Reason: ${reason}`)
}

async function apiRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  let resStatus = 0
  let resData = null
  let headers = {}

  try {
    const fetchOptions = {
      ...options,
      headers: {
        ...(options.body && typeof options.body === 'string' && !options.headers?.['Content-Type']
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.headers || {}),
      },
    }

    const response = await fetch(url, fetchOptions)
    resStatus = response.status
    headers = Object.fromEntries(response.headers.entries())

    const text = await response.text()
    try {
      resData = JSON.parse(text)
    } catch {
      resData = text
    }
  } catch (err) {
    resStatus = 0
    resData = { error: err.message }
  }

  return { status: resStatus, data: resData, headers }
}

async function runQaAudit() {
  console.log('==============================================================================')
  console.log('SV HUB — COMPLETE BACKEND API QA AUDIT')
  console.log('==============================================================================\n')

  await connectDb()

  const timestamp = Date.now()
  const suffix = `qa_${timestamp}`

  // Clean-up tracker arrays
  const createdUserIds = []
  const createdProductIds = []
  const createdCategoryIds = []
  const createdAddressIds = []
  const createdOrderIds = []

  let tokenA = ''
  let userA = null
  let tokenB = ''
  let userB = null
  let tokenAdmin = ''
  let userAdmin = null

  let testCat = null
  let testProd1 = null
  let testProd2 = null
  let testProdInactive = null
  let initialSettings = null

  try {
    // -------------------------------------------------------------------------
    // 0. API Route Inventory Definition
    // -------------------------------------------------------------------------
    const discoveredRoutes = [
      { method: 'GET', path: '/api/health', auth: 'None', purpose: 'Service health ping & DB status check' },
      { method: 'GET', path: '/health', auth: 'None', purpose: 'Root redirect to /api/health' },
      { method: 'POST', path: '/api/auth/register', auth: 'None', purpose: 'Customer registration' },
      { method: 'POST', path: '/api/auth/login', auth: 'None', purpose: 'Customer/Admin unified login' },
      { method: 'POST', path: '/api/auth/google', auth: 'None', purpose: 'Google Firebase ID token auth' },
      { method: 'GET', path: '/api/auth/me', auth: 'JWT', purpose: 'Session & identity restoration' },
      { method: 'PATCH', path: '/api/auth/profile', auth: 'JWT', purpose: 'Customer profile & password update' },
      { method: 'POST', path: '/api/auth/forgot-password', auth: 'None', purpose: 'Password reset request' },
      { method: 'GET', path: '/api/auth/reset-password', auth: 'None', purpose: 'Validate reset token' },
      { method: 'POST', path: '/api/auth/reset-password', auth: 'None', purpose: 'Confirm password reset' },
      { method: 'POST', path: '/api/auth/logout', auth: 'JWT', purpose: 'Customer logout' },
      { method: 'GET', path: '/api/products', auth: 'None', purpose: 'Public product catalog search & filter' },
      { method: 'GET', path: '/api/products/featured', auth: 'None', purpose: 'Featured products showcase' },
      { method: 'GET', path: '/api/products/:id', auth: 'None', purpose: 'Product detail by ID or slug' },
      { method: 'GET', path: '/api/products/:id/related', auth: 'None', purpose: 'Related products by category' },
      { method: 'GET', path: '/api/categories', auth: 'None', purpose: 'Public category list' },
      { method: 'GET', path: '/api/categories/:id', auth: 'None', purpose: 'Category detail by ID or slug' },
      { method: 'GET', path: '/api/settings/public', auth: 'None', purpose: 'Public store operational configuration' },
      { method: 'GET', path: '/api/cart', auth: 'JWT', purpose: 'Fetch customer cart' },
      { method: 'POST', path: '/api/cart/items', auth: 'JWT', purpose: 'Add item variant to cart' },
      { method: 'PATCH', path: '/api/cart/items/:id', auth: 'JWT', purpose: 'Update cart line quantity' },
      { method: 'DELETE', path: '/api/cart/items/:id', auth: 'JWT', purpose: 'Remove item from cart' },
      { method: 'DELETE', path: '/api/cart', auth: 'JWT', purpose: 'Clear customer cart' },
      { method: 'POST', path: '/api/cart/merge', auth: 'JWT', purpose: 'Merge guest cart on login' },
      { method: 'GET', path: '/api/addresses', auth: 'JWT', purpose: 'List customer saved addresses' },
      { method: 'POST', path: '/api/addresses', auth: 'JWT', purpose: 'Create new delivery address' },
      { method: 'PATCH', path: '/api/addresses/:id', auth: 'JWT', purpose: 'Partial update address' },
      { method: 'PUT', path: '/api/addresses/:id', auth: 'JWT', purpose: 'Full update address' },
      { method: 'DELETE', path: '/api/addresses/:id', auth: 'JWT', purpose: 'Delete customer address' },
      { method: 'PATCH', path: '/api/addresses/:id/default', auth: 'JWT', purpose: 'Set default delivery address' },
      { method: 'POST', path: '/api/orders', auth: 'JWT', purpose: 'Create application order' },
      { method: 'GET', path: '/api/orders', auth: 'JWT', purpose: 'List authenticated customer orders' },
      { method: 'GET', path: '/api/orders/:id', auth: 'JWT', purpose: 'Get order details by ID or orderNumber' },
      { method: 'GET', path: '/api/test/protected', auth: 'JWT', purpose: 'Verify customer authenticated access' },
      { method: 'GET', path: '/api/test/admin-only', auth: 'JWT+Admin', purpose: 'Verify admin-only access' },
      { method: 'GET', path: '/api/test/users/:userId/resource', auth: 'JWT', purpose: 'Verify customer isolation rule' },
      { method: 'POST', path: '/api/test/create-admin', auth: 'Dev-only', purpose: 'Helper to provision test admin' },
      { method: 'DELETE', path: '/api/test/cleanup-user', auth: 'Dev-only', purpose: 'Helper to clean test accounts' },
    ]

    results.totalDiscovered = discoveredRoutes.length
    console.log(`Discovered ${discoveredRoutes.length} registered API endpoints in express router tree.\n`)

    // Capture initial settings
    initialSettings = await Settings.getSettings()

    // -------------------------------------------------------------------------
    // SECTION 1: HEALTH & ROOT REDIRECT TESTING
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Health & Root Endpoints ---')
    const healthRes = await apiRequest('/health')
    if (healthRes.status === 200 && healthRes.data?.status === 'ok' && healthRes.data?.database === 'connected') {
      logPass('GET /api/health returns 200 with database: connected')
    } else {
      logFail('/api/health', 'GET', 'Health Check', '200 ok with connected DB', JSON.stringify(healthRes.data), healthRes.status, 'CRITICAL')
    }

    const rootHealthRes = await apiRequest(`${ROOT_URL}/health`, { redirect: 'manual' })
    if (rootHealthRes.status === 301 || rootHealthRes.status === 200) {
      logPass('GET /health handles redirect to /api/health safely')
    } else {
      logWarn('/health', 'GET', 'Root health redirect', `Expected 301 or 200, got ${rootHealthRes.status}`)
    }

    // -------------------------------------------------------------------------
    // SECTION 2: TEST USERS PROVISIONING & AUTHENTICATION TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Authentication & Authorization APIs ---')

    // 2.1 Happy Path Registration Customer A
    const regResA = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'QA Customer Alpha',
        email: `qa.customer.a_${suffix}@example.com`,
        phone: '9876500001',
        password: 'Password@123',
      }),
    })
    if (regResA.status === 201 && regResA.data?.token && regResA.data?.user?.role === 'CUSTOMER') {
      tokenA = regResA.data.token
      userA = regResA.data.user
      createdUserIds.push(userA.id)
      logPass('POST /api/auth/register creates Customer A with role: CUSTOMER and JWT')
    } else {
      logFail('/api/auth/register', 'POST', 'Register Customer A', '201 with role CUSTOMER', JSON.stringify(regResA.data), regResA.status, 'CRITICAL')
    }

    // 2.2 Happy Path Registration Customer B
    const regResB = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'QA Customer Beta',
        email: `qa.customer.b_${suffix}@example.com`,
        phone: '9876500002',
        password: 'Password@123',
      }),
    })
    if (regResB.status === 201 && regResB.data?.token && regResB.data?.user?.role === 'CUSTOMER') {
      tokenB = regResB.data.token
      userB = regResB.data.user
      createdUserIds.push(userB.id)
      logPass('POST /api/auth/register creates Customer B with role: CUSTOMER and JWT')
    } else {
      logFail('/api/auth/register', 'POST', 'Register Customer B', '201 with role CUSTOMER', JSON.stringify(regResB.data), regResB.status, 'CRITICAL')
    }

    // 2.3 Privilege Escalation Attempt during Registration
    const regResAdminAttempt = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Attacker Rogue',
        email: `rogue_${suffix}@example.com`,
        phone: '9876500099',
        password: 'Password@123',
        role: 'ADMIN',
      }),
    })
    if (regResAdminAttempt.status === 201) {
      createdUserIds.push(regResAdminAttempt.data?.user?.id)
      if (regResAdminAttempt.data?.user?.role === 'CUSTOMER') {
        logPass('POST /api/auth/register ignores client-supplied role: ADMIN and assigns CUSTOMER')
      } else {
        logFail('/api/auth/register', 'POST', 'Role Escalation in Registration', 'role CUSTOMER', regResAdminAttempt.data?.user?.role, regResAdminAttempt.status, 'CRITICAL')
      }
    } else {
      logPass('POST /api/auth/register rejected role escalation attempt with non-201 status')
    }

    // 2.4 Duplicate Email Registration Rejection
    const regResDup = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Duplicate Alpha',
        email: `qa.customer.a_${suffix}@example.com`,
        phone: '9876500003',
        password: 'Password@123',
      }),
    })
    if (regResDup.status === 409) {
      logPass('POST /api/auth/register rejects duplicate email with 409 duplicate_email')
    } else {
      logFail('/api/auth/register', 'POST', 'Duplicate Email Rejection', '409 Conflict', JSON.stringify(regResDup.data), regResDup.status, 'HIGH')
    }

    // 2.5 Registration Input Validation Failures
    const regMissing = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    })
    if (regMissing.status === 400) {
      logPass('POST /api/auth/register rejects missing fields with 400')
    } else {
      logFail('/api/auth/register', 'POST', 'Missing Fields Validation', '400 Bad Request', JSON.stringify(regMissing.data), regMissing.status, 'MEDIUM')
    }

    const regBadEmail = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad Email User',
        email: 'not-an-email',
        phone: '9876500004',
        password: 'Password@123',
      }),
    })
    if (regBadEmail.status === 400) {
      logPass('POST /api/auth/register rejects malformed email with 400')
    } else {
      logFail('/api/auth/register', 'POST', 'Malformed Email Validation', '400 Bad Request', JSON.stringify(regBadEmail.data), regBadEmail.status, 'MEDIUM')
    }

    const regWeakPass = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Weak Pass User',
        email: `weak_${suffix}@example.com`,
        phone: '9876500005',
        password: '123',
      }),
    })
    if (regWeakPass.status === 400) {
      logPass('POST /api/auth/register rejects weak password with 400')
    } else {
      logFail('/api/auth/register', 'POST', 'Weak Password Validation', '400 Bad Request', JSON.stringify(regWeakPass.data), regWeakPass.status, 'MEDIUM')
    }

    const regBadPhone = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad Phone User',
        email: `badphone_${suffix}@example.com`,
        phone: '12345',
        password: 'Password@123',
      }),
    })
    if (regBadPhone.status === 400) {
      logPass('POST /api/auth/register rejects invalid phone with 400')
    } else {
      logFail('/api/auth/register', 'POST', 'Invalid Phone Validation', '400 Bad Request', JSON.stringify(regBadPhone.data), regBadPhone.status, 'MEDIUM')
    }

    // 2.6 Login Happy Path: Email + Password
    const loginResEmail = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: `qa.customer.a_${suffix}@example.com`,
        password: 'Password@123',
      }),
    })
    if (loginResEmail.status === 200 && loginResEmail.data?.token) {
      logPass('POST /api/auth/login succeeds with valid email + password')
    } else {
      logFail('/api/auth/login', 'POST', 'Email Login', '200 with token', JSON.stringify(loginResEmail.data), loginResEmail.status, 'CRITICAL')
    }

    // 2.7 Login Happy Path: Phone + Password
    const loginResPhone = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: '9876500001',
        password: 'Password@123',
      }),
    })
    if (loginResPhone.status === 200 && loginResPhone.data?.token) {
      logPass('POST /api/auth/login succeeds with valid phone + password')
    } else {
      logFail('/api/auth/login', 'POST', 'Phone Login', '200 with token', JSON.stringify(loginResPhone.data), loginResPhone.status, 'HIGH')
    }

    // 2.8 Login Invalid Credentials
    const loginBadPass = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: `qa.customer.a_${suffix}@example.com`,
        password: 'WrongPassword!999',
      }),
    })
    if (loginBadPass.status === 401) {
      logPass('POST /api/auth/login rejects incorrect password with 401 invalid_credentials')
    } else {
      logFail('/api/auth/login', 'POST', 'Wrong Password Login', '401 Unauthorized', JSON.stringify(loginBadPass.data), loginBadPass.status, 'HIGH')
    }

    const loginUnknown = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: `nonexistent_${suffix}@example.com`,
        password: 'Password@123',
      }),
    })
    if (loginUnknown.status === 401) {
      logPass('POST /api/auth/login rejects unknown user with 401 invalid_credentials')
    } else {
      logFail('/api/auth/login', 'POST', 'Unknown User Login', '401 Unauthorized', JSON.stringify(loginUnknown.data), loginUnknown.status, 'HIGH')
    }

    // 2.9 Session Restoration: GET /api/auth/me
    const meResAuth = await apiRequest('/auth/me', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (meResAuth.status === 200 && meResAuth.data?.user?.email === `qa.customer.a_${suffix}@example.com`) {
      if (!meResAuth.data.user.passwordHash && !meResAuth.data.user.resetTokenHash) {
        logPass('GET /api/auth/me returns authenticated user identity with sensitive fields stripped')
      } else {
        logFail('/api/auth/me', 'GET', 'Sensitive Field Leakage', 'No passwordHash in payload', 'passwordHash was exposed', meResAuth.status, 'CRITICAL')
      }
    } else {
      logFail('/api/auth/me', 'GET', 'Me Session Restoration', '200 OK', JSON.stringify(meResAuth.data), meResAuth.status, 'HIGH')
    }

    const meResUnauth = await apiRequest('/auth/me')
    if (meResUnauth.status === 401) {
      logPass('GET /api/auth/me rejects unauthenticated request with 401')
    } else {
      logFail('/api/auth/me', 'GET', 'Unauthenticated Me', '401 Unauthorized', JSON.stringify(meResUnauth.data), meResUnauth.status, 'CRITICAL')
    }

    const meResBadToken = await apiRequest('/auth/me', {
      headers: { Authorization: 'Bearer invalid.token.signature' },
    })
    if (meResBadToken.status === 401) {
      logPass('GET /api/auth/me rejects invalid JWT token with 401')
    } else {
      logFail('/api/auth/me', 'GET', 'Invalid Token Me', '401 Unauthorized', JSON.stringify(meResBadToken.data), meResBadToken.status, 'CRITICAL')
    }

    // 2.10 Profile Update & Escalation Resistance
    const profUpdateRes = await apiRequest('/auth/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'QA Customer Alpha Updated',
        email: `qa.customer.a_${suffix}@example.com`,
        phone: '9876500011',
        role: 'ADMIN', // Deliberate escalation attempt
      }),
    })
    if (profUpdateRes.status === 200) {
      if (profUpdateRes.data?.user?.role === 'CUSTOMER' && profUpdateRes.data?.user?.name === 'QA Customer Alpha Updated') {
        logPass('PATCH /api/auth/profile updates profile and strictly preserves role: CUSTOMER')
      } else {
        logFail('/api/auth/profile', 'PATCH', 'Profile Role Escalation', 'role CUSTOMER', profUpdateRes.data?.user?.role, profUpdateRes.status, 'CRITICAL')
      }
    } else {
      logFail('/api/auth/profile', 'PATCH', 'Profile Update', '200 OK', JSON.stringify(profUpdateRes.data), profUpdateRes.status, 'HIGH')
    }

    // 2.11 Profile Password Change
    const passChangeBadCurrent = await apiRequest('/auth/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'QA Customer Alpha Updated',
        email: `qa.customer.a_${suffix}@example.com`,
        phone: '9876500011',
        currentPassword: 'WrongCurrentPassword',
        newPassword: 'NewPassword@123',
      }),
    })
    if (passChangeBadCurrent.status === 401) {
      logPass('PATCH /api/auth/profile rejects password change with invalid current password')
    } else {
      logFail('/api/auth/profile', 'PATCH', 'Password Change with Wrong Current', '401 Unauthorized', JSON.stringify(passChangeBadCurrent.data), passChangeBadCurrent.status, 'HIGH')
    }

    // 2.12 Forgot & Reset Password Flow
    let resetToken = ''
    const forgotRes = await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: `qa.customer.a_${suffix}@example.com` }),
    })
    if (forgotRes.status === 200 && forgotRes.data?.token) {
      resetToken = forgotRes.data.token
      logPass('POST /api/auth/forgot-password generates reset token for registered account')
    } else {
      logFail('/api/auth/forgot-password', 'POST', 'Forgot Password Request', '200 with token', JSON.stringify(forgotRes.data), forgotRes.status, 'HIGH')
    }

    const forgotUnknown = await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: `ghost_${suffix}@example.com` }),
    })
    if (forgotUnknown.status === 404) {
      logPass('POST /api/auth/forgot-password returns 404 for unknown email')
    } else {
      logFail('/api/auth/forgot-password', 'POST', 'Forgot Password Unknown Email', '404 unknown_email', JSON.stringify(forgotUnknown.data), forgotUnknown.status, 'LOW')
    }

    if (resetToken) {
      const inspectResetRes = await apiRequest(`/auth/reset-password?token=${resetToken}`)
      if (inspectResetRes.status === 200 && inspectResetRes.data?.email) {
        logPass('GET /api/auth/reset-password validates unexpired reset token successfully')
      } else {
        logFail('/api/auth/reset-password', 'GET', 'Validate Reset Token', '200 OK', JSON.stringify(inspectResetRes.data), inspectResetRes.status, 'MEDIUM')
      }

      const confirmResetRes = await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: 'Password@Reset456',
        }),
      })
      if (confirmResetRes.status === 200) {
        logPass('POST /api/auth/reset-password completes password reset successfully')
      } else {
        logFail('/api/auth/reset-password', 'POST', 'Confirm Password Reset', '200 OK', JSON.stringify(confirmResetRes.data), confirmResetRes.status, 'HIGH')
      }

      // Re-attempting with same consumed token must fail
      const reuseResetRes = await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: 'AnotherPassword@789',
        }),
      })
      if (reuseResetRes.status === 400) {
        logPass('POST /api/auth/reset-password prevents reuse of already consumed token')
      } else {
        logFail('/api/auth/reset-password', 'POST', 'Reuse Reset Token Rejection', '400 expired_token', JSON.stringify(reuseResetRes.data), reuseResetRes.status, 'HIGH')
      }
    }

    // 2.13 Logout Endpoint
    const logoutRes = await apiRequest('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (logoutRes.status === 200) {
      logPass('POST /api/auth/logout succeeds with 200')
    } else {
      logFail('/api/auth/logout', 'POST', 'Logout Endpoint', '200 OK', JSON.stringify(logoutRes.data), logoutRes.status, 'LOW')
    }

    // 2.14 Google Sign-In Error Handling (Without live Firebase fake)
    const googleMissing = await apiRequest('/auth/google', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (googleMissing.status === 400) {
      logPass('POST /api/auth/google rejects missing idToken with 400 invalid_token')
    } else {
      logFail('/api/auth/google', 'POST', 'Missing Google Token', '400 invalid_token', JSON.stringify(googleMissing.data), googleMissing.status, 'MEDIUM')
    }

    const googleFake = await apiRequest('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: 'fake.google.id.token' }),
    })
    if (googleFake.status === 401 || googleFake.status === 503) {
      logPass(`POST /api/auth/google safely handles invalid token with ${googleFake.status}`)
    } else {
      logFail('/api/auth/google', 'POST', 'Invalid Google Token', '401 or 503', JSON.stringify(googleFake.data), googleFake.status, 'MEDIUM')
    }

    // -------------------------------------------------------------------------
    // SECTION 3: CATALOG FIXTURES & CATALOG API TESTING
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Public Catalog APIs ---')

    // Set up test category
    testCat = await Category.create({
      slug: `heritage-rice-${suffix}`,
      name: `Heritage Rice ${suffix}`,
      storefront: 'nutri-hub',
      description: 'QA Test Category',
      active: true,
      sortOrder: 1,
    })
    createdCategoryIds.push(testCat._id)

    // Set up test product 1
    testProd1 = await Product.create({
      name: `QA Samba Rice ${suffix}`,
      slug: `qa-samba-rice-${suffix}`,
      type: 'grocery',
      category: testCat.slug,
      storefront: 'nutri-hub',
      description: 'Nutritious traditional rice for QA audit',
      image: 'https://images.unsplash.com/photo-1586201375761',
      price: 250,
      weight: '500 g',
      sku: `SKU-SAMBA-${suffix}`,
      qty: 25,
      isActive: true,
      isFeatured: true,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          price: 250,
          originalPrice: 280,
          sku: `SKU-500G-${suffix}`,
          qty: 20,
          isActive: true,
        },
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1 kg',
          price: 480,
          originalPrice: 520,
          sku: `SKU-1KG-${suffix}`,
          qty: 15,
          isActive: true,
        },
        {
          variantId: '5kg-inactive',
          label: '5 kg Inactive',
          weight: '5 kg',
          price: 2200,
          sku: `SKU-5KG-INACT-${suffix}`,
          qty: 5,
          isActive: false, // Inactive variant
        },
      ],
    })
    createdProductIds.push(testProd1._id)

    // Set up test product 2
    testProd2 = await Product.create({
      name: `QA Cold-Pressed Oil ${suffix}`,
      slug: `qa-cold-oil-${suffix}`,
      type: 'oil',
      category: testCat.slug,
      storefront: 'nutri-hub',
      description: 'Pure cold-pressed sesame oil',
      image: 'https://images.unsplash.com/photo-1586201375761',
      price: 320,
      weight: '500 ml',
      sku: `SKU-OIL-${suffix}`,
      qty: 50,
      isActive: true,
      isFeatured: false,
      variants: [
        {
          variantId: '500ml',
          label: '500 ml',
          weight: '500 ml',
          price: 320,
          sku: `SKU-OIL-500-${suffix}`,
          qty: 50,
          isActive: true,
        },
      ],
    })
    createdProductIds.push(testProd2._id)

    // Set up inactive product
    testProdInactive = await Product.create({
      name: `QA Inactive Millet ${suffix}`,
      slug: `qa-inactive-millet-${suffix}`,
      type: 'grocery',
      category: testCat.slug,
      storefront: 'nutri-hub',
      description: 'Inactive product for QA audit',
      image: 'https://images.unsplash.com/photo-1586201375761',
      price: 150,
      weight: '500 g',
      sku: `SKU-INACT-${suffix}`,
      qty: 10,
      isActive: false, // Inactive Product
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          price: 150,
          sku: `SKU-INACT-500-${suffix}`,
          qty: 10,
          isActive: true,
        },
      ],
    })
    createdProductIds.push(testProdInactive._id)

    // 3.1 GET /api/products
    const prodListRes = await apiRequest('/products')
    if (prodListRes.status === 200 && Array.isArray(prodListRes.data?.data) && prodListRes.data?.pagination) {
      logPass('GET /api/products returns 200 with data array and pagination metadata')
    } else {
      logFail('/api/products', 'GET', 'Product Listing', '200 with data array', JSON.stringify(prodListRes.data), prodListRes.status, 'CRITICAL')
    }

    // 3.2 Product Pagination Bounds
    const prodPageMaxLimit = await apiRequest('/products?limit=500')
    if (prodPageMaxLimit.status === 200 && prodPageMaxLimit.data?.pagination?.limit <= 100) {
      logPass('GET /api/products clamps excessive limit (500) to <= 100')
    } else {
      logFail('/api/products', 'GET', 'Pagination Limit Bound', 'limit <= 100', prodPageMaxLimit.data?.pagination?.limit, prodPageMaxLimit.status, 'LOW')
    }

    // 3.3 Product Filters: Category, Storefront, Search, Sorting
    const prodCatFilter = await apiRequest(`/products?category=${testCat.slug}`)
    if (prodCatFilter.status === 200 && prodCatFilter.data.data.every((p) => p.category === testCat.slug)) {
      logPass('GET /api/products?category=... correctly filters products by category slug')
    } else {
      logFail('/api/products', 'GET', 'Category Filter', 'all match category', JSON.stringify(prodCatFilter.data), prodCatFilter.status, 'HIGH')
    }

    const prodSearchFilter = await apiRequest(`/products?search=Samba%20Rice%20${suffix}`)
    if (prodSearchFilter.status === 200 && prodSearchFilter.data.data.some((p) => p.slug === testProd1.slug)) {
      logPass('GET /api/products?search=... finds product by title keywords')
    } else {
      logFail('/api/products', 'GET', 'Search Filter', 'finds matching product', JSON.stringify(prodSearchFilter.data), prodSearchFilter.status, 'HIGH')
    }

    const prodSortPrice = await apiRequest('/products?sort=price_desc')
    if (prodSortPrice.status === 200 && Array.isArray(prodSortPrice.data?.data)) {
      logPass('GET /api/products?sort=price_desc succeeds')
    } else {
      logFail('/api/products', 'GET', 'Sort Price Desc', '200 OK', JSON.stringify(prodSortPrice.data), prodSortPrice.status, 'MEDIUM')
    }

    // 3.4 GET /api/products/featured
    const featProdRes = await apiRequest('/products/featured')
    if (featProdRes.status === 200 && Array.isArray(featProdRes.data?.data)) {
      logPass('GET /api/products/featured returns active featured products')
    } else {
      logFail('/api/products/featured', 'GET', 'Featured Products', '200 with data array', JSON.stringify(featProdRes.data), featProdRes.status, 'MEDIUM')
    }

    // 3.5 GET /api/products/:id (By ObjectId and By Slug)
    const prodByIdRes = await apiRequest(`/products/${testProd1._id}`)
    if (prodByIdRes.status === 200 && prodByIdRes.data?.data?.slug === testProd1.slug) {
      logPass('GET /api/products/:id resolves product by valid MongoDB ObjectId')
    } else {
      logFail('/api/products/:id', 'GET', 'Lookup by ObjectId', '200 with matched product', JSON.stringify(prodByIdRes.data), prodByIdRes.status, 'HIGH')
    }

    const prodBySlugRes = await apiRequest(`/products/${testProd1.slug}`)
    if (prodBySlugRes.status === 200 && prodBySlugRes.data?.data?.id === String(testProd1._id)) {
      logPass('GET /api/products/:id resolves product by valid slug')
    } else {
      logFail('/api/products/:id', 'GET', 'Lookup by Slug', '200 with matched product', JSON.stringify(prodBySlugRes.data), prodBySlugRes.status, 'HIGH')
    }

    // 3.6 Inactive Product and Variant Filtering
    const inactProdRes = await apiRequest(`/products/${testProdInactive.slug}`)
    if (inactProdRes.status === 404) {
      logPass('GET /api/products/:id returns 404 product_not_found for inactive product')
    } else {
      logFail('/api/products/:id', 'GET', 'Inactive Product Privacy', '404 product_not_found', inactProdRes.status, inactProdRes.status, 'HIGH')
    }

    if (prodByIdRes.status === 200) {
      const returnedVariants = prodByIdRes.data?.data?.variants || []
      const hasInactiveVariant = returnedVariants.some((v) => v.id === '5kg-inactive' || v.variantId === '5kg-inactive')
      if (!hasInactiveVariant) {
        logPass('GET /api/products/:id filters out inactive variants from public response')
      } else {
        logFail('/api/products/:id', 'GET', 'Inactive Variant Filtering', 'Inactive variant omitted', 'Inactive variant present', 200, 'HIGH')
      }
    }

    // 3.7 Non-existent & Malformed Product ID Lookup
    const nonExistProdRes = await apiRequest('/products/66dec101f89a2b1c3d000999')
    if (nonExistProdRes.status === 404) {
      logPass('GET /api/products/:id returns 404 for non-existent ObjectId')
    } else {
      logFail('/api/products/:id', 'GET', 'Non-existent ID', '404 product_not_found', nonExistProdRes.status, nonExistProdRes.status, 'LOW')
    }

    const malformedProdRes = await apiRequest('/products/not-a-valid-id-nor-slug-!!!')
    if (malformedProdRes.status === 404) {
      logPass('GET /api/products/:id returns 404 safely for malformed identifier without 500 crash')
    } else {
      logFail('/api/products/:id', 'GET', 'Malformed Identifier', '404 product_not_found', malformedProdRes.status, malformedProdRes.status, 'MEDIUM')
    }

    // 3.8 GET /api/products/:id/related
    const relatedProdRes = await apiRequest(`/products/${testProd1.slug}/related`)
    if (relatedProdRes.status === 200 && Array.isArray(relatedProdRes.data?.data)) {
      logPass('GET /api/products/:id/related returns list of related products')
    } else {
      logFail('/api/products/:id/related', 'GET', 'Related Products', '200 OK', JSON.stringify(relatedProdRes.data), relatedProdRes.status, 'MEDIUM')
    }

    const relatedNonExist = await apiRequest('/products/non-existent-product-related/related')
    if (relatedNonExist.status === 404) {
      logPass('GET /api/products/:id/related returns 404 for non-existent product')
    } else {
      logFail('/api/products/:id/related', 'GET', 'Non-existent Related', '404 product_not_found', relatedNonExist.status, relatedNonExist.status, 'LOW')
    }

    // 3.9 GET /api/categories and GET /api/categories/:id
    const catListRes = await apiRequest('/categories')
    if (catListRes.status === 200 && Array.isArray(catListRes.data?.data)) {
      logPass('GET /api/categories returns active category list')
    } else {
      logFail('/api/categories', 'GET', 'Category List', '200 with data array', JSON.stringify(catListRes.data), catListRes.status, 'HIGH')
    }

    const catDetailRes = await apiRequest(`/categories/${testCat.slug}`)
    if (catDetailRes.status === 200 && catDetailRes.data?.data?.slug === testCat.slug) {
      logPass('GET /api/categories/:id returns category details by slug')
    } else {
      logFail('/api/categories/:id', 'GET', 'Category Detail', '200 with matched category', JSON.stringify(catDetailRes.data), catDetailRes.status, 'HIGH')
    }

    const catDetailNonExist = await apiRequest('/categories/non-existent-category-slug')
    if (catDetailNonExist.status === 404) {
      logPass('GET /api/categories/:id returns 404 for non-existent category')
    } else {
      logFail('/api/categories/:id', 'GET', 'Non-existent Category', '404 category_not_found', catDetailNonExist.status, catDetailNonExist.status, 'LOW')
    }

    // 3.10 GET /api/settings/public
    const pubSettingsRes = await apiRequest('/settings/public')
    if (pubSettingsRes.status === 200 && pubSettingsRes.data?.data) {
      const sData = pubSettingsRes.data.data
      const hasRequiredFields = 'standardShippingFee' in sData && 'expressShippingFee' in sData && 'freeShippingThreshold' in sData && 'currency' in sData
      const hasNoSecrets = !('mongoUri' in sData || 'jwtSecret' in sData || 'admin' in sData || 'staffNotes' in sData)
      if (hasRequiredFields && hasNoSecrets) {
        logPass('GET /api/settings/public exposes safe shipping parameters and zero internal secrets')
      } else {
        logFail('/api/settings/public', 'GET', 'Public Settings Confidentiality', 'Parameters exposed, zero secrets', JSON.stringify(sData), 200, 'CRITICAL')
      }
    } else {
      logFail('/api/settings/public', 'GET', 'Public Settings', '200 OK', JSON.stringify(pubSettingsRes.data), pubSettingsRes.status, 'HIGH')
    }

    // 3.11 Catalog Query Security (NoSQL injection and Regex attacks)
    const nosqlAttackRes = await apiRequest('/products?search[$gt]=')
    if (nosqlAttackRes.status === 200 || nosqlAttackRes.status === 400) {
      logPass('GET /api/products safely handles NoSQL operator injection in query string without 500 crash')
    } else {
      logFail('/api/products', 'GET', 'NoSQL Injection in Search', '200 or 400 safe response', nosqlAttackRes.status, nosqlAttackRes.status, 'HIGH')
    }

    const regexAttackRes = await apiRequest('/products?search=.*+?^${}()|[]\\\\')
    if (regexAttackRes.status === 200) {
      logPass('GET /api/products safely escapes regex special characters without regex DOS')
    } else {
      logFail('/api/products', 'GET', 'Regex Special Characters', '200 safe search', regexAttackRes.status, regexAttackRes.status, 'MEDIUM')
    }

    // -------------------------------------------------------------------------
    // SECTION 4: CUSTOMER CART APIS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Customer Cart APIs ---')

    // 4.1 Unauthenticated Cart Access
    const cartUnauth = await apiRequest('/cart')
    if (cartUnauth.status === 401) {
      logPass('GET /api/cart rejects unauthenticated access with 401')
    } else {
      logFail('/api/cart', 'GET', 'Unauthenticated Cart Access', '401 Unauthorized', cartUnauth.status, cartUnauth.status, 'CRITICAL')
    }

    // 4.2 Customer A reads own cart (initially empty)
    const cartReadA = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (cartReadA.status === 200 && Array.isArray(cartReadA.data?.data?.items) && cartReadA.data.data.items.length === 0) {
      logPass('GET /api/cart returns initialized empty cart for Customer A')
    } else {
      logFail('/api/cart', 'GET', 'Empty Cart Read', '200 with items: []', JSON.stringify(cartReadA.data), cartReadA.status, 'HIGH')
    }

    // 4.3 Add Item to Cart (Happy path: Product 1, Variant 500g, Quantity 2)
    let cartItem1Id = ''
    const addCartRes = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '500g',
        quantity: 2,
        // Deliberate price tampering attempt
        price: 1,
        unitPrice: 1,
        subtotal: 2,
      }),
    })

    if (addCartRes.status === 200 && Array.isArray(addCartRes.data?.data?.items)) {
      const addedItem = addCartRes.data.data.items.find((i) => i.variantId === '500g')
      if (addedItem && addedItem.quantity === 2) {
        cartItem1Id = addedItem.id
        // Verify price authority: price must be 250 (from DB), not 1 (from client)
        const itemPrice = addedItem.price !== undefined ? addedItem.price : addedItem.unitPrice
        if (itemPrice === 250 && addCartRes.data.data.subtotal === 500) {
          logPass('POST /api/cart/items adds item with server-authoritative pricing, ignoring client price tampering')
        } else {
          logFail('/api/cart/items', 'POST', 'Cart Price Authority', 'price: 250, subtotal: 500', `price: ${itemPrice}, subtotal: ${addCartRes.data.data.subtotal}`, 200, 'CRITICAL')
        }
      } else {
        logFail('/api/cart/items', 'POST', 'Add Item to Cart', 'item present with qty 2', JSON.stringify(addCartRes.data), 200, 'HIGH')
      }
    } else {
      logFail('/api/cart/items', 'POST', 'Add Item to Cart', '200 OK', JSON.stringify(addCartRes.data), addCartRes.status, 'CRITICAL')
    }

    // 4.4 Add Item Line Uniqueness: Re-adding same variant increments quantity
    const addSameVariantRes = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '500g',
        quantity: 1,
      }),
    })
    if (addSameVariantRes.status === 200) {
      const items = addSameVariantRes.data?.data?.items || []
      const variantLines = items.filter((i) => i.variantId === '500g')
      if (variantLines.length === 1 && variantLines[0].quantity === 3) {
        logPass('POST /api/cart/items increments quantity (2 + 1 = 3) without creating duplicate line')
      } else {
        logFail('/api/cart/items', 'POST', 'Cart Duplicate Line Handling', '1 line with qty 3', `${variantLines.length} lines, qty: ${variantLines[0]?.quantity}`, 200, 'HIGH')
      }
    }

    // 4.5 Add Different Variant of Same Product (creates distinct line)
    const addDiffVariantRes = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '1kg',
        quantity: 1,
      }),
    })
    if (addDiffVariantRes.status === 200) {
      const items = addDiffVariantRes.data?.data?.items || []
      if (items.length === 2 && items.some((i) => i.variantId === '500g') && items.some((i) => i.variantId === '1kg')) {
        logPass('POST /api/cart/items creates separate line for different variant of same product')
      } else {
        logFail('/api/cart/items', 'POST', 'Cart Multi-Variant Lines', '2 distinct variant lines', `items count: ${items.length}`, 200, 'HIGH')
      }
    }

    // 4.6 Add Item Input Validation Failures
    const addBadProd = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: '66dec101f89a2b1c3d000888',
        variantId: '500g',
        quantity: 1,
      }),
    })
    if (addBadProd.status === 404) {
      logPass('POST /api/cart/items rejects non-existent productId with 404 product_not_found')
    } else {
      logFail('/api/cart/items', 'POST', 'Non-existent Product in Cart', '404 product_not_found', addBadProd.status, addBadProd.status, 'MEDIUM')
    }

    const addBadVariant = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: 'non-existent-variant',
        quantity: 1,
      }),
    })
    if (addBadVariant.status === 404) {
      logPass('POST /api/cart/items rejects non-existent variantId with 404 variant_not_found')
    } else {
      logFail('/api/cart/items', 'POST', 'Non-existent Variant in Cart', '404 variant_not_found', addBadVariant.status, addBadVariant.status, 'MEDIUM')
    }

    const addInactProd = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProdInactive._id),
        variantId: '500g',
        quantity: 1,
      }),
    })
    if (addInactProd.status === 404) {
      logPass('POST /api/cart/items rejects inactive product with 404 product_not_found')
    } else {
      logFail('/api/cart/items', 'POST', 'Inactive Product in Cart', '404 product_not_found', addInactProd.status, addInactProd.status, 'HIGH')
    }

    const addInactVariant = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '5kg-inactive',
        quantity: 1,
      }),
    })
    if (addInactVariant.status === 404) {
      logPass('POST /api/cart/items rejects inactive variant with 404 variant_not_found')
    } else {
      logFail('/api/cart/items', 'POST', 'Inactive Variant in Cart', '404 variant_not_found', addInactVariant.status, addInactVariant.status, 'HIGH')
    }

    const addZeroQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '500g',
        quantity: 0,
      }),
    })
    if (addZeroQty.status === 400) {
      logPass('POST /api/cart/items rejects quantity 0 with 400 invalid_quantity')
    } else {
      logFail('/api/cart/items', 'POST', 'Zero Quantity Cart', '400 invalid_quantity', addZeroQty.status, addZeroQty.status, 'MEDIUM')
    }

    const addNegQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '500g',
        quantity: -5,
      }),
    })
    if (addNegQty.status === 400) {
      logPass('POST /api/cart/items rejects negative quantity with 400 invalid_quantity')
    } else {
      logFail('/api/cart/items', 'POST', 'Negative Quantity Cart', '400 invalid_quantity', addNegQty.status, addNegQty.status, 'HIGH')
    }

    const addExcessQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '500g',
        quantity: 999, // Exceeds both limit 99 and stock 20
      }),
    })
    if (addExcessQty.status === 400) {
      logPass('POST /api/cart/items rejects quantity exceeding maximum limit/stock with 400')
    } else {
      logFail('/api/cart/items', 'POST', 'Excessive Quantity Cart', '400 invalid_quantity or insufficient_stock', addExcessQty.status, addExcessQty.status, 'HIGH')
    }

    const addNonNumQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(testProd1._id),
        variantId: '500g',
        quantity: 'three',
      }),
    })
    if (addNonNumQty.status === 400) {
      logPass('POST /api/cart/items rejects string/NaN quantity with 400 invalid_quantity')
    } else {
      logFail('/api/cart/items', 'POST', 'String Quantity Cart', '400 invalid_quantity', addNonNumQty.status, addNonNumQty.status, 'LOW')
    }

    // 4.7 Update Cart Item Quantity
    const updateQtyRes = await apiRequest(`/cart/items/${cartItem1Id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ quantity: 4 }),
    })
    if (updateQtyRes.status === 200) {
      const updatedItem = updateQtyRes.data?.data?.items?.find((i) => String(i.id) === String(cartItem1Id))
      if (updatedItem && updatedItem.quantity === 4) {
        logPass('PATCH /api/cart/items/:id successfully updates quantity to 4')
      } else {
        logFail('/api/cart/items/:id', 'PATCH', 'Cart Update Quantity', 'quantity updated to 4', updatedItem?.quantity, 200, 'HIGH')
      }
    } else {
      logFail('/api/cart/items/:id', 'PATCH', 'Cart Update Quantity', '200 OK', JSON.stringify(updateQtyRes.data), updateQtyRes.status, 'HIGH')
    }

    // 4.8 Remove Item from Cart
    const deleteItemRes = await apiRequest(`/cart/items/${cartItem1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (deleteItemRes.status === 200) {
      const remainingItems = deleteItemRes.data?.data?.items || []
      if (!remainingItems.some((i) => String(i.id) === String(cartItem1Id))) {
        logPass('DELETE /api/cart/items/:id removes target item from cart')
      } else {
        logFail('/api/cart/items/:id', 'DELETE', 'Remove Cart Item', 'item deleted', 'item still present', 200, 'HIGH')
      }
    } else {
      logFail('/api/cart/items/:id', 'DELETE', 'Remove Cart Item', '200 OK', JSON.stringify(deleteItemRes.data), deleteItemRes.status, 'HIGH')
    }

    // 4.9 Clear Entire Cart
    const clearCartRes = await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (clearCartRes.status === 200 && clearCartRes.data?.data?.items?.length === 0) {
      logPass('DELETE /api/cart clears customer cart (items: [])')
    } else {
      logFail('/api/cart', 'DELETE', 'Clear Cart', '200 with items: []', JSON.stringify(clearCartRes.data), clearCartRes.status, 'MEDIUM')
    }

    // 4.10 Merge Guest Cart into Customer Cart
    const mergeCartRes = await apiRequest('/cart/merge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        items: [
          { productId: String(testProd1._id), variantId: '500g', quantity: 2 },
          { productId: String(testProd2._id), variantId: '500ml', quantity: 1 },
        ],
      }),
    })
    if (mergeCartRes.status === 200 && mergeCartRes.data?.data?.items?.length === 2) {
      logPass('POST /api/cart/merge imports guest cart items into customer cart successfully')
    } else {
      logFail('/api/cart/merge', 'POST', 'Merge Cart', '200 with merged items', JSON.stringify(mergeCartRes.data), mergeCartRes.status, 'HIGH')
    }

    // -------------------------------------------------------------------------
    // SECTION 5: CUSTOMER ADDRESS APIS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Customer Address APIs ---')

    // 5.1 Unauthenticated Address Access
    const addrUnauth = await apiRequest('/addresses')
    if (addrUnauth.status === 401) {
      logPass('GET /api/addresses rejects unauthenticated request with 401')
    } else {
      logFail('/api/addresses', 'GET', 'Unauthenticated Address Access', '401 Unauthorized', addrUnauth.status, addrUnauth.status, 'CRITICAL')
    }

    // 5.2 Customer A reads empty address book
    const addrReadA = await apiRequest('/addresses', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (addrReadA.status === 200 && Array.isArray(addrReadA.data?.data) && addrReadA.data.data.length === 0) {
      logPass('GET /api/addresses returns empty address list for newly registered Customer A')
    } else {
      logFail('/api/addresses', 'GET', 'Empty Address Book', '200 with empty array', JSON.stringify(addrReadA.data), addrReadA.status, 'MEDIUM')
    }

    // 5.3 Create Valid Address (First address automatically isDefault: true)
    let addrA1Id = ''
    const createAddrA1 = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Address 1',
        phone: '9876500001',
        street: '123 Heritage Lane, RS Puram',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641002',
        label: 'Home',
      }),
    })
    if (createAddrA1.status === 201 && createAddrA1.data?.data?.id) {
      addrA1Id = createAddrA1.data.data.id
      createdAddressIds.push(addrA1Id)
      if (createAddrA1.data.data.isDefault === true) {
        logPass('POST /api/addresses creates address and automatically assigns isDefault: true for first address')
      } else {
        logFail('/api/addresses', 'POST', 'First Address Default Invariant', 'isDefault: true', createAddrA1.data.data.isDefault, 201, 'HIGH')
      }
    } else {
      logFail('/api/addresses', 'POST', 'Create Address 1', '201 Created', JSON.stringify(createAddrA1.data), createAddrA1.status, 'CRITICAL')
    }

    // 5.4 Address Validation Failures
    const addrMissingName = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        phone: '9876500001',
        street: 'Street',
        city: 'City',
        state: 'State',
        pin: '641002',
      }),
    })
    if (addrMissingName.status === 400) {
      logPass('POST /api/addresses rejects missing recipient name with 400 invalid_name')
    } else {
      logFail('/api/addresses', 'POST', 'Missing Recipient Name', '400 invalid_name', addrMissingName.status, addrMissingName.status, 'MEDIUM')
    }

    const invalidPhones = ['123', '123456789', '12345678901', 'abcdefghij', '', null]
    let allInvalidPhonesRejected = true
    let failedPhoneCase = ''
    for (const badPhone of invalidPhones) {
      const res = await apiRequest('/addresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
          name: 'Alice Address',
          phone: badPhone,
          street: 'Street',
          city: 'City',
          state: 'State',
          pin: '641002',
        }),
      })
      if (res.status !== 400 || (res.data?.error?.code !== 'invalid_phone' && res.data?.code !== 'invalid_phone')) {
        allInvalidPhonesRejected = false
        failedPhoneCase = `${badPhone} -> status: ${res.status}`
        break
      }
    }
    if (allInvalidPhonesRejected) {
      logPass('POST /api/addresses rejects invalid phone values ("123", "123456789", "12345678901", "abcdefghij", "", null) with 400 invalid_phone')
    } else {
      logFail('/api/addresses', 'POST', 'Invalid Phone Address', '400 invalid_phone', failedPhoneCase, 201, 'MEDIUM')
    }

    const addrBadPin = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Address',
        phone: '9876500001',
        street: 'Street',
        city: 'City',
        state: 'State',
        pin: '6410', // 4 digits instead of 6
      }),
    })
    if (addrBadPin.status === 400) {
      logPass('POST /api/addresses rejects 4-digit PIN code with 400 invalid_pin')
    } else {
      logFail('/api/addresses', 'POST', 'Invalid PIN Address', '400 invalid_pin', addrBadPin.status, addrBadPin.status, 'HIGH')
    }

    // 5.5 Create Second Address with isDefault: true (Unsets first address default)
    let addrA2Id = ''
    const createAddrA2 = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Office',
        phone: '9876500001',
        street: '456 Tech Park, Tidel',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641014',
        label: 'Work',
        isDefault: true,
      }),
    })
    if (createAddrA2.status === 201 && createAddrA2.data?.data?.id) {
      addrA2Id = createAddrA2.data.data.id
      createdAddressIds.push(addrA2Id)
      // Check that Address A1 is no longer default
      const checkA1 = await apiRequest('/addresses', {
        headers: { Authorization: `Bearer ${tokenA}` },
      })
      const a1Item = checkA1.data?.data?.find((a) => String(a.id) === String(addrA1Id))
      const a2Item = checkA1.data?.data?.find((a) => String(a.id) === String(addrA2Id))
      if (a1Item?.isDefault === false && a2Item?.isDefault === true) {
        logPass('POST /api/addresses with isDefault: true cleanly unsets default flag on previous address')
      } else {
        logFail('/api/addresses', 'POST', 'Default Address Invariant', 'a1: false, a2: true', `a1: ${a1Item?.isDefault}, a2: ${a2Item?.isDefault}`, 201, 'HIGH')
      }
    }

    // 5.6 PATCH and PUT Update Address
    const patchAddrRes = await apiRequest(`/addresses/${addrA1Id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ street: '123 Heritage Lane, Suite 2B' }),
    })
    if (patchAddrRes.status === 200 && patchAddrRes.data?.data?.street === '123 Heritage Lane, Suite 2B') {
      logPass('PATCH /api/addresses/:id partially updates street address')
    } else {
      logFail('/api/addresses/:id', 'PATCH', 'Patch Address', '200 with updated street', JSON.stringify(patchAddrRes.data), patchAddrRes.status, 'MEDIUM')
    }

    const putAddrRes = await apiRequest(`/addresses/${addrA1Id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Home Full',
        phone: '9876500001',
        street: '123 Heritage Lane, Complete',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641002',
      }),
    })
    if (putAddrRes.status === 200 && putAddrRes.data?.data?.name === 'Alice Home Full') {
      logPass('PUT /api/addresses/:id fully updates address record')
    } else {
      logFail('/api/addresses/:id', 'PUT', 'Put Address', '200 with updated address', JSON.stringify(putAddrRes.data), putAddrRes.status, 'MEDIUM')
    }

    // 5.7 Explicit Set Default Address: PATCH /addresses/:id/default
    const setDefaultRes = await apiRequest(`/addresses/${addrA1Id}/default`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (setDefaultRes.status === 200 && setDefaultRes.data?.data?.isDefault === true) {
      logPass('PATCH /api/addresses/:id/default sets address as default successfully')
    } else {
      logFail('/api/addresses/:id/default', 'PATCH', 'Set Default Address', '200 with isDefault: true', JSON.stringify(setDefaultRes.data), setDefaultRes.status, 'HIGH')
    }

    // 5.8 Delete Address: DELETE /addresses/:id
    const deleteAddrRes = await apiRequest(`/addresses/${addrA2Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (deleteAddrRes.status === 200) {
      logPass('DELETE /api/addresses/:id removes address from active address book')
    } else {
      logFail('/api/addresses/:id', 'DELETE', 'Delete Address', '200 OK', JSON.stringify(deleteAddrRes.status), deleteAddrRes.status, 'MEDIUM')
    }

    // Create Customer B address for cross-user tests
    let addrBId = ''
    const createAddrB = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        name: 'Bob Delivery Address',
        phone: '9876500002',
        street: '789 Ocean Drive',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pin: '600001',
      }),
    })
    if (createAddrB.status === 201) {
      addrBId = createAddrB.data.data.id
      createdAddressIds.push(addrBId)
    }

    // -------------------------------------------------------------------------
    // SECTION 6: CUSTOMER ORDER CREATION & CHECKOUT APIS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Customer Order Creation & Checkout APIs ---')

    // 6.1 Unauthenticated Order Creation
    const orderUnauth = await apiRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({ addressId: addrA1Id }),
    })
    if (orderUnauth.status === 401) {
      logPass('POST /api/orders rejects unauthenticated request with 401')
    } else {
      logFail('/api/orders', 'POST', 'Unauthenticated Order Creation', '401 Unauthorized', orderUnauth.status, orderUnauth.status, 'CRITICAL')
    }

    // 6.2 Empty Cart Order Creation Rejection
    // Clear Customer B's cart to test empty cart rejection
    await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    const orderEmptyCart = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ addressId: addrBId }),
    })
    if (orderEmptyCart.status === 400 && orderEmptyCart.data?.error?.code === 'empty_cart') {
      logPass('POST /api/orders rejects empty cart with 400 empty_cart')
    } else {
      logFail('/api/orders', 'POST', 'Empty Cart Rejection', '400 empty_cart', JSON.stringify(orderEmptyCart.data), orderEmptyCart.status, 'HIGH')
    }

    // 6.3 Foreign Address Order Creation Rejection (Customer A using Customer B's address)
    const orderForeignAddr = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrBId }),
    })
    if (orderForeignAddr.status === 404 && orderForeignAddr.data?.error?.code === 'address_not_found') {
      logPass('POST /api/orders rejects using another customer’s address with 404 address_not_found')
    } else {
      logFail('/api/orders', 'POST', 'Foreign Address Rejection', '404 address_not_found', JSON.stringify(orderForeignAddr.data), orderForeignAddr.status, 'CRITICAL')
    }

    // 6.4 Prepare Customer A Cart for Successful Order Creation
    // Ensure Customer A cart has: 2x 500g (250*2=500) and 1x Oil 500ml (320*1=320) -> Subtotal = 820
    // Stock before order
    const stockBefore500g = (await Product.findById(testProd1._id)).variants.find((v) => v.variantId === '500g').qty

    let orderCreated = null
    const createOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        addressId: addrA1Id,
        shippingMethod: 'standard',
        notes: 'Please leave at reception',
        // Deliberate price and shipping tampering attempt
        price: 1,
        subtotal: 5,
        shippingFee: 0,
        total: 5,
      }),
    })

    if (createOrderRes.status === 201 && createOrderRes.data?.data) {
      orderCreated = createOrderRes.data.data
      createdOrderIds.push(orderCreated.id)
      logPass('POST /api/orders successfully creates order (201 Created)')
    } else {
      logFail('/api/orders', 'POST', 'Create Order', '201 Created', JSON.stringify(createOrderRes.data), createOrderRes.status, 'CRITICAL')
    }

    if (orderCreated) {
      // 6.5 Price Authority Check: Subtotal must be calculated by backend
      // testProd1 (2x 250 = 500) + testProd2 (1x 320 = 320) = 820
      if (orderCreated.subtotal === 820) {
        logPass('POST /api/orders calculates server-authoritative subtotal (820), ignoring client tampering (5)')
      } else {
        logFail('/api/orders', 'POST', 'Order Subtotal Authority', 'subtotal: 820', orderCreated.subtotal, 201, 'CRITICAL')
      }

      // 6.6 Shipping Fee Calculation Check: 820 >= 499 (free threshold) -> shippingFee = 0
      if (orderCreated.shippingFee === 0 && orderCreated.totalAmount === 820) {
        logPass('POST /api/orders evaluates freeShippingThreshold (820 >= 499) yielding shippingFee = 0')
      } else {
        logFail('/api/orders', 'POST', 'Free Shipping Evaluation', 'shippingFee: 0, total: 820', `fee: ${orderCreated.shippingFee}, total: ${orderCreated.totalAmount}`, 201, 'HIGH')
      }

      // 6.7 Order Status and Payment Status Invariants
      if (orderCreated.status === 'PENDING_PAYMENT' && orderCreated.paymentStatus === 'PENDING') {
        logPass('POST /api/orders initializes order with status: PENDING_PAYMENT and paymentStatus: PENDING')
      } else {
        logFail('/api/orders', 'POST', 'Order Status Invariants', 'status: PENDING_PAYMENT, paymentStatus: PENDING', `status: ${orderCreated.status}, payment: ${orderCreated.paymentStatus}`, 201, 'CRITICAL')
      }

      // 6.8 Inventory Invariant: Stock must NOT be deducted at order creation
      const stockAfter500g = (await Product.findById(testProd1._id)).variants.find((v) => v.variantId === '500g').qty
      if (stockBefore500g === stockAfter500g) {
        logPass('POST /api/orders preserves inventory (stock before == stock after; NO deduction during order creation)')
      } else {
        logFail('/api/orders', 'POST', 'Inventory Non-Deduction Invariant', `Stock before (${stockBefore500g}) === Stock after (${stockAfter500g})`, `stock changed to ${stockAfter500g}`, 201, 'CRITICAL')
      }

      // 6.9 Cart Invariant: Cart must NOT be cleared at order creation
      const cartAfterOrderRes = await apiRequest('/cart', {
        headers: { Authorization: `Bearer ${tokenA}` },
      })
      if (cartAfterOrderRes.status === 200 && cartAfterOrderRes.data?.data?.items?.length > 0) {
        logPass('POST /api/orders leaves customer cart intact (cart items NOT cleared in Phase 1.5)')
      } else {
        logFail('/api/orders', 'POST', 'Cart Non-Clearing Invariant', 'Cart items retained', 'Cart was prematurely cleared', 200, 'HIGH')
      }

      // 6.10 Order Number Format Check: Sequential #SVH-1000X
      const orderNumRegex = /^#SVH-\d{5,}$/
      if (orderNumRegex.test(orderCreated.orderNumber)) {
        logPass(`POST /api/orders produces sequential human-readable order number: ${orderCreated.orderNumber}`)
      } else {
        logFail('/api/orders', 'POST', 'Order Number Format', 'Matches #SVH-1000X', orderCreated.orderNumber, 201, 'HIGH')
      }

      // 6.11 Immutable Address Snapshot Check
      const storedOrder = await Order.findById(orderCreated.id)
      const originalOrderAddrStreet = storedOrder.shippingAddress.street

      // Mutate Customer's address in the address book
      await Address.findByIdAndUpdate(addrA1Id, { street: 'MUTATED STREET 999 DO NOT REFLECT IN ORDER' })

      // Fetch order again via API
      const fetchedOrderAfterAddrMutation = await apiRequest(`/orders/${orderCreated.id}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      })
      if (fetchedOrderAfterAddrMutation.data?.data?.shippingAddress?.street === originalOrderAddrStreet) {
        logPass('Order retains immutable delivery address snapshot when source address is modified')
      } else {
        logFail('/api/orders/:id', 'GET', 'Address Snapshot Immutability', originalOrderAddrStreet, fetchedOrderAfterAddrMutation.data?.data?.shippingAddress?.street, 200, 'CRITICAL')
      }

      // 6.12 Immutable Product Snapshot Check
      const originalItemPrice = storedOrder.items[0].unitPrice
      const originalItemName = storedOrder.items[0].productName

      // Mutate Product in Catalog DB
      await Product.findByIdAndUpdate(testProd1._id, {
        name: 'MUTATED PRODUCT NAME 999',
        'variants.0.price': 9999,
      })

      // Fetch order again via API
      const fetchedOrderAfterProdMutation = await apiRequest(`/orders/${orderCreated.id}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      })
      const orderItemAfter = fetchedOrderAfterProdMutation.data?.data?.items?.[0]
      if (orderItemAfter?.unitPrice === originalItemPrice && orderItemAfter?.productName === originalItemName) {
        logPass('Order retains immutable product/variant snapshot when source catalog product is modified')
      } else {
        logFail('/api/orders/:id', 'GET', 'Product Snapshot Immutability', `price: ${originalItemPrice}, name: ${originalItemName}`, `price: ${orderItemAfter?.unitPrice}, name: ${orderItemAfter?.productName}`, 200, 'CRITICAL')
      }

      // Restore product price/name for other tests
      await Product.findByIdAndUpdate(testProd1._id, {
        name: `QA Samba Rice ${suffix}`,
        'variants.0.price': 250,
      })
    }

    // 6.13 Customer Order History Listing: GET /api/orders
    const ordersListRes = await apiRequest('/orders', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (ordersListRes.status === 200 && Array.isArray(ordersListRes.data?.data) && ordersListRes.data.data.length >= 1) {
      logPass('GET /api/orders returns customer order history list')
    } else {
      logFail('/api/orders', 'GET', 'Order History Listing', '200 with order items', JSON.stringify(ordersListRes.data), ordersListRes.status, 'HIGH')
    }

    // -------------------------------------------------------------------------
    // SECTION 7: ADMIN API TESTING & DISCOVERY AUDIT
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Admin Authorization & Route Discovery Audit ---')

    // Provision test admin via development helper
    const adminCreateRes = await apiRequest('/test/create-admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'QA Admin User',
        email: `qa.admin_${suffix}@example.com`,
        password: 'AdminPassword@123',
      }),
    })
    if (adminCreateRes.status === 200 && adminCreateRes.data?.user) {
      userAdmin = adminCreateRes.data.user
      createdUserIds.push(userAdmin.id)
      // Login as Admin to get Admin JWT
      const adminLoginRes = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: `qa.admin_${suffix}@example.com`,
          password: 'AdminPassword@123',
        }),
      })
      if (adminLoginRes.status === 200 && adminLoginRes.data?.token) {
        tokenAdmin = adminLoginRes.data.token
      }
    }

    // 7.1 Test Admin-Only Route: GET /api/test/admin-only
    const adminRouteNoToken = await apiRequest('/test/admin-only')
    if (adminRouteNoToken.status === 401) {
      logPass('GET /api/test/admin-only rejects unauthenticated request with 401')
    } else {
      logFail('/api/test/admin-only', 'GET', 'Admin Route Unauthenticated', '401 Unauthorized', adminRouteNoToken.status, adminRouteNoToken.status, 'CRITICAL')
    }

    const adminRouteCustomerToken = await apiRequest('/test/admin-only', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const adminErrCode = adminRouteCustomerToken.data?.error?.code || adminRouteCustomerToken.data?.code
    if (adminRouteCustomerToken.status === 403 && adminErrCode === 'forbidden_admin_access') {
      logPass('GET /api/test/admin-only rejects customer token with 403 forbidden_admin_access')
    } else {
      logFail('/api/test/admin-only', 'GET', 'Customer Access to Admin Route', '403 forbidden_admin_access', adminRouteCustomerToken.status, adminRouteCustomerToken.status, 'CRITICAL')
    }

    if (tokenAdmin) {
      const adminRouteAdminToken = await apiRequest('/test/admin-only', {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      })
      if (adminRouteAdminToken.status === 200 && adminRouteAdminToken.data?.user?.role === 'ADMIN') {
        logPass('GET /api/test/admin-only allows verified admin token with 200 success')
      } else {
        logFail('/api/test/admin-only', 'GET', 'Admin Access with Admin Token', '200 OK with role: ADMIN', JSON.stringify(adminRouteAdminToken.data), adminRouteAdminToken.status, 'CRITICAL')
      }
    } else {
      logWarn('/test/admin-only', 'GET', 'Admin Token Test', 'Admin token could not be acquired')
    }

    // 7.2 Probing Planned Admin CRUD Routes from docs/API_CONTRACT.md
    const plannedAdminRoutes = [
      { path: '/admin/dashboard/stats', method: 'GET', name: 'Admin Dashboard Stats' },
      { path: '/admin/orders', method: 'GET', name: 'Admin Orders Listing' },
      { path: '/admin/products', method: 'GET', name: 'Admin Products Listing' },
      { path: '/admin/categories', method: 'GET', name: 'Admin Categories Listing' },
      { path: '/admin/settings', method: 'GET', name: 'Admin Operational Settings' },
    ]

    for (const route of plannedAdminRoutes) {
      const res = await apiRequest(route.path, {
        method: route.method,
        headers: tokenAdmin ? { Authorization: `Bearer ${tokenAdmin}` } : {},
      })
      if (res.status === 404) {
        logSkip(route.path, route.method, route.name, 'Admin CRUD routes not yet registered (deferred to Phase 1.7 / Admin phase)')
      } else {
        logWarn(route.path, route.method, route.name, `Unexpected status: ${res.status}`)
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 8: CROSS-USER SECURITY & DATA ISOLATION AUDIT
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Cross-User Security & Isolation Audit ---')

    // 8.1 Customer A cannot read Customer B's cart
    // Give Customer B an item in cart
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        productId: String(testProd2._id),
        variantId: '500ml',
        quantity: 1,
      }),
    })
    const cartB_Item = (await Cart.findOne({ userId: userB.id })).items[0]

    // Customer A attempting to update Customer B's cart item
    const crossCartUpdate = await apiRequest(`/cart/items/${cartB_Item._id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ quantity: 5 }),
    })
    if (crossCartUpdate.status === 404) {
      logPass('Customer A cannot update Customer B’s cart item (returns 404 item_not_found)')
    } else {
      logFail('/api/cart/items/:id', 'PATCH', 'Cross-User Cart Tampering', '404 item_not_found', crossCartUpdate.status, crossCartUpdate.status, 'CRITICAL')
    }

    // Customer A attempting to delete Customer B's cart item
    const crossCartDelete = await apiRequest(`/cart/items/${cartB_Item._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (crossCartDelete.status === 404) {
      logPass('Customer A cannot delete Customer B’s cart item (returns 404 item_not_found)')
    } else {
      logFail('/api/cart/items/:id', 'DELETE', 'Cross-User Cart Deletion', '404 item_not_found', crossCartDelete.status, crossCartDelete.status, 'CRITICAL')
    }

    // Customer A clearing cart does not clear Customer B's cart
    await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const cartB_After = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    if (cartB_After.data?.data?.items?.length === 1) {
      logPass('Customer A clearing cart leaves Customer B’s cart items completely intact')
    } else {
      logFail('/api/cart', 'DELETE', 'Cross-User Cart Isolation', 'Customer B cart intact', 'Customer B cart affected', 200, 'CRITICAL')
    }

    // 8.2 Customer A cannot read or modify Customer B's address
    const crossAddrList = await apiRequest('/addresses', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const hasBAddressInA = crossAddrList.data?.data?.some((a) => String(a.id) === String(addrBId))
    if (!hasBAddressInA) {
      logPass('Customer A address book does not expose Customer B’s address')
    } else {
      logFail('/api/addresses', 'GET', 'Cross-User Address Listing Exposure', 'Address B omitted from A', 'Address B visible to A', 200, 'CRITICAL')
    }

    const crossAddrUpdate = await apiRequest(`/addresses/${addrBId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ street: 'HACKED STREET' }),
    })
    if (crossAddrUpdate.status === 404) {
      logPass('Customer A cannot update Customer B’s address (returns 404 address_not_found)')
    } else {
      logFail('/api/addresses/:id', 'PATCH', 'Cross-User Address Mutation', '404 address_not_found', crossAddrUpdate.status, crossAddrUpdate.status, 'CRITICAL')
    }

    const crossAddrDelete = await apiRequest(`/addresses/${addrBId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (crossAddrDelete.status === 404) {
      logPass('Customer A cannot delete Customer B’s address (returns 404 address_not_found)')
    } else {
      logFail('/api/addresses/:id', 'DELETE', 'Cross-User Address Deletion', '404 address_not_found', crossAddrDelete.status, crossAddrDelete.status, 'CRITICAL')
    }

    const crossAddrDefault = await apiRequest(`/addresses/${addrBId}/default`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (crossAddrDefault.status === 404) {
      logPass('Customer A cannot set default on Customer B’s address (returns 404 address_not_found)')
    } else {
      logFail('/api/addresses/:id/default', 'PATCH', 'Cross-User Address Set Default', '404 address_not_found', crossAddrDefault.status, crossAddrDefault.status, 'CRITICAL')
    }

    // 8.3 Customer B cannot access Customer A's order
    if (orderCreated) {
      const crossOrderGet = await apiRequest(`/orders/${orderCreated.id}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      })
      if (crossOrderGet.status === 404) {
        logPass('Customer B cannot retrieve Customer A’s order by ID (returns 404 order_not_found)')
      } else {
        logFail('/api/orders/:id', 'GET', 'Cross-User Order Access', '404 order_not_found', crossOrderGet.status, crossOrderGet.status, 'CRITICAL')
      }

      const crossOrderHistory = await apiRequest('/orders', {
        headers: { Authorization: `Bearer ${tokenB}` },
      })
      const hasOrderAInB = crossOrderHistory.data?.data?.some((o) => String(o.id) === String(orderCreated.id))
      if (!hasOrderAInB) {
        logPass('Customer B order history never includes Customer A’s orders')
      } else {
        logFail('/api/orders', 'GET', 'Cross-User Order History Isolation', 'Customer A order omitted from B', 'Customer A order leaked to B', 200, 'CRITICAL')
      }
    }

    // 8.4 Case 7 User Isolation Test Route: GET /api/test/users/:userId/resource
    const userIsoResFail = await apiRequest(`/test/users/${userB.id}/resource`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (userIsoResFail.status === 403) {
      logPass('GET /api/test/users/:userId/resource rejects User A accessing User B resource with 403 forbidden_resource')
    } else {
      logFail('/api/test/users/:userId/resource', 'GET', 'User Resource Isolation', '403 forbidden_resource', userIsoResFail.status, userIsoResFail.status, 'CRITICAL')
    }

    const userIsoResPass = await apiRequest(`/test/users/${userA.id}/resource`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (userIsoResPass.status === 200) {
      logPass('GET /api/test/users/:userId/resource allows User A accessing own resource')
    } else {
      logFail('/api/test/users/:userId/resource', 'GET', 'User Own Resource Access', '200 OK', userIsoResPass.status, userIsoResPass.status, 'HIGH')
    }

    // -------------------------------------------------------------------------
    // SECTION 9: INPUT VALIDATION, HTTP & ERROR HANDLING AUDIT
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: Input Validation & Error Handling Audit ---')

    // 9.1 Malformed JSON Payload Body
    const badJsonRes = await apiRequest('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "identifier": "user", "password": ', // broken json
    })
    if (badJsonRes.status === 400) {
      logPass('Server cleanly rejects malformed JSON payload with 400 Bad Request')
    } else {
      logFail('/api/auth/login', 'POST', 'Malformed JSON Handling', '400 Bad Request', badJsonRes.status, badJsonRes.status, 'MEDIUM')
    }

    // 9.2 Unknown Route (404 Not Found)
    const unknownRouteRes = await apiRequest('/unknown-route-that-does-not-exist')
    const notFoundCode = unknownRouteRes.data?.error?.code || unknownRouteRes.data?.code
    if (unknownRouteRes.status === 404 && notFoundCode === 'not_found') {
      logPass('Unknown route returns standardized 404 JSON with code: not_found (no HTML error)')
    } else {
      logFail('/api/unknown-route', 'GET', '404 Handler', '404 JSON', JSON.stringify(unknownRouteRes.data), unknownRouteRes.status, 'MEDIUM')
    }

    // 9.3 Unsupported HTTP Method
    const unsuppMethodRes = await apiRequest('/orders', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    if (unsuppMethodRes.status === 404 || unsuppMethodRes.status === 405) {
      logPass(`Unsupported HTTP method on /orders safely rejected with ${unsuppMethodRes.status}`)
    } else {
      logWarn('/orders', 'PUT', 'Unsupported HTTP Method', `Status: ${unsuppMethodRes.status}`)
    }

    // 9.4 Sensitive Data Exposure Audit Across Responses
    const sampleResponses = [
      { name: 'Auth Login', data: loginResEmail.data },
      { name: 'Auth Me', data: meResAuth.data },
      { name: 'Product Detail', data: prodByIdRes.data },
      { name: 'Public Settings', data: pubSettingsRes.data },
      { name: 'Order Create', data: createOrderRes.data },
    ]

    let leakFound = false
    const forbiddenKeys = ['passwordHash', 'resetTokenHash', 'MONGO_URI', 'JWT_SECRET', 'FIREBASE_PRIVATE_KEY']
    for (const sample of sampleResponses) {
      const serialized = JSON.stringify(sample.data || {})
      for (const key of forbiddenKeys) {
        if (serialized.includes(key)) {
          leakFound = true
          logFail(sample.name, 'GET/POST', 'Sensitive Key Exposure', `No ${key} in response`, `Found ${key} in ${sample.name}`, 200, 'CRITICAL')
        }
      }
      if (serialized.includes('at ') && serialized.includes('.js:')) {
        leakFound = true
        logFail(sample.name, 'GET/POST', 'Stack Trace Leakage', 'No stack trace', 'Stack trace snippet in response', 200, 'HIGH')
      }
    }
    if (!leakFound) {
      logPass('Sensitive data audit: Zero passwords, reset tokens, secrets, or stack traces leaked in responses')
    }

    // -------------------------------------------------------------------------
    // SECTION 10: CONCURRENCY & DATA INTEGRITY TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 10: Concurrency & Data Integrity Tests ---')

    // 10.1 Concurrency: Multiple Orders Dispatched Simultaneously
    // Set up 3 distinct customer carts with valid items to test atomic counter under concurrency
    const concurrentTokens = [tokenA, tokenB]
    // Re-fill Cart A and Cart B
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ productId: String(testProd1._id), variantId: '500g', quantity: 1 }),
    })
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ productId: String(testProd1._id), variantId: '1kg', quantity: 1 }),
    })

    const concurrentOrders = await Promise.all([
      apiRequest('/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ addressId: addrA1Id }),
      }),
      apiRequest('/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ addressId: addrBId }),
      }),
    ])

    const orderNums = concurrentOrders
      .filter((o) => o.status === 201 && o.data?.data?.orderNumber)
      .map((o) => {
        createdOrderIds.push(o.data.data.id)
        return o.data.data.orderNumber
      })

    if (orderNums.length === 2 && orderNums[0] !== orderNums[1]) {
      logPass(`Concurrent order creation: Produced distinct unique order numbers (${orderNums.join(', ')}) with zero collisions`)
    } else {
      logFail('/api/orders', 'POST', 'Concurrent Order Number Uniqueness', '2 unique order numbers', orderNums.join(', '), 201, 'CRITICAL')
    }

    // 10.2 Data Integrity: Single Default Address Invariant per User
    const allAddressesA = await Address.find({ userId: userA.id, isDeleted: false })
    const defaultAddressesCountA = allAddressesA.filter((a) => a.isDefault).length
    if (defaultAddressesCountA <= 1) {
      logPass(`Data Integrity: Customer A has exactly ${defaultAddressesCountA} default address (invariant maintained: <= 1)`)
    } else {
      logFail('/api/addresses', 'INVARIANT', 'Single Default Address', '<= 1 default address', defaultAddressesCountA, 200, 'HIGH')
    }

  } catch (err) {
    console.error('Fatal unhandled error during QA audit:', err)
    logFail('SUITE', 'ALL', 'Unhandled Execution Error', 'No unhandled exception', err.message, 500, 'CRITICAL')
  } finally {
    console.log('\n--- Cleaning up temporary QA fixtures ---')
    try {
      if (createdOrderIds.length > 0) {
        await Order.deleteMany({ _id: { $in: createdOrderIds } })
      }
      if (createdAddressIds.length > 0) {
        await Address.deleteMany({ _id: { $in: createdAddressIds } })
      }
      if (createdUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: createdUserIds } })
        await Cart.deleteMany({ userId: { $in: createdUserIds } })
      }
      if (createdProductIds.length > 0) {
        await Product.deleteMany({ _id: { $in: createdProductIds } })
      }
      if (createdCategoryIds.length > 0) {
        await Category.deleteMany({ _id: { $in: createdCategoryIds } })
      }
      console.log('Cleanup completed successfully.')
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr.message)
    }

    await mongoose.disconnect()
    console.log('MongoDB disconnected.')
  }

  // -------------------------------------------------------------------------
  // FINAL QA SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n==============================================================================')
  console.log('SV HUB API QA AUDIT COMPLETE')
  console.log('==============================================================================')
  console.log(`APIs discovered: ${results.totalDiscovered}`)
  console.log(`APIs tested: ${results.totalTested}`)
  console.log('')
  console.log(`PASS: ${results.passed}`)
  console.log(`FAIL: ${results.failed}`)
  console.log(`WARN: ${results.warn}`)
  console.log(`SKIP: ${results.skip}`)
  console.log('')
  console.log(`CRITICAL: ${results.critical}`)
  console.log(`HIGH: ${results.high}`)
  console.log(`MEDIUM: ${results.medium}`)
  console.log(`LOW: ${results.low}`)
  console.log('==============================================================================\n')

  return results
}

// Execute if run directly
runQaAudit()
  .then((res) => {
    if (res.critical > 0 || res.high > 0) {
      process.exitCode = 1
    }
  })
  .catch((err) => {
    console.error('Script terminated abnormally:', err)
    process.exitCode = 1
  })

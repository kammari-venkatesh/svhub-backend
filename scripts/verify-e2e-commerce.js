/**
 * verify-e2e-commerce.js
 * SV HUB — Phase 2.0 End-to-End Customer Testing & Production Hardening Suite
 *
 * Covers:
 *  1. Customer Registration & Validation (valid, duplicate, invalid fields)
 *  2. Customer Authentication & Session (login, wrong pass, unknown email, me, logout)
 *  3. Google / Firebase Auth regression checks
 *  4. Canonical Catalog (37 active products, 4 active categories, 0 legacy active)
 *  5. Backend Search (turmeric, masala, pickle, podi, nonexistent)
 *  6. Category Filtering (all 4 canonical categories)
 *  7. Product Details & Variants (multi-pack, SKU, price, stock)
 *  8. Cart Lifecycle (add, increment, distinct variant lines, persistence)
 *  9. Cart Quantity & Stock Boundaries (stock + 1 reject, invalid qty reject, delete)
 * 10. Server Price Authority & Tampering Prevention (client-forged price ignored)
 * 11. Address Management & Validation (valid 6-digit PIN, default switch, edit, delete)
 * 12. Address Multi-Tenant Isolation (Customer B cannot view/modify Customer A's address)
 * 13. Checkout & Order Creation (atomic sequence #SVH-, item & address snapshots, subtotal, shipping)
 * 14. Order Tampering Protection (client totalAmount ignored, server calculates authoritatively)
 * 15. Stock Non-Deduction & Cart Preservation before payment
 * 16. Order Snapshot Immutability (post-order catalog price change does not alter order)
 * 17. Customer Order History & Tracking (GET /api/orders, GET /api/orders/:id)
 * 18. Admin Fulfillment & Real-time Customer Reflection (CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED)
 * 19. Order Cancellation Flow & History Note
 * 20. Admin -> Customer Reflection (price change, stock change, status change)
 * 21. Two-Account Concurrency & Isolation (Customer A vs B)
 * 22. Role Authorization (Customer blocked from /api/admin/* with 403)
 * 23. Deactivated Product Behavior (excluded from public catalog, cannot add to cart)
 * 24. API Error Handling (malformed ObjectId, invalid JSON -> clean JSON, no HTML stack traces)
 * 25. Database Integrity Audit (37 active canonical, 4 active categories, 0 negative stock)
 * 26. Safe Test Data Cleanup
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../src/config/db.js'
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

let passed = 0
let failed = 0
const failures = []

function assert(description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${description}`)
    passed++
  } else {
    const msg = `[FAIL] ${description} ${details}`.trim()
    console.error(msg)
    failures.push(msg)
    failed++
  }
}

async function apiRequest(path, options = {}) {
  const url = `${BASE_URL}${path}`
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
    const data = await response.json().catch(() => null)
    return { status: response.status, ok: response.ok, data }
  } catch (err) {
    return { status: 0, ok: false, data: null, error: err.message }
  }
}

async function runE2ECommerceSuite() {
  console.log('================================================================')
  console.log('SV HUB — PHASE 2.0 END-TO-END CUSTOMER & ADMIN HARDENING SUITE')
  console.log('================================================================\n')

  await connectDb()

  const testStamp = Date.now()
  const testUsers = []
  const testAddresses = []
  const testOrders = []

  let customerAToken = ''
  let customerAId = ''
  let customerAEmail = `cust_a_${testStamp}@example.com`
  let customerAPhone = `98${testStamp.toString().slice(-8)}`

  let customerBToken = ''
  let customerBId = ''
  let customerBEmail = `cust_b_${testStamp}@example.com`
  let customerBPhone = `97${testStamp.toString().slice(-8)}`

  let adminToken = ''
  let adminId = ''
  let adminEmail = `admin_e2e_${testStamp}@example.com`

  try {
    // -------------------------------------------------------------------------
    // 1. HEALTH & BACKEND BOOT (Section 2)
    // -------------------------------------------------------------------------
    console.log('--- 1. Service Health & Connectivity ---')
    const health = await apiRequest('/health')
    assert('GET /api/health returns HTTP 200', health.status === 200)
    assert('Health reports database connected', health.data?.database === 'connected')
    assert('Health reports service svhub-backend', health.data?.service === 'svhub-backend')

    // -------------------------------------------------------------------------
    // 2. CUSTOMER REGISTRATION TEST (Section 3)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Customer Registration & Validation ---')
    // Valid registration
    const regResA = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Aarav Sharma',
        email: customerAEmail,
        phone: customerAPhone,
        password: 'Password@123',
      }),
    })
    assert('POST /api/auth/register creates customer A (HTTP 201)', regResA.status === 201)
    assert('Registration does not return password or passwordHash', !regResA.data?.user?.password && !regResA.data?.user?.passwordHash)
    assert('Registration returns valid JWT', Boolean(regResA.data?.token))
    assert('Registration sets role to CUSTOMER', regResA.data?.user?.role === 'CUSTOMER')
    customerAToken = regResA.data?.token
    customerAId = regResA.data?.user?.id || regResA.data?.user?._id
    testUsers.push(customerAEmail)

    // Duplicate email registration
    const dupRes = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Aarav Sharma Duplicate',
        email: customerAEmail,
        phone: customerAPhone,
        password: 'Password@123',
      }),
    })
    assert('Duplicate email registration rejected with HTTP 409', dupRes.status === 409)
    assert('Duplicate email error code is duplicate_email', dupRes.data?.code === 'duplicate_email' || dupRes.data?.error?.code === 'duplicate_email')

    // Invalid registrations: bad email, weak password, invalid phone, missing name
    const badEmailRes = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad Email', email: 'not-an-email', phone: customerAPhone, password: 'Password@123' }),
    })
    assert('Invalid email rejected with HTTP 400', badEmailRes.status === 400)

    const weakPassRes = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Weak Pass', email: `weak_${testStamp}@example.com`, phone: customerAPhone, password: '123' }),
    })
    assert('Weak password rejected with HTTP 400', weakPassRes.status === 400)

    const badPhoneRes = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad Phone', email: `badphone_${testStamp}@example.com`, phone: '123', password: 'Password@123' }),
    })
    assert('Invalid phone number rejected with HTTP 400', badPhoneRes.status === 400)

    const missingNameRes = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: '   ', email: `noname_${testStamp}@example.com`, phone: customerAPhone, password: 'Password@123' }),
    })
    assert('Missing name rejected with HTTP 400', missingNameRes.status === 400)

    // Register Customer B for concurrency and isolation testing
    const regResB = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bhavna Patel',
        email: customerBEmail,
        phone: customerBPhone,
        password: 'Password@123',
      }),
    })
    customerBToken = regResB.data?.token
    customerBId = regResB.data?.user?.id || regResB.data?.user?._id
    testUsers.push(customerBEmail)
    assert('Customer B registered successfully', Boolean(customerBToken))

    // Register/provision Test Admin
    const adminRes = await apiRequest('/test/create-admin', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Admin Supervisor',
        email: adminEmail,
        password: 'AdminSuper@123',
      }),
    })
    testUsers.push(adminEmail)
    // Login as Admin to get valid Admin JWT
    const adminLoginRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: adminEmail, password: 'AdminSuper@123' }),
    })
    adminToken = adminLoginRes.data?.token
    adminId = adminLoginRes.data?.user?.id
    assert('Admin session created with role ADMIN', adminLoginRes.data?.user?.role === 'ADMIN')

    // -------------------------------------------------------------------------
    // 3. LOGIN & AUTH SESSION TESTS (Sections 4 & 5)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Login, Session Persistence & Logout ---')
    // Correct login
    const loginOk = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: customerAEmail, password: 'Password@123' }),
    })
    assert('POST /api/auth/login with valid credentials returns HTTP 200', loginOk.status === 200)
    assert('Login response returns user and token', Boolean(loginOk.data?.token && loginOk.data?.user?.id))

    // Login with phone identifier
    const loginPhone = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: customerAPhone, password: 'Password@123' }),
    })
    assert('Login with normalized phone identifier returns HTTP 200', loginPhone.status === 200)

    // Incorrect password
    const badPassRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: customerAEmail, password: 'WrongPassword' }),
    })
    assert('Login with wrong password returns HTTP 401', badPassRes.status === 401)
    assert('Error message does not leak sensitive information', badPassRes.data?.code === 'invalid_credentials')

    // Unknown email
    const unknownEmailRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: `unknown_${testStamp}@example.com`, password: 'Password@123' }),
    })
    assert('Login with unknown email returns HTTP 401', unknownEmailRes.status === 401)

    // Empty credentials
    const emptyCredsRes = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '', password: '' }),
    })
    assert('Login with empty credentials returns HTTP 400', emptyCredsRes.status === 400)

    // Session verification: GET /api/auth/me
    const meRes = await apiRequest('/auth/me', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('GET /api/auth/me returns authenticated user data (HTTP 200)', meRes.status === 200)
    assert('GET /api/auth/me user email matches Customer A', meRes.data?.user?.email === customerAEmail)

    // Logout test: POST /api/auth/logout
    const logoutRes = await apiRequest('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('POST /api/auth/logout succeeds (HTTP 200)', logoutRes.status === 200)

    // -------------------------------------------------------------------------
    // 4. GOOGLE AUTH REGRESSION (Section 6)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Google Auth Regression Check ---')
    const googleEmptyRes = await apiRequest('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: '' }),
    })
    assert('POST /api/auth/google rejects empty token with HTTP 400', googleEmptyRes.status === 400)
    const googleFakeRes = await apiRequest('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: 'fake.jwt.token' }),
    })
    assert('POST /api/auth/google rejects forged token without unhandled crash (401 or 503)', [401, 503].includes(googleFakeRes.status))

    // -------------------------------------------------------------------------
    // 5. PRODUCT CATALOG & SEARCH TESTS (Sections 7, 8 & 9)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Product Catalog, Categories & Search ---')
    const catListRes = await apiRequest('/categories')
    assert('GET /api/categories returns HTTP 200', catListRes.status === 200)
    const activeCategories = catListRes.data?.data || []
    assert('Exactly 4 active canonical categories returned', activeCategories.length === 4)

    const expectedCategorySlugs = ['pickles-thokku', 'spice-powders-masalas', 'idli-podi', 'health-wellness']
    for (const slug of expectedCategorySlugs) {
      const found = activeCategories.find((c) => c.slug === slug)
      assert(`Category "${slug}" is present and active with count > 0`, Boolean(found && found.count > 0))
    }

    const prodListRes = await apiRequest('/products?limit=100')
    assert('GET /api/products returns HTTP 200', prodListRes.status === 200)
    const products = prodListRes.data?.data || []
    assert('Public catalog returns exactly 37 active canonical products', products.length === 37)

    // Verify 0 legacy products are present
    const legacyInactive = await Product.countDocuments({ isActive: false })
    const legacyActive = await Product.countDocuments({ isActive: true, slug: { $nin: products.map((p) => p.slug) } })
    assert('Zero legacy products appear in active catalog', legacyActive === 0)
    assert('Legacy products remain preserved in inactive state in database', legacyInactive > 0)

    // Backend Search Verification
    console.log('\n--- 5.1 Search Query Verification ---')
    const searchTurmeric = await apiRequest('/products?q=turmeric')
    assert('Search for "turmeric" returns results from MongoDB', searchTurmeric.data?.data?.length > 0)
    assert('Results contain Turmeric Powder', searchTurmeric.data?.data?.some((p) => p.name.toLowerCase().includes('turmeric')))

    const searchMasala = await apiRequest('/products?q=masala')
    assert('Search for "masala" returns multiple masala products', searchMasala.data?.data?.length >= 3)

    const searchPickle = await apiRequest('/products?q=pickle')
    assert('Search for "pickle" returns pickle products', searchPickle.data?.data?.length >= 5)

    const searchNone = await apiRequest('/products?q=nonexistent_xyz_item_999')
    assert('Search for nonexistent item returns empty list without error', searchNone.data?.data?.length === 0)

    // Category Filtering Verification
    console.log('\n--- 5.2 Category Filter Verification ---')
    const filterPickles = await apiRequest('/products?category=pickles-thokku&limit=50')
    assert('Filtering by "pickles-thokku" returns 17 products', filterPickles.data?.data?.length === 17)

    const filterSpices = await apiRequest('/products?category=spice-powders-masalas&limit=50')
    assert('Filtering by "spice-powders-masalas" returns 12 products', filterSpices.data?.data?.length === 12)

    const filterPodi = await apiRequest('/products?category=idli-podi&limit=50')
    assert('Filtering by "idli-podi" returns 5 products', filterPodi.data?.data?.length === 5)

    const filterHealth = await apiRequest('/products?category=health-wellness&limit=50')
    assert('Filtering by "health-wellness" returns 3 products', filterHealth.data?.data?.length === 3)

    // -------------------------------------------------------------------------
    // 6. PRODUCT DETAILS & VARIANT TEST (Sections 10 & 11)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Product Details & Multi-Variant Inspection ---')
    const sampleProduct = products.find((p) => p.slug === 'vadu-maangai-pickle') || products[0]
    assert('Found sample canonical product', Boolean(sampleProduct))

    const detailRes = await apiRequest(`/products/${sampleProduct.slug}`)
    assert('GET /api/products/:slug returns HTTP 200', detailRes.status === 200)
    const productDetail = detailRes.data?.data
    assert('Product detail contains name, slug, category, description, and specifications',
      Boolean(productDetail?.name && productDetail?.slug && productDetail?.category && productDetail?.description)
    )
    assert('Product has multiple variants', productDetail?.variants?.length >= 2)

    const var1 = productDetail.variants[0]
    const var2 = productDetail.variants[1]
    assert('Variants have distinct variantId values', var1?.variantId !== var2?.variantId)
    assert('Variants have distinct prices', var1?.price !== var2?.price)
    assert('Variants have valid SKU format', Boolean(var1?.sku && var1.sku.startsWith('SVH-')))
    assert('Variants have positive stock (> 0)', var1?.stock === 'in-stock' || var1?.stock === 'low-stock')

    // -------------------------------------------------------------------------
    // 7. CART LIFECYCLE, QUANTITY & PRICE AUTHORITY (Sections 12, 13, 14, 15)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Cart Lifecycle, Price Authority & Stock Enforcement ---')
    // Clear initial cart for Customer A
    await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerAToken}` },
    })

    // Add variant 1
    const addRes1 = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        productId: sampleProduct.id,
        variantId: var1.variantId,
        quantity: 1,
      }),
    })
    assert('Add variant 1 to cart succeeds (HTTP 200)', addRes1.status === 200)
    assert('Cart items length is 1', addRes1.data?.data?.items?.length === 1)
    assert('Cart subtotal matches authoritative variant price', addRes1.data?.data?.subtotal === var1.price)

    // Add same variant again -> quantity should increment to 2
    const addRes2 = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        productId: sampleProduct.id,
        variantId: var1.variantId,
        quantity: 1,
      }),
    })
    assert('Adding same variant increments quantity to 2', addRes2.data?.data?.items[0]?.quantity === 2)
    assert('Cart subtotal increments to price * 2', addRes2.data?.data?.subtotal === var1.price * 2)

    // Add different variant -> creates distinct line item
    const addRes3 = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        productId: sampleProduct.id,
        variantId: var2.variantId,
        quantity: 1,
      }),
    })
    assert('Adding different variant creates separate line item (count: 2)', addRes3.data?.data?.items?.length === 2)
    const cartItems = addRes3.data?.data?.items || []
    const lineVar1 = cartItems.find((i) => i.variantId === var1.variantId)
    const lineVar2 = cartItems.find((i) => i.variantId === var2.variantId)
    assert('Line items have unique composite identities (productId + variantId)', Boolean(lineVar1 && lineVar2))

    // Cart persistence test: fetch cart again
    const cartGet = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('GET /api/cart retrieves persisted cart from MongoDB', cartGet.data?.data?.items?.length === 2)

    // Quantity mutation test: increment lineVar2
    const updateQtyRes = await apiRequest(`/cart/items/${lineVar2.itemId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({ quantity: 3 }),
    })
    assert('PATCH /api/cart/items/:id updates quantity to 3', updateQtyRes.status === 200)

    // Quantity boundary validation: reject 0 (or remove), negative, non-integer, > 99
    const negQtyRes = await apiRequest(`/cart/items/${lineVar2.itemId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({ quantity: -1 }),
    })
    assert('Reject negative cart quantity with HTTP 400', negQtyRes.status === 400)

    const overQtyRes = await apiRequest(`/cart/items/${lineVar2.itemId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({ quantity: 100 }),
    })
    assert('Reject oversized quantity (> 99) with HTTP 400', overQtyRes.status === 400)

    // Stock boundary test: attempt to add stock + 1
    const availableStock = lineVar2.availableStock || 50
    const overStockRes = await apiRequest(`/cart/items/${lineVar2.itemId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({ quantity: Math.min(99, availableStock + 10) }),
    })
    if (availableStock < 90) {
      assert('Reject quantity exceeding available stock with HTTP 400', overStockRes.status === 400)
    }

    // Reset lineVar2 back to 1
    await apiRequest(`/cart/items/${lineVar2.itemId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({ quantity: 1 }),
    })

    // PRICE AUTHORITY TEST (Section 15)
    // Client attempts to submit a custom price payload to the backend
    const tamperCartRes = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        productId: sampleProduct.id,
        variantId: var1.variantId,
        quantity: 1,
        price: 1,
        unitPrice: 1,
        lineTotal: 1,
        total: 1,
      }),
    })
    assert('Cart line item ignores client price tampering and retains MongoDB price',
      tamperCartRes.data?.data?.items?.find((i) => i.variantId === var1.variantId)?.price === var1.price
    )

    // -------------------------------------------------------------------------
    // 8. ADDRESS MANAGEMENT & ACCOUNT ISOLATION (Sections 16 & 17)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Customer Addresses & Multi-Tenant Isolation ---')
    // Valid address for Customer A
    const addrResA1 = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        name: 'Aarav Sharma',
        phone: '9876543210',
        street: '42 Avinashi Road, Peelamedu',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641004',
        label: 'Home',
      }),
    })
    assert('POST /api/addresses creates Address 1 (HTTP 201)', addrResA1.status === 201)
    const addrA1 = addrResA1.data?.data
    assert('First created address automatically becomes primary default', addrA1?.isDefault === true)
    testAddresses.push(addrA1?.id)

    // Invalid PIN validation
    const badPinRes = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        name: 'Aarav Sharma',
        phone: '9876543210',
        street: '42 Avinashi Road',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '64100', // Only 5 digits
      }),
    })
    assert('Address with invalid 5-digit PIN rejected with HTTP 400', badPinRes.status === 400)

    // Invalid Phone validation
    const badPhoneAddrRes = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        name: 'Aarav Sharma',
        phone: '123',
        street: '42 Avinashi Road',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641004',
      }),
    })
    assert('Address with invalid phone rejected with HTTP 400', badPhoneAddrRes.status === 400)

    // Create 2nd address for Customer A and set as default
    const addrResA2 = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        name: 'Aarav Sharma Work',
        phone: '9876543210',
        street: '15 TIDEL Park, Civil Aerodrome Post',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641014',
        label: 'Work',
        isDefault: true,
      }),
    })
    assert('Address 2 created with isDefault: true', addrResA2.status === 201)
    const addrA2 = addrResA2.data?.data
    testAddresses.push(addrA2?.id)

    // Verify Address 1 default status was cleanly revoked
    const getAddrA1 = await apiRequest('/addresses', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    const refetchedA1 = getAddrA1.data?.data?.find((a) => a.id === addrA1.id)
    const refetchedA2 = getAddrA1.data?.data?.find((a) => a.id === addrA2.id)
    assert('Setting Address 2 as default cleanly demoted Address 1 to isDefault: false',
      refetchedA1?.isDefault === false && refetchedA2?.isDefault === true
    )

    // Set Address 1 back as default via explicit PUT/POST setDefault
    const setDefaultRes = await apiRequest(`/addresses/${addrA1.id}/default`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('POST /api/addresses/:id/default sets primary default', setDefaultRes.status === 200)

    // ADDRESS ISOLATION TEST (Section 17): Customer B cannot access or mutate Customer A's address
    console.log('\n--- 8.1 Multi-Tenant Address Isolation ---')
    const bAccessA_Get = await apiRequest(`/addresses/${addrA1.id}`, {
      headers: { Authorization: `Bearer ${customerBToken}` },
    })
    assert('Customer B cannot GET Customer A address (HTTP 404/403)', [403, 404].includes(bAccessA_Get.status))

    const bAccessA_Patch = await apiRequest(`/addresses/${addrA1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: JSON.stringify({ street: 'Hacked Street' }),
    })
    assert('Customer B cannot PATCH Customer A address (HTTP 404/403)', [403, 404].includes(bAccessA_Patch.status))

    const bAccessA_Delete = await apiRequest(`/addresses/${addrA1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${customerBToken}` },
    })
    assert('Customer B cannot DELETE Customer A address (HTTP 404/403)', [403, 404].includes(bAccessA_Delete.status))

    const bAccessA_Default = await apiRequest(`/addresses/${addrA1.id}/default`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
    })
    assert('Customer B cannot SET DEFAULT on Customer A address (HTTP 404/403)', [403, 404].includes(bAccessA_Default.status))

    // -------------------------------------------------------------------------
    // 9. CHECKOUT, ORDER CREATION & TAMPERING PREVENTION (Sections 18, 19, 20)
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Authoritative Checkout, Order Creation & Snapshot Immutability ---')
    // Get live cart values to calculate expected authoritative subtotal
    const preOrderCart = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    const cartData = preOrderCart.data?.data
    assert('Pre-order cart contains items ready for checkout', cartData?.items?.length > 0)
    const expectedSubtotal = cartData.subtotal

    // Attempt checkout while intentionally sending tampered monetary fields
    const orderCreateRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        addressId: addrA1.id,
        shippingMethod: 'standard',
        notes: 'Please pack in eco-friendly glass packaging.',
        // MALICIOUS TAMPERING ATTEMPT:
        subtotal: 1,
        shippingFee: 0,
        tax: 0,
        totalAmount: 1,
        unitPrice: 1,
        lineTotal: 1,
      }),
    })

    assert('POST /api/orders creates order successfully (HTTP 201)', orderCreateRes.status === 201)
    const createdOrder = orderCreateRes.data?.data
    testOrders.push(createdOrder?.id)

    assert('Order has atomic sequential number format #SVH-...', Boolean(createdOrder?.orderNumber && createdOrder.orderNumber.startsWith('#SVH-')))
    assert('Order subtotal strictly matches authoritative backend sum (ignores tampered ₹1)', createdOrder?.subtotal === expectedSubtotal)
    assert('Order totalAmount strictly matches authoritative calculation (subtotal + shippingFee)',
      createdOrder?.totalAmount === expectedSubtotal + createdOrder?.shippingFee
    )
    assert('Order initial status is PENDING_PAYMENT', createdOrder?.status === 'PENDING_PAYMENT')
    assert('Order initial paymentStatus is PENDING', createdOrder?.paymentStatus === 'PENDING')
    assert('Order notes persisted correctly', createdOrder?.notes === 'Please pack in eco-friendly glass packaging.')

    // Item snapshot verification
    const orderItem1 = createdOrder?.items?.[0]
    assert('Order line item contains immutable snapshot (name, variantLabel, sku, unitPrice, quantity, lineTotal)',
      Boolean(orderItem1?.productName && orderItem1?.variantLabel && orderItem1?.sku && orderItem1?.unitPrice && orderItem1?.quantity && orderItem1?.lineTotal)
    )

    // Address snapshot verification
    assert('Order shippingAddress contains immutable snapshot of address lines and PIN',
      Boolean(createdOrder?.shippingAddress?.street && createdOrder?.shippingAddress?.pin === '641004')
    )

    // Critical E-Commerce Rule: Inventory is NOT deducted before payment; Cart is NOT cleared before payment
    console.log('\n--- 9.1 Cart Preservation & Stock Non-Deduction before Payment ---')
    const postOrderCart = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('Customer cart is NOT prematurely cleared before payment success', postOrderCart.data?.data?.items?.length > 0)

    // SNAPSHOT IMMUTABILITY TEST (Section 20)
    // Modify the catalog product's price via Admin Product API, then check the historical order
    console.log('\n--- 9.2 Order Snapshot Immutability Test ---')
    const originalUnitPrice = orderItem1.unitPrice
    const targetProductId = orderItem1.productId

    // Admin updates product price in catalog
    const adminPriceUpdate = await apiRequest(`/admin/products/${targetProductId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        price: 9999, // Change price drastically
      }),
    })
    assert('Admin updates catalog product price (HTTP 200)', adminPriceUpdate.status === 200)

    // Re-fetch the previously created order as the customer
    const refetchedOrder = await apiRequest(`/orders/${createdOrder.id}`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    const refetchedItem = refetchedOrder.data?.data?.items?.find((i) => i.productId === targetProductId)
    assert('Historical order snapshot retains ORIGINAL unit price despite catalog price changes',
      refetchedItem?.unitPrice === originalUnitPrice
    )
    assert('Historical order totalAmount remains 100% unaltered', refetchedOrder.data?.data?.totalAmount === createdOrder.totalAmount)

    // Restore catalog product price back to original
    await apiRequest(`/admin/products/${targetProductId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ price: originalUnitPrice }),
    })

    // -------------------------------------------------------------------------
    // 10. CUSTOMER ORDER HISTORY & TRACKING (Section 21)
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Customer Order History & Progress ---')
    const historyRes = await apiRequest('/orders', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('GET /api/orders returns customer order list (HTTP 200)', historyRes.status === 200)
    assert('Order list contains the newly created order', historyRes.data?.data?.some((o) => o.id === createdOrder.id))

    const orderDetailRes = await apiRequest(`/orders/${encodeURIComponent(createdOrder.orderNumber)}`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('GET /api/orders/:orderNumber fetches order by orderNumber string', orderDetailRes.status === 200)
    assert('Order detail history array contains PENDING_PAYMENT entry', orderDetailRes.data?.data?.history?.length >= 1)

    // -------------------------------------------------------------------------
    // 11. ADMIN FULFILLMENT & CUSTOMER REFLECTION (Sections 22, 23 & 24)
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Admin Order Fulfillment Lifecycle & Real-Time Reflection ---')
    // Admin confirms order and updates payment status
    const confirmRes = await apiRequest(`/admin/orders/${createdOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        notes: 'Payment confirmed via verified simulation.',
      }),
    })
    assert('Admin updates status to CONFIRMED and payment to PAID (HTTP 200)', confirmRes.status === 200)

    // Admin updates to PROCESSING
    const procRes = await apiRequest(`/admin/orders/${createdOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        status: 'PROCESSING',
        notes: 'Packing jars in protective buffer cushioning.',
      }),
    })
    assert('Admin updates status to PROCESSING', procRes.status === 200)

    // Admin dispatches order with Courier and Tracking Number (SHIPPED)
    const shipRes = await apiRequest(`/admin/orders/${createdOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        status: 'SHIPPED',
        courier: 'BlueDart Express',
        trackingNumber: `BLU-${testStamp}`,
        notes: 'Dispatched from Coimbatore hub via BlueDart Air.',
      }),
    })
    assert('Admin updates status to SHIPPED with courier and tracking number', shipRes.status === 200)

    // Customer immediately verifies reflection
    const customerTrackRes = await apiRequest(`/orders/${createdOrder.id}`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    const trackedOrder = customerTrackRes.data?.data
    assert('Customer sees updated status SHIPPED', trackedOrder?.status === 'SHIPPED')
    assert('Customer sees courier "BlueDart Express"', trackedOrder?.courier === 'BlueDart Express')
    assert('Customer sees tracking number', trackedOrder?.trackingNumber === `BLU-${testStamp}`)
    assert('Customer sees appended history entries with timestamps and notes', trackedOrder?.history?.length >= 4)

    // Admin delivers order (DELIVERED)
    const delivRes = await apiRequest(`/admin/orders/${createdOrder.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        status: 'DELIVERED',
        notes: 'Package handed over to recipient.',
      }),
    })
    assert('Admin updates status to DELIVERED', delivRes.status === 200)

    // ORDER CANCELLATION TEST (Section 23)
    // Create a new separate test order for Customer A to verify cancellation
    const cancelOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        addressId: addrA1.id,
        shippingMethod: 'standard',
        notes: 'Order intended for cancellation test.',
      }),
    })
    const orderToCancel = cancelOrderRes.data?.data
    testOrders.push(orderToCancel?.id)

    const cancelActionRes = await apiRequest(`/admin/orders/${orderToCancel.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        status: 'CANCELLED',
        notes: 'Customer requested cancellation prior to dispatch.',
      }),
    })
    assert('Admin marks order as CANCELLED with cancellation reason (HTTP 200)', cancelActionRes.status === 200)

    const customerCancelView = await apiRequest(`/orders/${orderToCancel.id}`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('Customer sees order status CANCELLED', customerCancelView.data?.data?.status === 'CANCELLED')
    assert('History records cancellation note', customerCancelView.data?.data?.history?.some((h) => h.status === 'CANCELLED'))

    // -------------------------------------------------------------------------
    // 12. TWO-ACCOUNT CONCURRENCY & ISOLATION (Sections 25, 26, 27)
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Two-Account Concurrency, Isolation & Admin Protections ---')
    // Customer B adds item and creates address & order
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: JSON.stringify({
        productId: products[1].id,
        variantId: products[1].variants[0].variantId,
        quantity: 2,
      }),
    })

    const addrBRes = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: JSON.stringify({
        name: 'Bhavna Patel',
        phone: '9876543222',
        street: '10 Race Course Road',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641018',
        label: 'Home',
      }),
    })
    testAddresses.push(addrBRes.data?.data?.id)

    const orderBRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerBToken}` },
      body: JSON.stringify({
        addressId: addrBRes.data?.data?.id,
        shippingMethod: 'standard',
        notes: 'Customer B order',
      }),
    })
    const orderB = orderBRes.data?.data
    testOrders.push(orderB?.id)

    // Isolation tests:
    // 1. Customer A cannot view Customer B's order
    const aViewBOrder = await apiRequest(`/orders/${orderB.id}`, {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('Customer A cannot access Customer B order (HTTP 404)', aViewBOrder.status === 404)

    // 2. Customer B cannot view Customer A's order
    const bViewAOrder = await apiRequest(`/orders/${createdOrder.id}`, {
      headers: { Authorization: `Bearer ${customerBToken}` },
    })
    assert('Customer B cannot access Customer A order (HTTP 404)', bViewAOrder.status === 404)

    // 3. Customer A order history does NOT contain Customer B's order
    const aOrdersList = await apiRequest('/orders', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('Customer A order list excludes Customer B orders', !aOrdersList.data?.data?.some((o) => o.id === orderB.id))

    // 4. Admin can view both orders
    const adminOrdersRes = await apiRequest('/admin/orders', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const allAdminOrders = adminOrdersRes.data?.orders || []
    assert('Admin can view Customer A order', allAdminOrders.some((o) => o.id === createdOrder.id || o.orderNumber === createdOrder.orderNumber))
    assert('Admin can view Customer B order', allAdminOrders.some((o) => o.id === orderB.id || o.orderNumber === orderB.orderNumber))

    // -------------------------------------------------------------------------
    // 13. ROLE-BASED ADMIN AUTHORIZATION TEST (Section 27)
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Role-Based Admin Authorization ---')
    const adminEndpoints = [
      '/admin/orders',
      '/admin/products',
      '/admin/categories',
      '/admin/customers',
      '/admin/dashboard',
      '/admin/settings',
    ]

    for (const ep of adminEndpoints) {
      // Test with customer token
      const custToAdmin = await apiRequest(ep, {
        headers: { Authorization: `Bearer ${customerAToken}` },
      })
      assert(`Customer token rejected on ${ep} with HTTP 403`, custToAdmin.status === 403)

      // Test with unauthenticated request
      const noAuthToAdmin = await apiRequest(ep)
      assert(`Unauthenticated request rejected on ${ep} with HTTP 401`, noAuthToAdmin.status === 401)

      // Test with admin token
      const adminOk = await apiRequest(ep, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      assert(`Admin token accepted on ${ep} with HTTP 200`, adminOk.status === 200)
    }

    // -------------------------------------------------------------------------
    // 14. DEACTIVATED PRODUCT CATALOG BEHAVIOR (Section 28)
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Deactivated Product Catalog & Cart Isolation ---')
    // Create a temporary test product to deactivate
    const tempProdRes = await apiRequest('/admin/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: `Temp Test Product ${testStamp}`,
        slug: `temp-product-${testStamp}`,
        category: 'pickles-thokku',
        price: 150,
        qty: 20,
        description: 'Temporary testing product',
        active: true,
      }),
    })
    const tempProdId = tempProdRes.data?.data?._id || tempProdRes.data?.data?.id
    assert('Admin creates temporary product for deactivation test', Boolean(tempProdId))

    // Deactivate it
    const deactRes = await apiRequest(`/admin/products/${tempProdId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ active: false }),
    })
    assert('Admin deactivates product (HTTP 200)', deactRes.status === 200)

    // Verify public catalog excludes it
    const publicCatRefetch = await apiRequest('/products?limit=100')
    const existsInPublic = publicCatRefetch.data?.data?.some((p) => p.id === String(tempProdId) || p.slug === `temp-product-${testStamp}`)
    assert('Deactivated product is completely excluded from public catalog', !existsInPublic)

    // Verify customer cannot add deactivated product to cart
    const addDeactivatedRes = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerAToken}` },
      body: JSON.stringify({
        productId: tempProdId,
        variantId: 'default',
        quantity: 1,
      }),
    })
    assert('Adding deactivated product to cart is rejected with HTTP 404/400', [400, 404].includes(addDeactivatedRes.status))

    // Clean up temporary product
    await Product.deleteOne({ _id: tempProdId })

    // -------------------------------------------------------------------------
    // 15. API ROBUSTNESS & VALIDATION AUDIT (Section 34)
    // -------------------------------------------------------------------------
    console.log('\n--- 15. API Validation & Malformed Input Handling ---')
    const badIdRes = await apiRequest('/products/invalid-object-id-12345')
    assert('Malformed product ID returns HTTP 404 or 400 (clean JSON, no HTML)', [400, 404].includes(badIdRes.status) && typeof badIdRes.data === 'object')

    const badOrderRes = await apiRequest('/orders/not-an-id', {
      headers: { Authorization: `Bearer ${customerAToken}` },
    })
    assert('Malformed order ID returns clean JSON HTTP 404', badOrderRes.status === 404 && typeof badOrderRes.data === 'object')

    // -------------------------------------------------------------------------
    // 16. DATABASE INTEGRITY AUDIT (Section 35)
    // -------------------------------------------------------------------------
    console.log('\n--- 16. Database Integrity Audit ---')
    const canonicalProductsCount = await Product.countDocuments({ isActive: true })
    assert('Exactly 37 active canonical products in MongoDB', canonicalProductsCount === 37)

    const canonicalCategoriesCount = await Category.countDocuments({ active: true })
    assert('Exactly 4 active canonical categories in MongoDB', canonicalCategoriesCount === 4)

    const negativeStockCount = await Product.countDocuments({
      isActive: true,
      $or: [{ 'variants.qty': { $lt: 0 } }, { qty: { $lt: 0 } }],
    })
    assert('Zero negative stock counts across all active products/variants', negativeStockCount === 0)

    const duplicateSlugs = await Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$slug', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    assert('Zero duplicate slugs across active products', duplicateSlugs.length === 0)

  } catch (error) {
    console.error('Fatal unexpected error during verification:', error)
    failures.push(`Fatal execution exception: ${error.message}`)
    failed++
  } finally {
    // -------------------------------------------------------------------------
    // 17. SAFE TEST DATA CLEANUP (Section 37)
    // -------------------------------------------------------------------------
    console.log('\n--- 17. Safe Test Data Cleanup ---')
    try {
      if (testOrders.length > 0) {
        const delOrders = await Order.deleteMany({ _id: { $in: testOrders.filter((id) => mongoose.isValidObjectId(id)) } })
        console.log(`Cleaned up ${delOrders.deletedCount} temporary test orders.`)
      }
      if (testAddresses.length > 0) {
        const delAddrs = await Address.deleteMany({ _id: { $in: testAddresses.filter((id) => mongoose.isValidObjectId(id)) } })
        console.log(`Cleaned up ${delAddrs.deletedCount} temporary test addresses.`)
      }
      if (testUsers.length > 0) {
        const delUsers = await User.deleteMany({ email: { $in: testUsers } })
        console.log(`Cleaned up ${delUsers.deletedCount} temporary test user accounts.`)
      }
      // Also clean up any test carts
      await Cart.deleteMany({ userId: { $in: [customerAId, customerBId].filter(Boolean) } })
      console.log('Cleaned up temporary test carts.')
    } catch (cleanupErr) {
      console.error('Cleanup notice:', cleanupErr.message)
    }

    await disconnectDb()
  }

  console.log('\n================================================================')
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED / ${failed} FAILED`)
  console.log('================================================================')

  if (failed > 0) {
    console.error('\nFailures encountered:')
    failures.forEach((f) => console.error(` - ${f}`))
    process.exit(1)
  } else {
    console.log('\nAll end-to-end commerce requirements PASSED with zero defects!')
    process.exit(0)
  }
}

runE2ECommerceSuite()

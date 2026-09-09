import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { Product, Category, Settings } from '../src/models/index.js'

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

async function runCatalogVerification() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.3 PUBLIC CATALOG APIs VERIFICATION')
  console.log('====================================================\n')

  await connectDb()

  const testSuffix = `cat_test_${Date.now()}`
  let testActiveCatId
  let testActiveProductId
  let testActiveProductSlug

  try {
    // Setup test categories and products
    console.log('--- Setting up isolated test catalog fixtures ---')

    const activeCat1 = await Category.create({
      name: `Active Category A ${testSuffix}`,
      slug: `cat-a-${testSuffix}`,
      storefront: 'nutri-hub',
      description: 'Test category blurb',
      active: true,
      sortOrder: 1,
    })
    testActiveCatId = activeCat1._id

    const activeCat2 = await Category.create({
      name: `Active Category B ${testSuffix}`,
      slug: `cat-b-${testSuffix}`,
      storefront: 'self-care',
      description: 'Test category blurb B',
      active: true,
      sortOrder: 2,
    })

    const inactiveCat = await Category.create({
      name: `Inactive Category ${testSuffix}`,
      slug: `cat-inactive-${testSuffix}`,
      storefront: 'nutri-hub',
      active: false,
      sortOrder: 3,
    })

    // Active Product 1 (featured)
    const activeProd1 = await Product.create({
      name: `Karuppu Kavuni Rice ${testSuffix}`,
      slug: `kavuni-rice-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: activeCat1.slug,
      description: 'Heritage organic black rice from Tamil Nadu.',
      image: 'https://images.unsplash.com/photo-1586201375761',
      price: 289,
      originalPrice: 329,
      discount: 12,
      weight: '500 g',
      sku: `SKU-KKV-${testSuffix}`,
      qty: 50,
      isActive: true,
      isFeatured: true,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          sku: `SKU-KKV-500-${testSuffix}`,
          price: 289,
          originalPrice: 329,
          discount: 12,
          qty: 30,
          isActive: true,
        },
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1 kg',
          sku: `SKU-KKV-1KG-${testSuffix}`,
          price: 520,
          qty: 20,
          isActive: true,
        },
        {
          variantId: '5kg-secret',
          label: '5 kg Bulk',
          weight: '5 kg',
          sku: `SKU-KKV-5KG-${testSuffix}`,
          price: 2400,
          qty: 5,
          isActive: false, // Inactive variant!
        },
      ],
    })
    testActiveProductId = activeProd1._id
    testActiveProductSlug = activeProd1.slug

    // Active Product 2 (not featured, self-care)
    const activeProd2 = await Product.create({
      name: `Vettiver Soap ${testSuffix}`,
      slug: `vettiver-soap-${testSuffix}`,
      type: 'Handmade Soap',
      storefront: 'self-care',
      category: activeCat2.slug,
      description: 'Cooling herbal bath soap made with fresh vettiver roots.',
      image: 'https://images.unsplash.com/photo-soap',
      price: 159,
      weight: '100 g',
      sku: `SKU-VET-${testSuffix}`,
      qty: 25,
      isActive: true,
      isFeatured: false,
      variants: [
        {
          variantId: '100g',
          label: '100 g',
          weight: '100 g',
          sku: `SKU-VET-100-${testSuffix}`,
          price: 159,
          qty: 25,
          isActive: true,
        },
      ],
    })

    // Inactive Product
    const inactiveProd = await Product.create({
      name: `Discontinued Product ${testSuffix}`,
      slug: `discontinued-${testSuffix}`,
      type: 'Archive',
      storefront: 'nutri-hub',
      category: activeCat1.slug,
      description: 'No longer sold.',
      image: 'https://images.unsplash.com/photo-archive',
      price: 99,
      weight: '100 g',
      sku: `SKU-DIS-${testSuffix}`,
      qty: 0,
      isActive: false,
      variants: [
        {
          variantId: '100g',
          label: '100 g',
          weight: '100 g',
          sku: `SKU-DIS-100-${testSuffix}`,
          price: 99,
          qty: 0,
          isActive: true,
        },
      ],
    })

    // Additional active products for pagination test
    const pageProd1 = await Product.create({
      name: `Extra Rice 1 ${testSuffix}`,
      slug: `extra-1-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: activeCat1.slug,
      description: 'Extra test rice 1',
      image: 'https://images.unsplash.com/extra1',
      price: 200,
      weight: '500 g',
      sku: `SKU-EXT-1-${testSuffix}`,
      qty: 10,
      isActive: true,
      variants: [{ variantId: '500g', label: '500 g', weight: '500 g', sku: `SKU-E1-${testSuffix}`, price: 200, qty: 10, isActive: true }],
    })

    const pageProd2 = await Product.create({
      name: `Extra Rice 2 ${testSuffix}`,
      slug: `extra-2-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: activeCat1.slug,
      description: 'Extra test rice 2',
      image: 'https://images.unsplash.com/extra2',
      price: 210,
      weight: '500 g',
      sku: `SKU-EXT-2-${testSuffix}`,
      qty: 10,
      isActive: true,
      variants: [{ variantId: '500g', label: '500 g', weight: '500 g', sku: `SKU-E2-${testSuffix}`, price: 210, qty: 10, isActive: true }],
    })

    console.log('Fixtures initialized.\n')

    // ----------------------------------------------------
    // PRODUCTS API TESTS
    // ----------------------------------------------------
    console.log('--- 1. Testing Products API ---')

    // 1. GET /api/products → 200
    const listRes = await apiRequest('/products')
    assert('Test 1: GET /api/products -> 200', listRes.status === 200 && listRes.data?.success === true)

    // 2. Pagination works
    const pageRes = await apiRequest(`/products?category=${activeCat1.slug}&limit=2&page=1`)
    assert(
      'Test 2: Pagination returns expected slice and metadata',
      pageRes.status === 200 &&
        pageRes.data?.data?.length === 2 &&
        pageRes.data?.pagination?.page === 1 &&
        pageRes.data?.pagination?.limit === 2 &&
        pageRes.data?.pagination?.total >= 3,
    )

    // 3. Inactive products are not returned
    const inactiveSearchRes = await apiRequest(`/products?search=Discontinued%20Product%20${testSuffix}`)
    assert(
      'Test 3: Inactive products are not exposed by catalog query',
      inactiveSearchRes.status === 200 && inactiveSearchRes.data?.data?.length === 0,
    )

    // 4. Search works
    const searchRes = await apiRequest(`/products?search=Kavuni`)
    const foundKavuni = searchRes.data?.data?.some((p) => p.slug === testActiveProductSlug)
    assert('Test 4: Search filter matches products by keyword', searchRes.status === 200 && foundKavuni)

    // 5. Category filter works
    const catFilterRes = await apiRequest(`/products?category=${activeCat1.slug}`)
    const allMatchCat = catFilterRes.data?.data?.every((p) => p.category === activeCat1.slug)
    assert(
      'Test 5: Category filter isolates products by category slug',
      catFilterRes.status === 200 && catFilterRes.data?.data?.length >= 3 && allMatchCat,
    )

    // 6. Storefront filter works
    const storeRes = await apiRequest(`/products?storefront=self-care`)
    const allSelfCare = storeRes.data?.data?.every((p) => p.storefront === 'self-care')
    assert(
      'Test 6: Storefront filter isolates products by house',
      storeRes.status === 200 && allSelfCare && storeRes.data?.data?.some((p) => p.slug === activeProd2.slug),
    )

    // 7. Featured filter works
    const featRes = await apiRequest('/products?featured=true')
    const allFeatured = featRes.data?.data?.every((p) => p.isFeatured === true)
    assert('Test 7: Featured filter isolates products where isFeatured === true', featRes.status === 200 && allFeatured)

    // 8. Invalid pagination handled safely
    const badPageRes = await apiRequest('/products?page=-5&limit=99999')
    assert(
      'Test 8: Invalid page & limit are normalized to safe bounds (page=1, limit<=100)',
      badPageRes.status === 200 &&
        badPageRes.data?.pagination?.page === 1 &&
        badPageRes.data?.pagination?.limit === 100,
    )

    // 9. GET /api/products/:id returns a valid product (by ObjectId and by slug)
    const getByIdRes = await apiRequest(`/products/${testActiveProductId}`)
    const getBySlugRes = await apiRequest(`/products/${testActiveProductSlug}`)
    assert(
      'Test 9: GET /api/products/:id resolves by ObjectId and slug',
      getByIdRes.status === 200 &&
        getBySlugRes.status === 200 &&
        getByIdRes.data?.data?.slug === testActiveProductSlug &&
        getBySlugRes.data?.data?.id === String(testActiveProductId),
    )

    // 10. Invalid product ID is handled correctly
    const malformedIdRes = await apiRequest('/products/not-a-valid-object-id-and-not-slug!')
    assert(
      'Test 10: Malformed product identifier returns 404 product_not_found',
      malformedIdRes.status === 404 && malformedIdRes.data?.error?.code === 'product_not_found',
    )

    // 11. Non-existent product returns correct not-found response
    const notFoundRes = await apiRequest('/products/507f1f77bcf86cd799439011')
    assert(
      'Test 11: Non-existent ObjectId returns 404 product_not_found',
      notFoundRes.status === 404 && notFoundRes.data?.error?.code === 'product_not_found',
    )

    // 12. Inactive variants are not exposed as active shopping options
    const activeProdDetail = getByIdRes.data?.data
    const secretVariantExposed = activeProdDetail?.variants?.some((v) => v.variantId === '5kg-secret')
    assert(
      'Test 12: Inactive variants (isActive: false) are filtered out from public response',
      secretVariantExposed === false && activeProdDetail?.variants?.length === 2,
    )

    // ----------------------------------------------------
    // CATEGORIES API TESTS
    // ----------------------------------------------------
    console.log('\n--- 2. Testing Categories API ---')

    // 13. GET /api/categories → 200
    const catListRes = await apiRequest('/categories')
    assert('Test 13: GET /api/categories -> 200', catListRes.status === 200 && Array.isArray(catListRes.data?.data))

    // 14. Inactive categories are not returned
    const inactiveCatExposed = catListRes.data?.data?.some((c) => c.slug === inactiveCat.slug)
    assert('Test 14: Inactive category is omitted from public response', inactiveCatExposed === false)

    // 15. Sorting/display order works
    const testCats = catListRes.data?.data?.filter((c) => c.slug.includes(testSuffix))
    const sortedProperly =
      testCats.length >= 2 &&
      testCats[0].sortOrder <= testCats[1].sortOrder &&
      testCats[0].slug === activeCat1.slug
    assert('Test 15: Categories are ordered by sortOrder ascending', sortedProperly)

    // 16. Category detail works (by ObjectId and by slug)
    const catDetailById = await apiRequest(`/categories/${testActiveCatId}`)
    const catDetailBySlug = await apiRequest(`/categories/${activeCat1.slug}`)
    assert(
      'Test 16: Category detail resolves by ID and slug',
      catDetailById.status === 200 &&
        catDetailBySlug.status === 200 &&
        catDetailById.data?.data?.slug === activeCat1.slug &&
        catDetailBySlug.data?.data?.id === String(testActiveCatId),
    )

    // 17. Invalid category ID handled correctly
    const badCatRes = await apiRequest('/categories/non-existent-category-slug-xyz')
    assert(
      'Test 17: Non-existent category returns 404 category_not_found',
      badCatRes.status === 404 && badCatRes.data?.error?.code === 'category_not_found',
    )

    // ----------------------------------------------------
    // SETTINGS API TESTS
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Settings API ---')

    // 18. GET /api/settings/public → 200 when configured
    const settingsRes = await apiRequest('/settings/public')
    assert('Test 18: GET /api/settings/public -> 200', settingsRes.status === 200 && settingsRes.data?.success === true)

    // 19. Only public fields are returned
    const settingsData = settingsRes.data?.data
    const hasRequiredFields =
      settingsData &&
      typeof settingsData.currency === 'string' &&
      typeof settingsData.standardShippingFee === 'number' &&
      typeof settingsData.expressShippingFee === 'number' &&
      typeof settingsData.freeShippingThreshold === 'number' &&
      typeof settingsData.supportEmail === 'string' &&
      typeof settingsData.supportPhone === 'string'
    assert('Test 19: All required public settings fields are present', hasRequiredFields)

    // 20. No secrets/private settings are exposed
    const leakedSecrets =
      settingsData?._id !== undefined ||
      settingsData?.__v !== undefined ||
      settingsData?.key !== undefined ||
      settingsData?.lowStockThreshold !== undefined ||
      settingsData?.password !== undefined ||
      settingsData?.secret !== undefined
    assert('Test 20: No internal fields or secrets are exposed in public settings', leakedSecrets === false)

    // ----------------------------------------------------
    // SECURITY TESTS
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Security Controls ---')

    // 21. Public catalog works without authentication
    const unauthList = await apiRequest('/products', { headers: {} })
    assert('Test 21: Public catalog endpoints do not require Authorization header', unauthList.status === 200)

    // 22. No endpoint accidentally accepts arbitrary MongoDB operators
    const operatorInjectionRes = await apiRequest('/products?category[$gt]=')
    assert(
      'Test 22: MongoDB operator injection in query string safely handled without 500',
      operatorInjectionRes.status === 200,
    )

    // 23. Response does not contain sensitive User fields
    const serializedJson = JSON.stringify(listRes.data)
    const containsSensitiveUserSecrets =
      serializedJson.includes('passwordHash') ||
      serializedJson.includes('resetTokenHash') ||
      serializedJson.includes('firebaseUid')
    assert('Test 23: Catalog API responses do not leak sensitive authentication fields', containsSensitiveUserSecrets === false)

  } finally {
    console.log('\n--- Cleaning up temporary test fixtures ---')
    await Product.deleteMany({ sku: new RegExp(testSuffix) })
    await Category.deleteMany({ slug: new RegExp(testSuffix) })
    console.log('Cleanup completed.')
    await mongoose.disconnect()
  }

  console.log('\n====================================================')
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('====================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runCatalogVerification().catch((err) => {
  console.error('Catalog verification failed with error:', err)
  process.exit(1)
})

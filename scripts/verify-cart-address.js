import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { User, Product, Category, Cart, Address } from '../src/models/index.js'

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

async function runCartAddressVerification() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.4 CUSTOMER CART & ADDRESS VERIFICATION')
  console.log('====================================================\n')

  await connectDb()

  const testSuffix = `ca_test_${Date.now()}`
  let tokenA, userAId
  let tokenB, userBId
  let prodA, prodInactive

  try {
    console.log('--- 1. Setting up test users and catalog fixtures ---')

    // Create Customer A
    const regResA = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Customer Alice',
        email: `alice_${testSuffix}@example.com`,
        password: 'Password@123',
        phone: '9876500001',
      }),
    })
    tokenA = regResA.data?.token
    userAId = regResA.data?.user?.id

    // Create Customer B
    const regResB = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Customer Bob',
        email: `bob_${testSuffix}@example.com`,
        password: 'Password@123',
        phone: '9876500002',
      }),
    })
    tokenB = regResB.data?.token
    userBId = regResB.data?.user?.id

    // Create test category and products
    const testCat = await Category.create({
      name: `Commerce Test Cat ${testSuffix}`,
      slug: `commerce-cat-${testSuffix}`,
      storefront: 'nutri-hub',
    })

    // Active Product A with multiple variants
    prodA = await Product.create({
      name: `Kullakar Rice Commerce ${testSuffix}`,
      slug: `kullakar-commerce-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: testCat.slug,
      description: 'Test rice for commerce cart operations',
      image: 'https://images.unsplash.com/photo-rice',
      price: 249,
      weight: '500 g',
      sku: `SKU-COMM-A-${testSuffix}`,
      qty: 25,
      isActive: true,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          sku: `SKU-COMM-500-${testSuffix}`,
          price: 249,
          qty: 15,
          isActive: true,
        },
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1 kg',
          sku: `SKU-COMM-1KG-${testSuffix}`,
          price: 460,
          qty: 10,
          isActive: true,
        },
        {
          variantId: '5kg-inactive',
          label: '5 kg Inactive',
          weight: '5 kg',
          sku: `SKU-COMM-5KG-${testSuffix}`,
          price: 2200,
          qty: 10,
          isActive: false, // Inactive variant
        },
      ],
    })

    // Inactive Product
    prodInactive = await Product.create({
      name: `Inactive Product Commerce ${testSuffix}`,
      slug: `inactive-commerce-${testSuffix}`,
      type: 'Archive',
      storefront: 'nutri-hub',
      category: testCat.slug,
      description: 'Inactive product',
      image: 'https://images.unsplash.com/photo-inactive',
      price: 199,
      weight: '200 g',
      sku: `SKU-COMM-INACT-${testSuffix}`,
      qty: 5,
      isActive: false,
      variants: [
        {
          variantId: '200g',
          label: '200 g',
          weight: '200 g',
          sku: `SKU-COMM-INACT-200-${testSuffix}`,
          price: 199,
          qty: 5,
          isActive: true,
        },
      ],
    })

    console.log('Fixtures initialized.\n')

    // ----------------------------------------------------
    // CART TESTS (Tests 1 - 25)
    // ----------------------------------------------------
    console.log('--- 2. Running Cart Tests ---')

    // 1. No token → 401
    const cartNoToken = await apiRequest('/cart')
    assert('Test 1: Unauthenticated GET /api/cart returns 401', cartNoToken.status === 401)

    // 2. Invalid token → 401
    const cartInvalidToken = await apiRequest('/cart', {
      headers: { Authorization: 'Bearer invalid.fake.token' },
    })
    assert('Test 2: Invalid token GET /api/cart returns 401', cartInvalidToken.status === 401)

    // 3. Customer A can read own cart (initially empty)
    const cartAEmpty = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 3: Customer A reads own cart (returns empty items array)',
      cartAEmpty.status === 200 &&
        Array.isArray(cartAEmpty.data?.data?.items) &&
        cartAEmpty.data?.data?.count === 0,
    )

    // 4. Customer B cannot read Customer A's cart (sees own empty cart)
    const cartBEmpty = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    assert(
      'Test 4: Customer B reads own cart isolated from Customer A',
      cartBEmpty.status === 200 && cartBEmpty.data?.data?.count === 0,
    )

    // 5. Add valid product/variant
    const addRes1 = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 2,
      }),
    })
    assert(
      'Test 5: Customer A adds valid product/variant to cart (200 success)',
      addRes1.status === 200 &&
        addRes1.data?.data?.count === 2 &&
        addRes1.data?.data?.items[0]?.variantId === '500g',
    )

    // 6. Invalid product → appropriate error
    const addBadProd = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: '507f1f77bcf86cd799439011',
        variantId: '500g',
        quantity: 1,
      }),
    })
    assert('Test 6: Non-existent product ID rejected (404 product_not_found)', addBadProd.status === 404)

    // 7. Invalid variant → appropriate error
    const addBadVar = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: 'non-existent-pack-size',
        quantity: 1,
      }),
    })
    assert('Test 7: Non-existent variantId rejected (404 variant_not_found)', addBadVar.status === 404)

    // 8. Inactive product rejected
    const addInactiveProd = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodInactive._id),
        variantId: '200g',
        quantity: 1,
      }),
    })
    assert('Test 8: Inactive product rejected (404 product_not_found)', addInactiveProd.status === 404)

    // 9. Inactive variant rejected
    const addInactiveVar = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '5kg-inactive',
        quantity: 1,
      }),
    })
    assert('Test 9: Inactive variant rejected (404 variant_not_found)', addInactiveVar.status === 404)

    // 10. Quantity 0 rejected
    const addZeroQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 0,
      }),
    })
    assert('Test 10: Quantity 0 rejected (400 invalid_quantity)', addZeroQty.status === 400)

    // 11. Negative quantity rejected
    const addNegQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: -5,
      }),
    })
    assert('Test 11: Negative quantity rejected (400 invalid_quantity)', addNegQty.status === 400)

    // 12. Quantity >99 rejected
    const addMaxQty = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 100,
      }),
    })
    assert('Test 12: Quantity > 99 rejected (400 invalid_quantity)', addMaxQty.status === 400)

    // 13. Quantity exceeding stock rejected (variant 500g has stock 15; currently 2 in cart)
    const addExceedStock = await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 20,
      }),
    })
    assert('Test 13: Quantity exceeding available stock rejected (400 insufficient_stock)', addExceedStock.status === 400)

    // Clear cart A for clean line tests
    await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })

    // 14. Product A + Variant 1 creates one line
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 1,
      }),
    })
    const cartAfterV1 = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 14: Product A + Variant 1 creates exactly 1 line',
      cartAfterV1.data?.data?.items?.length === 1 &&
        cartAfterV1.data?.data?.items[0]?.variantId === '500g',
    )

    // 15. Product A + Variant 2 creates a separate line
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '1kg',
        quantity: 1,
      }),
    })
    const cartAfterV2 = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 15: Product A + Variant 2 creates a separate line (2 distinct lines for same product)',
      cartAfterV2.data?.data?.items?.length === 2 &&
        cartAfterV2.data?.data?.items.some((i) => i.variantId === '500g') &&
        cartAfterV2.data?.data?.items.some((i) => i.variantId === '1kg'),
    )

    // 16. Adding Variant 1 again increments the existing Variant 1 line rather than creating a duplicate
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 2,
      }),
    })
    const cartAfterV1Again = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const item500g = cartAfterV1Again.data?.data?.items?.find((i) => i.variantId === '500g')
    assert(
      'Test 16: Adding Variant 1 again increments quantity (1+2=3) with no duplicate line',
      cartAfterV1Again.data?.data?.items?.length === 2 && item500g?.quantity === 3,
    )

    // 17. Client-supplied fake price is not persisted as authoritative pricing
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 1,
        price: 1, // Maliciously low client price attempt!
        unitPrice: 1,
        subtotal: 1,
      }),
    })
    const cartCheckPrice = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const verifiedItem = cartCheckPrice.data?.data?.items?.find((i) => i.variantId === '500g')
    assert(
      'Test 17: Price authority enforced: Server resolves DB price (249) and ignores client-sent price (1)',
      verifiedItem?.price === 249 && verifiedItem?.lineTotal === 249 * verifiedItem?.quantity,
    )

    // 18. Valid quantity update works
    const updateRes = await apiRequest(`/cart/items/500g`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ quantity: 5 }),
    })
    const updated500g = updateRes.data?.data?.items?.find((i) => i.variantId === '500g')
    assert(
      'Test 18: Valid quantity update via PATCH /api/cart/items/:id works',
      updateRes.status === 200 && updated500g?.quantity === 5,
    )

    // 19. Invalid quantity rejected
    const updateBadQty = await apiRequest(`/cart/items/500g`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ quantity: -3 }),
    })
    assert('Test 19: Negative quantity update rejected (400 invalid_quantity)', updateBadQty.status === 400)

    // 20. Stock limit enforced on update
    const updateOverStock = await apiRequest(`/cart/items/500g`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ quantity: 50 }), // stock is 15
    })
    assert('Test 20: Quantity update exceeding stock rejected (400 insufficient_stock)', updateOverStock.status === 400)

    // 21. Remove own item works
    const removeRes = await apiRequest(`/cart/items/1kg`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const has1kg = removeRes.data?.data?.items?.some((i) => i.variantId === '1kg')
    assert('Test 21: Customer removes own item from cart', removeRes.status === 200 && has1kg === false)

    // 22. Customer cannot remove another customer's item
    const custBRemoveA = await apiRequest(`/cart/items/500g`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    assert(
      'Test 22: Customer B cannot remove Customer A cart item (404 item_not_found)',
      custBRemoveA.status === 404,
    )

    // 23. Clear own cart works
    const clearRes = await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 23: Customer A clears own cart successfully (items: [], count: 0)',
      clearRes.status === 200 && clearRes.data?.data?.items?.length === 0,
    )

    // 24. Customer cannot clear another customer's cart
    // Put item in A's cart, B calls DELETE /cart, A's cart must remain intact
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ productId: String(prodA._id), variantId: '500g', quantity: 2 }),
    })
    await apiRequest('/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    const cartACheck = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 24: Customer B clearing their cart leaves Customer A cart intact',
      cartACheck.data?.data?.count === 2,
    )

    // 25. Stale/inactive product in cart handled safely
    // Deactivate prodA temporarily to simulate stale reference
    await Product.updateOne({ _id: prodA._id }, { $set: { isActive: false } })
    const cartStaleCheck = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 25: Stale/inactive products in cart are safely handled without crashing (omitted from active cart)',
      cartStaleCheck.status === 200 && cartStaleCheck.data?.data?.items?.length === 0,
    )
    // Restore product active state
    await Product.updateOne({ _id: prodA._id }, { $set: { isActive: true } })

    // ----------------------------------------------------
    // ADDRESS TESTS (Tests 26 - 38)
    // ----------------------------------------------------
    console.log('\n--- 3. Running Address Tests ---')

    // 26. No token → 401
    const addrNoToken = await apiRequest('/addresses')
    assert('Test 26: Unauthenticated GET /api/addresses returns 401', addrNoToken.status === 401)

    // 27. Customer A can read own addresses (initially empty)
    const addrAList = await apiRequest('/addresses', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 27: Customer A reads own address book (200 success)',
      addrAList.status === 200 && Array.isArray(addrAList.data?.data) && addrAList.data?.data?.length === 0,
    )

    // 31. Create valid address (Test 31 first to have an address ID)
    const createAddrRes1 = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Venkatesh',
        phone: '9876543210',
        street: '142, Trichy Road, Singanallur',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641005',
        label: 'Home',
      }),
    })
    const addr1 = createAddrRes1.data?.data
    assert(
      'Test 31: Customer A creates valid address (first address automatically isDefault: true)',
      createAddrRes1.status === 201 && addr1?.isDefault === true && addr1?.pin === '641005',
    )

    // 28. Customer B cannot read Customer A's address
    const addrBList = await apiRequest('/addresses', {
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    const foundAInB = addrBList.data?.data?.some((a) => a.id === addr1.id)
    assert('Test 28: Customer B cannot read Customer A address', addrBList.status === 200 && foundAInB === false)

    // 29. Customer B cannot update Customer A's address
    const custBUpdateA = await apiRequest(`/addresses/${addr1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ street: 'Hacked Street' }),
    })
    assert('Test 29: Customer B updating Customer A address rejected (404 address_not_found)', custBUpdateA.status === 404)

    // 30. Customer B cannot delete Customer A's address
    const custBDeleteA = await apiRequest(`/addresses/${addr1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    assert('Test 30: Customer B deleting Customer A address rejected (404 address_not_found)', custBDeleteA.status === 404)

    // 32. Invalid required field rejected (e.g. invalid 4-digit PIN)
    const badPinAddr = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Venkatesh',
        phone: '9876543210',
        street: 'Street',
        city: 'City',
        state: 'State',
        pin: '1234', // Invalid PIN!
      }),
    })
    assert('Test 32: Invalid 4-digit PIN code rejected (400 invalid_pin)', badPinAddr.status === 400)

    // 33. Update own address
    const updateAddrRes = await apiRequest(`/addresses/${addr1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        street: '142, Trichy Road, Updated Suite 4B',
      }),
    })
    assert(
      'Test 33: Customer A updates own address successfully',
      updateAddrRes.status === 200 &&
        updateAddrRes.data?.data?.street === '142, Trichy Road, Updated Suite 4B',
    )

    // 35. Create second address and set as default
    const createAddrRes2 = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Office',
        phone: '9876543211',
        street: '77, Avinashi Road',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641018',
        label: 'Work',
        isDefault: true,
      }),
    })
    const addr2 = createAddrRes2.data?.data
    assert('Test 35: Customer A creates second address with isDefault: true', addr2?.isDefault === true)

    // 36. Setting address B as default unsets address A for the SAME user
    const checkAddr1 = (await apiRequest('/addresses', { headers: { Authorization: `Bearer ${tokenA}` } }))
      .data?.data?.find((a) => a.id === addr1.id)
    assert(
      'Test 36: Setting second address as default automatically unsets first address isDefault to false',
      checkAddr1?.isDefault === false,
    )

    // Setup Customer B default address
    const createAddrB = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        name: 'Bob Chennai',
        phone: '9876500002',
        street: '12, Anna Salai',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pin: '600002',
        label: 'Home',
        isDefault: true,
      }),
    })
    const addrB = createAddrB.data?.data

    // 37. Customer A default change never touches Customer B's default address
    await apiRequest(`/addresses/${addr1.id}/default`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const checkAddrB = (await apiRequest('/addresses', { headers: { Authorization: `Bearer ${tokenB}` } }))
      .data?.data?.find((a) => a.id === addrB.id)
    assert(
      'Test 37: Customer A default change never modifies Customer B default address',
      checkAddrB?.isDefault === true,
    )

    // 38. Client cannot assign address to another user through userId in body
    const hackUserAddr = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        userId: userBId, // Attempted ownership spoofing
        name: 'Spoofed Address',
        phone: '9876500003',
        street: '99 Spoof Street',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641001',
      }),
    })
    assert(
      'Test 38: Client cannot forge userId: Address is strictly assigned to authenticated token user (Alice)',
      hackUserAddr.status === 201 && hackUserAddr.data?.data?.userId === String(userAId),
    )

    // 34. Delete own address
    const deleteAddrRes = await apiRequest(`/addresses/${addr2.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert('Test 34: Customer A deletes own address successfully (200 success)', deleteAddrRes.status === 200)

  } finally {
    console.log('\n--- Cleaning up temporary test fixtures ---')
    await User.deleteMany({ email: new RegExp(testSuffix) })
    await Product.deleteMany({ sku: new RegExp(testSuffix) })
    await Category.deleteMany({ slug: new RegExp(testSuffix) })
    if (userAId) {
      await Cart.deleteMany({ userId: userAId })
      await Address.deleteMany({ userId: userAId })
    }
    if (userBId) {
      await Cart.deleteMany({ userId: userBId })
      await Address.deleteMany({ userId: userBId })
    }
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

runCartAddressVerification().catch((err) => {
  console.error('Cart & Address verification failed with error:', err)
  process.exit(1)
})

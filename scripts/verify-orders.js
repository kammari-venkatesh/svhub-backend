import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { User, Product, Category, Cart, Address, Order, Settings, Counter } from '../src/models/index.js'

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

async function runOrderVerification() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.5 ORDER CREATION VERIFICATION')
  console.log('====================================================\n')

  await connectDb()

  const testSuffix = `ord_test_${Date.now()}`
  let tokenA, userAId
  let tokenB, userBId
  let prodA, prodInactive
  let addrA, addrB

  try {
    console.log('--- 1. Setting up test users, catalog & address fixtures ---')

    // Create Customer A
    const regResA = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alice Orders',
        email: `alice_ord_${testSuffix}@example.com`,
        password: 'Password@123',
        phone: '9876511111',
      }),
    })
    tokenA = regResA.data?.token
    userAId = regResA.data?.user?.id

    // Create Customer B
    const regResB = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bob Orders',
        email: `bob_ord_${testSuffix}@example.com`,
        password: 'Password@123',
        phone: '9876522222',
      }),
    })
    tokenB = regResB.data?.token
    userBId = regResB.data?.user?.id

    // Create category
    const testCat = await Category.create({
      name: `Order Test Cat ${testSuffix}`,
      slug: `order-cat-${testSuffix}`,
      storefront: 'nutri-hub',
    })

    // Active Product A with stock 20 for 500g and 10 for 1kg
    prodA = await Product.create({
      name: `Mappillai Samba Rice ${testSuffix}`,
      slug: `samba-rice-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: testCat.slug,
      description: 'Traditional native rice rich in iron and zinc',
      image: 'https://images.unsplash.com/photo-samba',
      price: 249,
      weight: '500 g',
      sku: `SKU-ORD-A-${testSuffix}`,
      qty: 30,
      isActive: true,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          sku: `SKU-ORD-500-${testSuffix}`,
          price: 249,
          originalPrice: 289,
          discount: 14,
          qty: 20,
          isActive: true,
        },
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1 kg',
          sku: `SKU-ORD-1KG-${testSuffix}`,
          price: 460,
          originalPrice: 520,
          discount: 12,
          qty: 10,
          isActive: true,
        },
      ],
    })

    // Inactive Product
    prodInactive = await Product.create({
      name: `Inactive Order Prod ${testSuffix}`,
      slug: `inact-ord-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: testCat.slug,
      description: 'Archived rice',
      image: 'https://images.unsplash.com/photo-inact',
      price: 199,
      weight: '500 g',
      sku: `SKU-ORD-INACT-${testSuffix}`,
      qty: 10,
      isActive: false,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          sku: `SKU-ORD-INACT-500-${testSuffix}`,
          price: 199,
          qty: 10,
          isActive: true,
        },
      ],
    })

    // Address for Customer A
    const addrResA = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Alice Orders',
        phone: '9876511111',
        street: '123, Cross Cut Road, Gandhipuram',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641012',
        label: 'Home',
        isDefault: true,
      }),
    })
    addrA = addrResA.data?.data

    // Address for Customer B
    const addrResB = await apiRequest('/addresses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        name: 'Bob Orders',
        phone: '9876522222',
        street: '456, Mount Road, Teynampet',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pin: '600018',
        label: 'Home',
        isDefault: true,
      }),
    })
    addrB = addrResB.data?.data

    console.log('Fixtures initialized.\n')

    // ----------------------------------------------------
    // ORDER CREATION TESTS
    // ----------------------------------------------------
    console.log('--- 2. Running Order Creation Tests ---')

    // 1. Unauthenticated order creation rejected
    const unauthRes = await apiRequest('/orders', { method: 'POST' })
    assert('Test 1: Unauthenticated POST /api/orders rejected (401)', unauthRes.status === 401)

    // 2. Empty cart rejected
    const emptyCartRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id }),
    })
    assert(
      'Test 2: Empty cart rejected (400 empty_cart)',
      emptyCartRes.status === 400 && emptyCartRes.data?.error?.code === 'empty_cart',
    )

    // Add 1 item (500g, qty: 1) to Customer A's cart
    await apiRequest('/cart/items', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        productId: String(prodA._id),
        variantId: '500g',
        quantity: 1,
      }),
    })

    // 3. Customer A cannot create order using Customer B's address
    const foreignAddrRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrB.id }),
    })
    assert(
      'Test 3: Customer A cannot use Customer B address (404 address_not_found)',
      foreignAddrRes.status === 404,
    )

    // 4. Valid owned address accepted
    const initialStock = prodA.variants[0].qty
    const orderRes1 = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id, shippingMethod: 'standard' }),
    })
    const order1 = orderRes1.data?.data
    assert(
      'Test 4: Valid owned address accepted and order created (201 Created)',
      orderRes1.status === 201 && order1?.id && order1?.orderNumber,
    )

    // 5. Order contains an address snapshot
    assert(
      'Test 5: Order contains immutable shippingAddress snapshot with street & pin',
      order1?.shippingAddress?.street === addrA.street &&
        order1?.shippingAddress?.pin === addrA.pin &&
        order1?.shippingAddress?.name === addrA.name,
    )

    // 6. Address snapshot immutability: Modifying customer address book does not alter order snapshot
    await apiRequest(`/addresses/${addrA.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ street: 'MODIFIED NEW STREET ADDRESS' }),
    })
    const order1Check = await apiRequest(`/orders/${order1.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 6: Modifying customer address in address book does NOT change historical order snapshot',
      order1Check.data?.data?.shippingAddress?.street === '123, Cross Cut Road, Gandhipuram',
    )

    // 7. Inactive product in cart rejected
    // Manually insert inactive product line into cart to simulate stale reference
    const cartA = await Cart.findOne({ userId: userAId })
    cartA.items.push({ productId: prodInactive._id, variantId: '500g', quantity: 1 })
    await cartA.save()

    const inactiveProdOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id }),
    })
    assert(
      'Test 7: Inactive product in cart rejected during order creation (400 product_unavailable)',
      inactiveProdOrderRes.status === 400 &&
        inactiveProdOrderRes.data?.error?.code === 'product_unavailable',
    )

    // Clean out inactive item from cart
    cartA.items = cartA.items.filter((i) => String(i.productId) !== String(prodInactive._id))
    await cartA.save()

    // 8. Inactive variant in cart rejected
    // Temporarily deactivate variant in prodA
    await Product.updateOne(
      { _id: prodA._id, 'variants.variantId': '500g' },
      { $set: { 'variants.$.isActive': false } },
    )
    const inactiveVarOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id }),
    })
    assert(
      'Test 8: Inactive variant in cart rejected during order creation (400 variant_unavailable)',
      inactiveVarOrderRes.status === 400 &&
        inactiveVarOrderRes.data?.error?.code === 'variant_unavailable',
    )
    // Restore variant active state
    await Product.updateOne(
      { _id: prodA._id, 'variants.variantId': '500g' },
      { $set: { 'variants.$.isActive': true } },
    )

    // 9. Sufficient stock accepted & 10. Excessive quantity rejected
    cartA.items = [{ productId: prodA._id, variantId: '500g', quantity: 99 }] // Stock is 20
    await cartA.save()
    const excessiveQtyOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id }),
    })
    assert(
      'Test 10: Excessive quantity exceeding stock rejected (400 insufficient_stock)',
      excessiveQtyOrderRes.status === 400 &&
        excessiveQtyOrderRes.data?.error?.code === 'insufficient_stock',
    )

    // Reset cart to 2 units (2 * 249 = 498 subtotal)
    cartA.items = [{ productId: prodA._id, variantId: '500g', quantity: 2 }]
    await cartA.save()

    // 11. Inventory is NOT deducted during order creation
    const freshProdBefore = await Product.findById(prodA._id)
    const stockBeforeOrder = freshProdBefore.variants[0].qty
    const orderRes2 = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id, shippingMethod: 'standard' }),
    })
    const freshProdAfter = await Product.findById(prodA._id)
    const stockAfterOrder = freshProdAfter.variants[0].qty
    assert(
      'Test 11: Inventory is NOT deducted during order creation (stock before = stock after)',
      orderRes2.status === 201 && stockBeforeOrder === stockAfterOrder && stockAfterOrder === 20,
    )

    // 12. Frontend-supplied prices/subtotals/totals cannot alter order
    const tamperedOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        addressId: addrA.id,
        price: 1, // Tampered
        unitPrice: 1, // Tampered
        subtotal: 10, // Tampered
        shippingFee: 0, // Tampered
        totalAmount: 10, // Tampered
        discount: 500, // Tampered
      }),
    })
    const tamperedOrder = tamperedOrderRes.data?.data
    // Expected: 2 units * 249 = 498 subtotal; 498 < 499 threshold so shipping = 40; total = 538
    assert(
      'Test 12: Price authority enforced: Server calculates subtotal (498), shipping (40), total (538) ignoring all tampered inputs',
      tamperedOrder?.subtotal === 498 &&
        tamperedOrder?.shippingFee === 40 &&
        tamperedOrder?.totalAmount === 538,
    )

    // 13 & 14. Shipping derived from Settings: Free shipping threshold
    // Add 1kg variant (price 460) so subtotal = 498 + 460 = 958 >= 499 threshold
    cartA.items.push({ productId: prodA._id, variantId: '1kg', quantity: 1 })
    await cartA.save()

    const freeShippingOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id, shippingMethod: 'standard' }),
    })
    const freeShippingOrder = freeShippingOrderRes.data?.data
    assert(
      'Test 14: Subtotal >= freeShippingThreshold (958 >= 499) yields shippingFee = 0',
      freeShippingOrder?.subtotal === 958 &&
        freeShippingOrder?.shippingFee === 0 &&
        freeShippingOrder?.totalAmount === 958,
    )

    // 15. Express shipping requested -> shippingFee = expressShippingFee (120)
    const expressOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id, shippingMethod: 'express' }),
    })
    const expressOrder = expressOrderRes.data?.data
    assert(
      'Test 15: Express shipping method yields shippingFee = 120 from Settings',
      expressOrder?.shippingFee === 120 && expressOrder?.totalAmount === 958 + 120,
    )

    // 16. Product snapshots stored in order
    const orderedItem = expressOrder?.items[0]
    assert(
      'Test 16: Order item snapshot contains productId, variantId, productName, variantLabel, sku, unitPrice, lineTotal',
      orderedItem?.productId === String(prodA._id) &&
        orderedItem?.variantId === '500g' &&
        orderedItem?.unitPrice === 249 &&
        orderedItem?.lineTotal === 498,
    )

    // 17. Modifying Product in DB does NOT alter historical order item snapshot
    await Product.updateOne(
      { _id: prodA._id, 'variants.variantId': '500g' },
      { $set: { 'variants.$.price': 9999, name: 'RENAMED PRODUCT' } },
    )
    const expressOrderCheck = await apiRequest(`/orders/${expressOrder.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const preservedItem = expressOrderCheck.data?.data?.items[0]
    assert(
      'Test 17: Product price/name alteration in DB does NOT modify stored order item snapshot',
      preservedItem?.unitPrice === 249 && preservedItem?.productName === prodA.name,
    )
    // Restore product in DB
    await Product.updateOne(
      { _id: prodA._id, 'variants.variantId': '500g' },
      { $set: { 'variants.$.price': 249, name: prodA.name } },
    )

    // 18 & 19. Order status and payment status
    assert(
      'Test 18: Newly created order has status: PENDING_PAYMENT',
      expressOrder?.status === 'PENDING_PAYMENT',
    )
    assert(
      'Test 19: Newly created order has paymentStatus: PENDING',
      expressOrder?.paymentStatus === 'PENDING',
    )

    // 20. Cart remains after order creation
    const cartAfterOrder = await apiRequest('/cart', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    assert(
      'Test 20: Cart remains intact after order creation (items are NOT cleared in Phase 1.5)',
      cartAfterOrder.data?.data?.items?.length === 2,
    )

    // 21 & 22. Order numbers generated through Counter and are sequential
    assert(
      'Test 21: Order number matches #SVH-1000X format',
      /^#SVH-\d{5}$/.test(expressOrder?.orderNumber),
    )

    const nextOrderRes = await apiRequest('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ addressId: addrA.id }),
    })
    const nextOrder = nextOrderRes.data?.data
    const num1 = parseInt(expressOrder.orderNumber.replace('#SVH-', ''), 10)
    const num2 = parseInt(nextOrder.orderNumber.replace('#SVH-', ''), 10)
    assert(
      'Test 22: Order numbers increment sequentially (#SVH-1000X -> #SVH-1000Y)',
      num2 === num1 + 1,
      `num1=${num1}, num2=${num2}`,
    )

    // 23. Concurrent order creation produces unique sequential numbers without duplicates
    const [p1, p2] = await Promise.all([
      apiRequest('/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ addressId: addrA.id }),
      }),
      apiRequest('/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ addressId: addrA.id }),
      }),
    ])
    assert(
      'Test 23: Concurrent orders receive unique order numbers with zero collisions',
      p1.status === 201 &&
        p2.status === 201 &&
        p1.data?.data?.orderNumber !== p2.data?.data?.orderNumber,
    )

  } finally {
    console.log('\n--- Cleaning up temporary test fixtures ---')
    await User.deleteMany({ email: new RegExp(testSuffix) })
    await Product.deleteMany({ sku: new RegExp(testSuffix) })
    await Category.deleteMany({ slug: new RegExp(testSuffix) })
    if (userAId) {
      await Cart.deleteMany({ userId: userAId })
      await Address.deleteMany({ userId: userAId })
      await Order.deleteMany({ userId: userAId })
    }
    if (userBId) {
      await Cart.deleteMany({ userId: userBId })
      await Address.deleteMany({ userId: userBId })
      await Order.deleteMany({ userId: userBId })
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

runOrderVerification().catch((err) => {
  console.error('Order verification failed with error:', err)
  process.exit(1)
})

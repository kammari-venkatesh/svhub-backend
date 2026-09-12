/**
 * Cart reliability verification — rapid quantity updates & atomic PATCH.
 * Requires API server running (default http://localhost:5001/api).
 */
import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { User, Product, Category, Cart } from '../src/models/index.js'

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:5001/api'

let passed = 0
let failed = 0

function assert(description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${description}`)
    passed += 1
  } else {
    console.error(`[FAIL] ${description}`, details)
    failed += 1
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

async function main() {
  console.log('SV HUB — Cart reliability verification\n')
  await connectDb()

  const suffix = `cart_rel_${Date.now()}`
  let token
  let product
  let variantId
  let itemId

  try {
    const reg = await api('/auth/register', {
      method: 'POST',
      body: {
        name: 'Cart Rel Tester',
        email: `${suffix}@example.com`,
        password: 'Password@123',
        phone: '9876512345',
      },
    })
    token = reg.data?.token || reg.data?.data?.token
    assert('register returns token', Boolean(token), JSON.stringify(reg.data))

    const cat = await Category.create({
      name: `Rel Cat ${suffix}`,
      slug: `rel-cat-${suffix}`,
      storefront: 'nutri-hub',
    })

    product = await Product.create({
      name: `Rel Product ${suffix}`,
      slug: `rel-product-${suffix}`,
      storefront: 'nutri-hub',
      category: cat.slug,
      type: 'Rice',
      description: 'Cart reliability test product',
      image: 'https://example.com/p.jpg',
      price: 120,
      weight: '500 g',
      sku: `SKU-REL-${suffix}`,
      qty: 50,
      isActive: true,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          sku: `SKU-REL-500-${suffix}`,
          price: 120,
          originalPrice: 150,
          qty: 50,
          isActive: true,
        },
      ],
    })
    variantId = '500g'

    const add = await api('/cart/items', {
      method: 'POST',
      token,
      body: { productId: String(product._id), variantId, quantity: 1 },
    })
    assert('add to cart 200', add.status === 200, JSON.stringify(add.data))
    itemId = add.data?.data?.items?.[0]?.itemId
    assert('add returns itemId', Boolean(itemId))
    assert('initial qty is 1', add.data?.data?.items?.[0]?.quantity === 1)

    // Sequential absolute updates simulating coalesced client intents
    for (const qty of [2, 3, 4, 5, 6]) {
      const res = await api(`/cart/items/${itemId}`, {
        method: 'PATCH',
        token,
        body: { quantity: qty },
      })
      assert(`PATCH quantity=${qty}`, res.status === 200 && res.data?.data?.items?.[0]?.quantity === qty)
    }

    // Parallel PATCHes with increasing absolute quantities — last writer should win with atomic $set
    const parallelTargets = [7, 8, 9, 10]
    const results = await Promise.all(
      parallelTargets.map((qty) =>
        api(`/cart/items/${itemId}`, {
          method: 'PATCH',
          token,
          body: { quantity: qty },
        }),
      ),
    )
    assert(
      'parallel PATCH all succeed or conflict cleanly',
      results.every((r) => r.status === 200 || r.status === 409),
      results.map((r) => r.status).join(','),
    )

    const finalGet = await api('/cart', { token })
    const finalQty = finalGet.data?.data?.items?.[0]?.quantity
    assert('final quantity is one of parallel targets', parallelTargets.includes(finalQty), String(finalQty))

    // Stock limit
    const over = await api(`/cart/items/${itemId}`, {
      method: 'PATCH',
      token,
      body: { quantity: 51 },
    })
    assert('overstock rejected', over.status === 400 && over.data?.error?.code === 'insufficient_stock')

    // Mixed ops converge
    await api(`/cart/items/${itemId}`, { method: 'PATCH', token, body: { quantity: 4 } })
    await api(`/cart/items/${itemId}`, { method: 'PATCH', token, body: { quantity: 3 } })
    await api(`/cart/items/${itemId}`, { method: 'PATCH', token, body: { quantity: 5 } })
    const mixed = await api('/cart', { token })
    assert('mixed sequential ends at 5', mixed.data?.data?.items?.[0]?.quantity === 5)

    // Remove
    const removed = await api(`/cart/items/${itemId}`, { method: 'DELETE', token })
    assert('remove item', removed.status === 200 && (removed.data?.data?.items?.length ?? 0) === 0)

    // MongoDB cart document empty
    const owner = await User.findOne({ email: `${suffix}@example.com` })
    const cartDoc = await Cart.findOne({ userId: owner._id }).lean()
    assert('mongo cart empty after remove', (cartDoc?.items?.length ?? 0) === 0)

    // Unauthenticated
    const unauth = await api(`/cart/items/${itemId}`, { method: 'PATCH', body: { quantity: 2 } })
    assert('unauthenticated blocked', unauth.status === 401)
  } finally {
    const user = await User.findOne({ email: `${suffix}@example.com` })
    if (user) {
      await Cart.deleteMany({ userId: user._id })
      await User.deleteOne({ _id: user._id })
    }
    await Product.deleteMany({ slug: new RegExp(suffix) })
    await Category.deleteMany({ slug: new RegExp(suffix) })
    await mongoose.disconnect()
  }

  console.log(`\nPassed: ${passed}  Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

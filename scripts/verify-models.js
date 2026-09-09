import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import {
  User,
  Product,
  Category,
  Cart,
  Address,
  Order,
  Payment,
  Settings,
  Counter,
} from '../src/models/index.js'

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

async function validateAsync(doc) {
  try {
    await doc.validate()
    return null
  } catch (err) {
    return err
  }
}

async function runModelVerification() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.2 DATABASE MODELS VERIFICATION')
  console.log('====================================================\n')

  await connectDb()

  // Ensure unique indexes are built on collections before testing unique constraints
  await Promise.all([
    User.init(),
    Product.init(),
    Category.init(),
    Cart.init(),
    Address.init(),
    Order.init(),
    Payment.init(),
    Settings.init(),
    Counter.init(),
  ])

  const testSuffix = `test_${Date.now()}`

  try {
    // ----------------------------------------------------
    // 1. USER MODEL TESTS
    // ----------------------------------------------------
    console.log('--- 1. Testing User Model ---')

    // Valid Customer
    const validCustomer = new User({
      name: 'Priya Venkatesh',
      email: `customer_${testSuffix}@example.com`,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    })
    const customerErr = await validateAsync(validCustomer)
    assert('User: Valid CUSTOMER accepted by schema', !customerErr)

    // Valid Admin
    const validAdmin = new User({
      name: 'Admin Venkatesh',
      email: `admin_${testSuffix}@example.com`,
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    const adminErr = await validateAsync(validAdmin)
    assert('User: Valid ADMIN accepted by schema', !adminErr)

    // Invalid role rejected
    const badRoleUser = new User({
      name: 'Bad Role User',
      email: `badrole_${testSuffix}@example.com`,
      role: 'SUPERADMIN',
    })
    const badRoleErr = await validateAsync(badRoleUser)
    assert(
      'User: Invalid role "SUPERADMIN" rejected by schema',
      badRoleErr && badRoleErr.errors['role'],
    )

    // Invalid status rejected
    const badStatusUser = new User({
      name: 'Bad Status User',
      email: `badstatus_${testSuffix}@example.com`,
      status: 'BANNED',
    })
    const badStatusErr = await validateAsync(badStatusUser)
    assert(
      'User: Invalid status "BANNED" rejected by schema',
      badStatusErr && badStatusErr.errors['status'],
    )

    // Sensitive fields excluded from toPublic()
    const userWithSecrets = new User({
      name: 'Secret User',
      email: `secrets_${testSuffix}@example.com`,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      resetTokenHash: 'hash123456789',
      resetTokenExpires: new Date(Date.now() + 3600000),
    })
    const publicData = userWithSecrets.toPublic()
    assert(
      'User: toPublic() strips passwordHash and resetToken fields',
      publicData.passwordHash === undefined &&
        publicData.resetTokenHash === undefined &&
        publicData.resetTokenExpires === undefined &&
        publicData.hasPassword === true,
    )

    // ----------------------------------------------------
    // 2. PRODUCT MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 2. Testing Product Model ---')

    // Valid Product
    const validProduct = new Product({
      name: 'Kullakar Rice',
      slug: `kullakar-rice-${testSuffix}`,
      type: 'Native Rice',
      storefront: 'nutri-hub',
      category: 'native-rice',
      description: 'Indigenous native rice grown with care in Tamil Nadu.',
      image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c',
      weight: '500 g',
      sku: `SVH-NH-KUL-500-${testSuffix}`,
      price: 249,
      originalPrice: 289,
      discount: 14,
      qty: 40,
      variants: [
        {
          variantId: '500g',
          label: '500 g',
          weight: '500 g',
          sku: `SVH-NH-KUL-500-${testSuffix}`,
          price: 249,
          originalPrice: 289,
          discount: 14,
          qty: 25,
          isActive: true,
        },
        {
          variantId: '1kg',
          label: '1 kg',
          weight: '1 kg',
          sku: `SVH-NH-KUL-1KG-${testSuffix}`,
          price: 460,
          originalPrice: 520,
          discount: 12,
          qty: 15,
          isActive: true,
        },
      ],
    })
    const productErr = await validateAsync(validProduct)
    assert('Product: Valid product with variants accepted', !productErr)

    // Negative base price rejected
    const negativePriceProd = new Product({
      ...validProduct.toObject(),
      slug: `neg-price-${testSuffix}`,
      price: -10,
    })
    const negPriceErr = await validateAsync(negativePriceProd)
    assert(
      'Product: Negative base price rejected',
      negPriceErr && negPriceErr.errors['price'],
    )

    // Negative variant price rejected
    const negVariantPriceProd = new Product({
      ...validProduct.toObject(),
      slug: `neg-var-price-${testSuffix}`,
      variants: [{ ...validProduct.variants[0].toObject(), price: -50 }],
    })
    const negVarPriceErr = await validateAsync(negVariantPriceProd)
    assert(
      'Product: Negative variant price rejected',
      negVarPriceErr && negVarPriceErr.errors['variants.0.price'],
    )

    // Negative stock rejected
    const negStockProd = new Product({
      ...validProduct.toObject(),
      slug: `neg-stock-${testSuffix}`,
      qty: -5,
    })
    const negStockErr = await validateAsync(negStockProd)
    assert(
      'Product: Negative stock rejected',
      negStockErr && negStockErr.errors['qty'],
    )

    // Product without variants rejected
    const noVariantProd = new Product({
      ...validProduct.toObject(),
      slug: `no-var-${testSuffix}`,
      variants: [],
    })
    const noVarErr = await validateAsync(noVariantProd)
    assert(
      'Product: Empty variants array rejected',
      noVarErr && noVarErr.errors['variants'],
    )

    // ----------------------------------------------------
    // 3. CATEGORY MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Category Model ---')

    const validCategory = new Category({
      name: 'Native Rice',
      slug: `native-rice-${testSuffix}`,
      storefront: 'nutri-hub',
      description: 'Indigenous grains grown with care.',
      active: true,
      sortOrder: 1,
    })
    const catErr = await validateAsync(validCategory)
    assert('Category: Valid category accepted', !catErr)
    assert('Category: isActive virtual works', validCategory.isActive === true)

    // Duplicate slug test in DB
    await validCategory.save()
    let duplicateCatBlocked = false
    try {
      const duplicateCategory = new Category({
        name: 'Native Rice Duplicate',
        slug: `native-rice-${testSuffix}`,
        storefront: 'nutri-hub',
      })
      await duplicateCategory.save()
    } catch (err) {
      duplicateCatBlocked = err.code === 11000
    }
    assert('Category: Duplicate slug prevented via unique index', duplicateCatBlocked)

    // ----------------------------------------------------
    // 4. CART MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Cart Model ---')

    const fakeUserId = new mongoose.Types.ObjectId()
    const fakeProdId1 = new mongoose.Types.ObjectId()
    const fakeProdId2 = new mongoose.Types.ObjectId()

    const validCart = new Cart({
      userId: fakeUserId,
      items: [
        {
          productId: fakeProdId1,
          variantId: '500g',
          quantity: 2,
        },
        {
          productId: fakeProdId1, // Same product, different variant allowed!
          variantId: '1kg',
          quantity: 1,
        },
      ],
    })
    const cartErr = await validateAsync(validCart)
    assert(
      'Cart: Valid cart accepted with multiple variants of same product',
      !cartErr && validCart.items.length === 2,
    )

    // Cart item with quantity 0 or negative rejected
    const invalidQtyCart = new Cart({
      userId: fakeUserId,
      items: [
        {
          productId: fakeProdId2,
          variantId: '500g',
          quantity: 0,
        },
      ],
    })
    const invalidQtyErr = await validateAsync(invalidQtyCart)
    assert(
      'Cart: Zero or negative quantity rejected (min 1 required)',
      invalidQtyErr && invalidQtyErr.errors['items.0.quantity'],
    )

    // ----------------------------------------------------
    // 5. ADDRESS MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Address Model ---')

    const validAddress = new Address({
      userId: fakeUserId,
      label: 'Home',
      name: 'Priya Venkatesh',
      phone: '9876543210',
      street: '142, Trichy Road, Singanallur',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pin: '641005',
      country: 'India',
      isDefault: true,
    })
    const addrErr = await validateAsync(validAddress)
    assert('Address: Valid address accepted', !addrErr)
    assert('Address: Alias addressLine1 matches street', validAddress.addressLine1 === '142, Trichy Road, Singanallur')
    assert('Address: Alias postalCode matches pin', validAddress.postalCode === '641005')

    // Missing required fields
    const invalidAddress = new Address({
      userId: fakeUserId,
      label: 'Home',
    })
    const missingAddrErr = await validateAsync(invalidAddress)
    assert(
      'Address: Missing required recipient fields rejected',
      missingAddrErr &&
        missingAddrErr.errors['name'] &&
        missingAddrErr.errors['phone'] &&
        missingAddrErr.errors['street'] &&
        missingAddrErr.errors['city'] &&
        missingAddrErr.errors['state'] &&
        missingAddrErr.errors['pin'],
    )

    // ----------------------------------------------------
    // 6. ORDER MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 6. Testing Order Model ---')

    const validOrder = new Order({
      orderNumber: `SVH-${testSuffix}-001`,
      userId: fakeUserId,
      customerName: 'Priya Venkatesh',
      email: `customer_${testSuffix}@example.com`,
      phone: '9876543210',
      shippingAddress: {
        name: 'Priya Venkatesh',
        phone: '9876543210',
        street: '142, Trichy Road, Singanallur',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pin: '641005',
        country: 'India',
        lines: ['142, Trichy Road, Singanallur', 'Coimbatore, Tamil Nadu', '641005'],
      },
      items: [
        {
          productId: fakeProdId1,
          variantId: '1kg',
          productName: 'Kullakar Rice',
          variantLabel: '1 kg',
          weight: '1 kg',
          sku: `SVH-NH-KUL-1KG-${testSuffix}`,
          unitPrice: 460,
          originalPrice: 520,
          discount: 12,
          quantity: 2,
          lineTotal: 920,
          image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c',
          storefront: 'nutri-hub',
        },
      ],
      subtotal: 920,
      shippingFee: 0,
      discount: 0,
      totalAmount: 920,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
    })

    const orderErr = await validateAsync(validOrder)
    assert('Order: Valid order with item & address snapshots accepted', !orderErr)

    // Invalid order status rejected
    const badStatusOrder = new Order({
      ...validOrder.toObject(),
      orderNumber: `SVH-${testSuffix}-002`,
      status: 'INVALID_STATUS',
    })
    const badStatusOrderErr = await validateAsync(badStatusOrder)
    assert(
      'Order: Invalid fulfillment status rejected',
      badStatusOrderErr && badStatusOrderErr.errors['status'],
    )

    // Invalid payment status rejected
    const badPaymentStatusOrder = new Order({
      ...validOrder.toObject(),
      orderNumber: `SVH-${testSuffix}-003`,
      paymentStatus: 'UNKNOWN_PAYMENT',
    })
    const badPaymentStatusErr = await validateAsync(badPaymentStatusOrder)
    assert(
      'Order: Invalid payment status rejected',
      badPaymentStatusErr && badPaymentStatusErr.errors['paymentStatus'],
    )

    // Order uniqueness on orderNumber in DB
    await validOrder.save()
    let duplicateOrderBlocked = false
    try {
      const duplicateOrder = new Order({
        ...validOrder.toObject(),
        _id: new mongoose.Types.ObjectId(),
      })
      await duplicateOrder.save()
    } catch (err) {
      duplicateOrderBlocked = err.code === 11000
    }
    assert('Order: Duplicate orderNumber prevented via unique index', duplicateOrderBlocked)

    // ----------------------------------------------------
    // 7. PAYMENT MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 7. Testing Payment Model ---')

    const validPayment = new Payment({
      orderId: validOrder._id,
      userId: fakeUserId,
      amount: 92000, // 920 INR in paise
      currency: 'INR',
      gateway: 'razorpay',
      status: 'CREATED',
      razorpayOrderId: `order_${testSuffix}_rzp`,
      razorpayPaymentId: `pay_${testSuffix}_rzp`,
      verified: false,
    })
    const paymentErr = await validateAsync(validPayment)
    assert('Payment: Valid payment record accepted', !paymentErr)

    // Invalid payment status rejected
    const badPayment = new Payment({
      ...validPayment.toObject(),
      razorpayOrderId: `order_bad_${testSuffix}`,
      status: 'DISPUTED_INVALID',
    })
    const badPayErr = await validateAsync(badPayment)
    assert(
      'Payment: Invalid payment status rejected',
      badPayErr && badPayErr.errors['status'],
    )

    // Duplicate razorpayOrderId prevented in DB
    await validPayment.save()
    let duplicatePaymentBlocked = false
    try {
      const duplicatePayment = new Payment({
        ...validPayment.toObject(),
        _id: new mongoose.Types.ObjectId(),
      })
      await duplicatePayment.save()
    } catch (err) {
      duplicatePaymentBlocked = err.code === 11000
    }
    assert('Payment: Duplicate razorpayOrderId prevented via unique index', duplicatePaymentBlocked)

    // ----------------------------------------------------
    // 8. SETTINGS MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 8. Testing Settings Model ---')

    const validSettings = new Settings({
      key: `settings_${testSuffix}`,
      supportEmail: 'care@svhub.in',
      supportPhone: '+91 98765 43210',
      standardShippingFee: 40,
      expressShippingFee: 120,
      freeShippingThreshold: 499,
      lowStockThreshold: 10,
      currency: 'INR',
    })
    const settingsErr = await validateAsync(validSettings)
    assert('Settings: Valid settings structure accepted', !settingsErr)

    // Negative shipping fee rejected
    const negFeeSettings = new Settings({
      key: `settings_neg_${testSuffix}`,
      standardShippingFee: -10,
    })
    const negFeeErr = await validateAsync(negFeeSettings)
    assert(
      'Settings: Negative shipping fee rejected',
      negFeeErr && negFeeErr.errors['standardShippingFee'],
    )

    // Singleton getSettings test
    const singleton = await Settings.getSettings()
    assert('Settings: Settings.getSettings() retrieves or creates singleton', singleton && singleton.key === 'store_settings')

    // ----------------------------------------------------
    // 9. COUNTER MODEL TESTS
    // ----------------------------------------------------
    console.log('\n--- 9. Testing Counter Model ---')

    const counterKey = `order_counter_${testSuffix}`
    const seq1 = await Counter.getNextSequence(counterKey)
    const seq2 = await Counter.getNextSequence(counterKey)
    assert(
      'Counter: Atomic getNextSequence increments sequentially (10001 -> 10002)',
      seq1 === 10001 && seq2 === 10002,
      `Got seq1=${seq1}, seq2=${seq2}`,
    )

  } finally {
    console.log('\n--- Cleaning up temporary test records ---')
    await Category.deleteMany({ slug: new RegExp(testSuffix) })
    await Order.deleteMany({ orderNumber: new RegExp(testSuffix) })
    await Payment.deleteMany({ razorpayOrderId: new RegExp(testSuffix) })
    await Settings.deleteMany({ key: new RegExp(testSuffix) })
    await Counter.deleteMany({ key: new RegExp(testSuffix) })
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

runModelVerification().catch((err) => {
  console.error('Model verification failed with error:', err)
  process.exit(1)
})

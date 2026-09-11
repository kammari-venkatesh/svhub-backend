import { env } from '../src/config/env.js'
import mongoose from 'mongoose'
import { Order } from '../src/models/Order.js'
import { Payment } from '../src/models/Payment.js'
import { Refund } from '../src/models/Refund.js'
import { WebhookEvent } from '../src/models/WebhookEvent.js'
import { Product } from '../src/models/Product.js'
import { User } from '../src/models/User.js'
import { Cart } from '../src/models/Cart.js'

async function recordBaseline() {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGO_DB || 'svhub' })

  const ordersCount = await Order.countDocuments()
  const paymentsCount = await Payment.countDocuments()
  const refundsCount = await Refund.countDocuments()
  const webhooksCount = await WebhookEvent.countDocuments()
  const productsCount = await Product.countDocuments()

  // Find a target product with stock
  const product = await Product.findOne({ 'variants.qty': { $gt: 5 }, isActive: true })
  const variant = product?.variants?.find((v) => v.qty > 5)

  console.log(
    JSON.stringify(
      {
        ordersCount,
        paymentsCount,
        refundsCount,
        webhooksCount,
        productsCount,
        targetProduct: {
          id: product?._id,
          name: product?.name,
          variantId: variant?._id,
          variantLabel: variant?.label,
          stock: variant?.stock,
          price: variant?.price,
        },
      },
      null,
      2
    )
  )

  await mongoose.disconnect()
}

recordBaseline().catch((err) => {
  console.error(err)
  process.exit(1)
})

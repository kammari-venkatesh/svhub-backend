import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { Order } from '../src/models/Order.js'

async function migrateExpectedDelivery() {
  await connectDb()

  const ordersWithoutDate = await Order.find({
    $or: [
      { expectedDeliveryDate: null },
      { expectedDeliveryDate: { $exists: false } },
    ],
  })

  console.log(`Found ${ordersWithoutDate.length} orders needing expectedDeliveryDate backfill.`)

  let updated = 0
  for (const order of ordersWithoutDate) {
    // 7 calendar days after order createdAt date
    const baseDate = order.createdAt ? new Date(order.createdAt) : new Date()
    const expected = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000)

    await Order.updateOne(
      { _id: order._id },
      { $set: { expectedDeliveryDate: expected } }
    )
    console.log(`Updated order ${order.orderNumber}: expectedDeliveryDate set to ${expected.toISOString()}`)
    updated++
  }

  console.log(`Successfully migrated ${updated} orders.`)
  await mongoose.disconnect()
}

migrateExpectedDelivery().catch((err) => {
  console.error('Migration error:', err)
  process.exit(1)
})

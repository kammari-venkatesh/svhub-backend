import mongoose from 'mongoose'
import { Product } from '../models/Product.js'

/**
 * Atomically deducts inventory for items in an order.
 * Ensures variants.qty >= requested and base qty >= requested.
 * If any item fails, rolls back previously deducted items.
 * Uses replica set session/transaction if available.
 *
 * @param {Array<{productId: string|mongoose.Types.ObjectId, variantId: string, quantity: number, productName?: string}>} items
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deductOrderInventory(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { success: true }
  }

  // Attempt MongoDB Transaction first if session is available
  let session = null
  try {
    session = await mongoose.startSession()
  } catch {
    session = null
  }

  if (session) {
    try {
      session.startTransaction()
      for (const item of items) {
        const qtyToDeduct = Number(item.quantity) || 0
        if (qtyToDeduct <= 0) continue

        // Atomic update checking current stock >= requested quantity
        const res = await Product.updateOne(
          {
            _id: item.productId,
            'variants.variantId': item.variantId,
            'variants.qty': { $gte: qtyToDeduct },
            qty: { $gte: qtyToDeduct },
          },
          {
            $inc: {
              'variants.$.qty': -qtyToDeduct,
              qty: -qtyToDeduct,
            },
          },
          { session },
        )

        if (res.modifiedCount !== 1) {
          throw new Error(`Insufficient stock for item "${item.productName || item.productId}" (variant: ${item.variantId})`)
        }
      }

      await session.commitTransaction()
      return { success: true }
    } catch (err) {
      await session.abortTransaction().catch(() => {})
      return { success: false, error: err.message }
    } finally {
      await session.endSession().catch(() => {})
    }
  }

  // Fallback for standalone Mongo environments without replica set transactions
  const successfullyDeducted = []
  for (const item of items) {
    const qtyToDeduct = Number(item.quantity) || 0
    if (qtyToDeduct <= 0) continue

    const res = await Product.updateOne(
      {
        _id: item.productId,
        'variants.variantId': item.variantId,
        'variants.qty': { $gte: qtyToDeduct },
        qty: { $gte: qtyToDeduct },
      },
      {
        $inc: {
          'variants.$.qty': -qtyToDeduct,
          qty: -qtyToDeduct,
        },
      },
    )

    if (res.modifiedCount !== 1) {
      // Roll back all items that were successfully deducted so far
      for (const prev of successfullyDeducted) {
        await Product.updateOne(
          {
            _id: prev.productId,
            'variants.variantId': prev.variantId,
          },
          {
            $inc: {
              'variants.$.qty': prev.quantity,
              qty: prev.quantity,
            },
          },
        ).catch(() => {})
      }

      return {
        success: false,
        error: `Insufficient stock for item "${item.productName || item.productId}" (variant: ${item.variantId})`,
      }
    }

    successfullyDeducted.push(item)
  }

  return { success: true }
}

import mongoose from 'mongoose'
import { Product } from '../models/Product.js'

/**
 * Atomically deducts inventory for items in an order.
 * Ensures variants.qty >= requested and base qty >= requested.
 * If external session is provided, executes within that transaction.
 * Otherwise creates its own session/transaction.
 *
 * @param {Array<{productId: string|mongoose.Types.ObjectId, variantId: string, quantity: number, productName?: string}>} items
 * @param {mongoose.ClientSession|null} [externalSession=null]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deductOrderInventory(items, externalSession = null) {
  if (!Array.isArray(items) || items.length === 0) {
    return { success: true }
  }

  // If caller provided an active transaction session, use it directly
  if (externalSession) {
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
        { session: externalSession },
      )

      if (res.modifiedCount !== 1) {
        return {
          success: false,
          error: `Insufficient stock for item "${item.productName || item.productId}" (variant: ${item.variantId})`,
        }
      }
    }
    return { success: true }
  }

  // Standalone execution: attempt MongoDB Transaction if replica set is available
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

/**
 * Atomically restores inventory for items in an order (e.g. upon admin cancellation of a paid/confirmed order).
 * If external session is provided, executes within that transaction.
 *
 * @param {Array<{productId: string|mongoose.Types.ObjectId, variantId: string, quantity: number}>} items
 * @param {mongoose.ClientSession|null} [externalSession=null]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function restoreOrderInventory(items, externalSession = null) {
  if (!Array.isArray(items) || items.length === 0) {
    return { success: true }
  }

  const sessionOptions = externalSession ? { session: externalSession } : undefined

  try {
    for (const item of items) {
      const qtyToRestore = Number(item.quantity) || 0
      if (qtyToRestore <= 0) continue

      await Product.updateOne(
        {
          _id: item.productId,
          'variants.variantId': item.variantId,
        },
        {
          $inc: {
            'variants.$.qty': qtyToRestore,
            qty: qtyToRestore,
          },
        },
        sessionOptions,
      )
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message, rawError: err }
  }
}

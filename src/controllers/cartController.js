import mongoose from 'mongoose'
import { Cart } from '../models/Cart.js'
import { Product } from '../models/Product.js'

export async function populateCart(cart) {
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    return {
      id: cart ? String(cart._id) : null,
      items: [],
      count: 0,
      subtotal: 0,
    }
  }

  const productIds = cart.items.map((i) => i.productId)
  const products = await Product.find({ _id: { $in: productIds } }).lean()
  const productMap = new Map(products.map((p) => [String(p._id), p]))

  const resolvedItems = []
  let totalCount = 0
  let totalSubtotal = 0

  for (const item of cart.items) {
    const product = productMap.get(String(item.productId))
    if (!product || product.isActive === false) {
      // Stale or inactive product - safely omit from active cart
      continue
    }

    const variant = (product.variants || []).find((v) => v.variantId === item.variantId)
    if (!variant || variant.isActive === false) {
      // Stale or inactive variant - safely omit from active cart
      continue
    }

    const price = variant.price
    const originalPrice = variant.originalPrice || null
    const discount = variant.discount || null
    const lineTotal = price * item.quantity
    const inStock = variant.qty >= item.quantity && variant.qty > 0
    const stockStatus =
      variant.qty > 0 ? (variant.qty <= 10 ? 'low-stock' : 'in-stock') : 'out-of-stock'

    resolvedItems.push({
      id: String(item._id),
      itemId: String(item._id),
      productId: String(product._id),
      slug: product.slug,
      name: product.name,
      type: product.type,
      category: product.category,
      storefront: product.storefront,
      variantId: variant.variantId,
      variantLabel: variant.label,
      weight: variant.weight,
      sku: variant.sku,
      image: product.image,
      price,
      originalPrice,
      discount,
      quantity: item.quantity,
      lineTotal,
      stock: stockStatus,
      availableStock: variant.qty,
      inStock,
      maxAllowed: Math.min(99, variant.qty),
    })

    totalCount += item.quantity
    totalSubtotal += lineTotal
  }

  return {
    id: String(cart._id),
    items: resolvedItems,
    count: totalCount,
    subtotal: totalSubtotal,
  }
}

// 1. Get authenticated customer cart
export async function getCart(req, res, next) {
  try {
    const cart = await Cart.findOne({ userId: req.user._id })
    const resolved = await populateCart(cart)
    res.json({
      success: true,
      data: resolved,
    })
  } catch (err) {
    next(err)
  }
}

// 2. Add product variant line item to cart
export async function addToCart(req, res, next) {
  try {
    const { productId, variantId } = req.body || {}

    if (!productId || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_product_id',
          message: 'A valid productId is required.',
        },
      })
    }

    const cleanVariantId = String(variantId || '').trim()
    if (!cleanVariantId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_variant_id',
          message: 'A valid variantId is required.',
        },
      })
    }

    const rawQty = req.body.quantity
    const qty = rawQty !== undefined ? Number(rawQty) : 1
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_quantity',
          message: 'Quantity must be an integer between 1 and 99.',
        },
      })
    }

    // Resolve Product & Variant authoritative data
    const product = await Product.findOne({ _id: productId, isActive: true })
    if (!product) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'product_not_found',
          message: 'Product not found or is no longer active.',
        },
      })
    }

    const variant = (product.variants || []).find(
      (v) => v.variantId === cleanVariantId && v.isActive !== false,
    )
    if (!variant) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'variant_not_found',
          message: 'Selected variant is not available.',
        },
      })
    }

    // Find or create cart safely
    let cart = await Cart.findOne({ userId: req.user._id })
    if (!cart) {
      try {
        cart = await Cart.create({ userId: req.user._id, items: [] })
      } catch (err) {
        if (err.code === 11000) {
          cart = await Cart.findOne({ userId: req.user._id })
        } else {
          throw err
        }
      }
    }

    // Check composite line item uniqueness (productId, variantId)
    const existingItem = cart.items.find(
      (i) => String(i.productId) === String(product._id) && i.variantId === variant.variantId,
    )

    const targetQty = existingItem ? existingItem.quantity + qty : qty

    if (targetQty > 99) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'quantity_limit_exceeded',
          message: 'Maximum 99 units allowed per cart line.',
        },
      })
    }

    if (targetQty > variant.qty) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'insufficient_stock',
          message: `Only ${variant.qty} units available in stock.`,
        },
      })
    }

    if (existingItem) {
      existingItem.quantity = targetQty
    } else {
      cart.items.push({
        productId: product._id,
        variantId: variant.variantId,
        quantity: targetQty,
      })
    }

    await cart.save()
    const resolved = await populateCart(cart)

    res.json({
      success: true,
      data: resolved,
    })
  } catch (err) {
    next(err)
  }
}

// 3. Update quantity of existing cart item
export async function updateCartItem(req, res, next) {
  try {
    const rawQty = req.body?.quantity
    const qty = rawQty !== undefined ? Number(rawQty) : NaN
    if (!Number.isInteger(qty) || qty < 0 || qty > 99) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_quantity',
          message: 'Quantity must be an integer between 0 and 99.',
        },
      })
    }

    const cart = await Cart.findOne({ userId: req.user._id })
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'cart_not_found',
          message: 'Cart not found.',
        },
      })
    }

    const targetId = String(req.params.id || '').trim()
    const item = cart.items.find(
      (i) => String(i._id) === targetId || i.variantId === targetId,
    )

    if (!item) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'item_not_found',
          message: 'Item not found in cart.',
        },
      })
    }

    if (qty === 0) {
      // Remove item
      cart.items = cart.items.filter((i) => String(i._id) !== String(item._id))
      await cart.save()
      const resolved = await populateCart(cart)
      return res.json({
        success: true,
        data: resolved,
      })
    }

    // Verify stock with live product
    const product = await Product.findOne({ _id: item.productId, isActive: true })
    if (!product) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'product_unavailable',
          message: 'Product is no longer available.',
        },
      })
    }

    const variant = (product.variants || []).find(
      (v) => v.variantId === item.variantId && v.isActive !== false,
    )
    if (!variant) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'variant_unavailable',
          message: 'Variant is no longer available.',
        },
      })
    }

    if (qty > variant.qty) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'insufficient_stock',
          message: `Only ${variant.qty} units available in stock.`,
        },
      })
    }

    item.quantity = qty
    await cart.save()
    const resolved = await populateCart(cart)

    res.json({
      success: true,
      data: resolved,
    })
  } catch (err) {
    next(err)
  }
}

// 4. Remove cart line item
export async function removeCartItem(req, res, next) {
  try {
    const cart = await Cart.findOne({ userId: req.user._id })
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'cart_not_found',
          message: 'Cart not found.',
        },
      })
    }

    const targetId = String(req.params.id || '').trim()
    const initialLen = cart.items.length
    cart.items = cart.items.filter(
      (i) => String(i._id) !== targetId && i.variantId !== targetId,
    )

    if (cart.items.length === initialLen) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'item_not_found',
          message: 'Item not found in cart.',
        },
      })
    }

    await cart.save()
    const resolved = await populateCart(cart)

    res.json({
      success: true,
      data: resolved,
    })
  } catch (err) {
    next(err)
  }
}

// 5. Clear all cart items
export async function clearCart(req, res, next) {
  try {
    const cart = await Cart.findOne({ userId: req.user._id })
    if (cart) {
      cart.items = []
      await cart.save()
    }

    res.json({
      success: true,
      data: {
        id: cart ? String(cart._id) : null,
        items: [],
        count: 0,
        subtotal: 0,
      },
    })
  } catch (err) {
    next(err)
  }
}

// 6. Merge guest items into server cart on login
export async function mergeCart(req, res, next) {
  try {
    const incomingItems = Array.isArray(req.body?.items) ? req.body.items : []

    let cart = await Cart.findOne({ userId: req.user._id })
    if (!cart) {
      try {
        cart = await Cart.create({ userId: req.user._id, items: [] })
      } catch (err) {
        if (err.code === 11000) {
          cart = await Cart.findOne({ userId: req.user._id })
        } else {
          throw err
        }
      }
    }

    for (const item of incomingItems) {
      const { productId, variantId, quantity } = item || {}
      if (!productId || !mongoose.isValidObjectId(productId) || !variantId) continue

      const qty = Math.max(1, Math.min(99, parseInt(quantity || 1, 10) || 1))

      const product = await Product.findOne({ _id: productId, isActive: true })
      if (!product) continue

      const variant = (product.variants || []).find(
        (v) => v.variantId === variantId && v.isActive !== false,
      )
      if (!variant) continue

      const existing = cart.items.find(
        (i) => String(i.productId) === String(product._id) && i.variantId === variant.variantId,
      )

      if (existing) {
        existing.quantity = Math.min(99, Math.min(variant.qty, existing.quantity + qty))
      } else {
        const allowedQty = Math.min(99, Math.min(variant.qty, qty))
        if (allowedQty > 0) {
          cart.items.push({
            productId: product._id,
            variantId: variant.variantId,
            quantity: allowedQty,
          })
        }
      }
    }

    await cart.save()
    const resolved = await populateCart(cart)

    res.json({
      success: true,
      data: resolved,
    })
  } catch (err) {
    next(err)
  }
}

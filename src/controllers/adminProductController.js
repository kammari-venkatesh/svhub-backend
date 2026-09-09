import mongoose from 'mongoose'
import { Product } from '../models/Product.js'
import { Category } from '../models/Category.js'

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatAdminProduct(p) {
  const variants = (p.variants || []).map((v) => ({
    id: v.variantId,
    variantId: v.variantId,
    label: v.label,
    weight: v.weight,
    sku: v.sku,
    price: v.price,
    originalPrice: v.originalPrice || null,
    discount: v.discount || null,
    qty: v.qty,
    stock: v.qty > 10 ? 'in-stock' : v.qty > 0 ? 'low-stock' : 'out-of-stock',
    inStock: v.qty > 0,
    isActive: v.isActive !== false,
  }))

  return {
    id: String(p._id),
    _id: String(p._id),
    name: p.name,
    slug: p.slug,
    type: p.type,
    category: p.category,
    storefront: p.storefront,
    description: p.description || '',
    ingredients: p.ingredients || [],
    specifications: p.specifications || [],
    details:
      p.specifications && p.specifications.length
        ? p.specifications.map((s) => `${s.label}: ${s.value}`).join('\n')
        : p.description || '',
    image: p.image,
    gallery: p.gallery || [],
    price: p.price,
    originalPrice: p.originalPrice || null,
    discount: p.discount || null,
    weight: p.weight,
    sku: p.sku,
    qty: p.qty,
    stock: p.qty > 10 ? 'in-stock' : p.qty > 0 ? 'low-stock' : 'out-of-stock',
    inStock: p.qty > 0,
    active: Boolean(p.isActive),
    isActive: Boolean(p.isActive),
    isFeatured: Boolean(p.isFeatured),
    variants,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

// 1. List admin products with comprehensive filtering & pagination
export async function getAdminProducts(req, res, next) {
  try {
    const filter = {}

    // Status filter: active | inactive | all
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'all'
    if (status === 'active') {
      filter.isActive = true
    } else if (status === 'inactive') {
      filter.isActive = false
    }

    // Category filter
    const category =
      typeof req.query.category === 'string'
        ? req.query.category.trim()
        : typeof req.query.cat === 'string'
          ? req.query.cat.trim()
          : ''
    if (category && category !== 'all') {
      filter.category = category
    }

    // Storefront filter
    const storefront =
      typeof req.query.storefront === 'string'
        ? req.query.storefront.trim()
        : typeof req.query.house === 'string'
          ? req.query.house.trim()
          : ''
    if (storefront && storefront !== 'all') {
      filter.storefront = storefront
    }

    // Stock filter
    const stock = typeof req.query.stock === 'string' ? req.query.stock.trim() : 'all'
    if (stock === 'in-stock') {
      filter.qty = { $gt: 10 }
    } else if (stock === 'low-stock') {
      filter.qty = { $gt: 0, $lte: 10 }
    } else if (stock === 'out-of-stock') {
      filter.qty = { $lte: 0 }
    } else if (stock === 'alert') {
      filter.qty = { $lte: 10 }
    }

    // Featured filter
    if (req.query.featured === 'true' || req.query.featured === true) {
      filter.isFeatured = true
    }

    // Search keyword query
    const searchQuery =
      typeof req.query.search === 'string'
        ? req.query.search.trim()
        : typeof req.query.q === 'string'
          ? req.query.q.trim()
          : ''
    if (searchQuery) {
      const safePattern = escapeRegex(searchQuery)
      const regex = new RegExp(safePattern, 'i')
      filter.$or = [{ name: regex }, { sku: regex }, { type: regex }, { slug: regex }]
    }

    // Sorting
    const sortParam = typeof req.query.sort === 'string' ? req.query.sort.trim() : ''
    let sort = { createdAt: -1 }
    if (sortParam === 'price-asc' || sortParam === 'price_asc' || sortParam === 'low-to-high') {
      sort = { price: 1 }
    } else if (sortParam === 'price-desc' || sortParam === 'price_desc' || sortParam === 'high-to-low') {
      sort = { price: -1 }
    } else if (sortParam === 'name' || sortParam === 'name-asc') {
      sort = { name: 1 }
    } else if (sortParam === 'name-desc') {
      sort = { name: -1 }
    } else if (sortParam === 'qty-asc') {
      sort = { qty: 1 }
    } else if (sortParam === 'qty-desc') {
      sort = { qty: -1 }
    } else if (sortParam === 'newest') {
      sort = { createdAt: -1 }
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const skip = (page - 1) * limit

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    ])

    res.json({
      success: true,
      data: products.map(formatAdminProduct),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    })
  } catch (err) {
    next(err)
  }
}

// 2. Get admin product by ID or slug
export async function getAdminProductById(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const product = await Product.findOne(query).lean()
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'product_not_found', message: 'Product not found.' },
      })
    }

    res.json({
      success: true,
      data: formatAdminProduct(product),
    })
  } catch (err) {
    next(err)
  }
}

// 3. Create a new product
export async function createAdminProduct(req, res, next) {
  try {
    const body = req.body || {}
    const name = String(body.name || '').trim()
    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_product_name', message: 'Product name is required.' },
      })
    }

    const slug = String(body.slug || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!slug) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_slug', message: 'A valid URL slug is required.' },
      })
    }

    const existingSlug = await Product.findOne({ slug })
    if (existingSlug) {
      return res.status(400).json({
        success: false,
        error: { code: 'duplicate_slug', message: `Product slug "${slug}" is already in use.` },
      })
    }

    const categorySlug = String(body.category || '').trim().toLowerCase()
    if (!categorySlug) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_category', message: 'Category is required.' },
      })
    }

    const categoryDoc = await Category.findOne({ slug: categorySlug })
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_category', message: `Category "${categorySlug}" does not exist.` },
      })
    }

    const storefront = String(body.storefront || categoryDoc.storefront || 'nutri-hub').trim()
    if (storefront !== 'nutri-hub' && storefront !== 'self-care') {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_storefront', message: 'Storefront must be nutri-hub or self-care.' },
      })
    }

    const price = Number(body.price)
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_price', message: 'Price must be greater than 0.' },
      })
    }

    const qty = Math.max(0, parseInt(body.qty ?? body.stock, 10) || 0)
    const sku = String(body.sku || `SVH-${slug.slice(0, 8).toUpperCase()}`).trim()
    const existingSku = await Product.findOne({ sku })
    if (existingSku) {
      return res.status(400).json({
        success: false,
        error: { code: 'duplicate_sku', message: `SKU "${sku}" is already in use.` },
      })
    }

    const weight = String(body.weight || 'Standard').trim()
    const image = String(body.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c').trim()
    const description = String(body.description || name).trim()
    const type = String(body.type || categoryDoc.name || 'Traditional').trim()

    let variants = []
    if (Array.isArray(body.variants) && body.variants.length > 0) {
      const seenVariantIds = new Set()
      const seenSkus = new Set()
      for (const v of body.variants) {
        const vId = String(v.variantId || v.id || '').trim()
        const vSku = String(v.sku || '').trim()
        const vPrice = Number(v.price)
        const vQty = Math.max(0, parseInt(v.qty ?? v.stock, 10) || 0)
        if (!vId || seenVariantIds.has(vId)) {
          return res.status(400).json({
            success: false,
            error: { code: 'invalid_variant', message: 'Each variant must have a unique variantId.' },
          })
        }
        if (!vSku || seenSkus.has(vSku)) {
          return res.status(400).json({
            success: false,
            error: { code: 'invalid_variant_sku', message: 'Each variant must have a unique SKU.' },
          })
        }
        if (isNaN(vPrice) || vPrice <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'invalid_variant_price', message: 'Variant price must be greater than 0.' },
          })
        }
        seenVariantIds.add(vId)
        seenSkus.add(vSku)
        variants.push({
          variantId: vId,
          label: String(v.label || v.weight || 'Standard').trim(),
          weight: String(v.weight || 'Standard').trim(),
          sku: vSku,
          price: vPrice,
          originalPrice: v.originalPrice ? Number(v.originalPrice) : null,
          discount: v.discount ? Number(v.discount) : null,
          qty: vQty,
          isActive: v.isActive !== false,
        })
      }
    } else {
      variants = [
        {
          variantId: `${slug}-std`,
          label: weight,
          weight,
          sku,
          price,
          originalPrice: body.originalPrice ? Number(body.originalPrice) : null,
          discount: body.discount ? Number(body.discount) : null,
          qty,
          isActive: true,
        },
      ]
    }

    const ingredients = Array.isArray(body.ingredients)
      ? body.ingredients.map((i) => String(i).trim()).filter(Boolean)
      : String(body.ingredients || '')
          .split(/[\n,]/)
          .map((i) => i.trim())
          .filter(Boolean)

    let specifications = []
    if (Array.isArray(body.specifications)) {
      specifications = body.specifications
    } else if (typeof body.details === 'string' && body.details.trim()) {
      specifications = body.details
        .split('\n')
        .map((line) => {
          const parts = line.split(':')
          if (parts.length >= 2) {
            return { label: parts[0].trim(), value: parts.slice(1).join(':').trim() }
          }
          return null
        })
        .filter(Boolean)
    }

    const product = await Product.create({
      name,
      slug,
      type,
      storefront,
      category: categorySlug,
      description,
      ingredients,
      specifications,
      image,
      gallery: Array.isArray(body.gallery) ? body.gallery.filter(Boolean) : [],
      price,
      originalPrice: body.originalPrice ? Number(body.originalPrice) : null,
      discount: body.discount ? Number(body.discount) : null,
      weight,
      sku,
      qty,
      isActive: body.active !== false && body.isActive !== false,
      isFeatured: Boolean(body.isFeatured),
      variants,
    })

    res.status(201).json({
      success: true,
      data: formatAdminProduct(product),
    })
  } catch (err) {
    next(err)
  }
}

// 4. Update an existing product
export async function updateAdminProduct(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const product = await Product.findOne(query)
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'product_not_found', message: 'Product not found.' },
      })
    }

    const body = req.body || {}

    // Name
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_product_name', message: 'Product name cannot be empty.' },
        })
      }
      product.name = name
    }

    // Slug
    if (body.slug !== undefined) {
      const slug = String(body.slug)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      if (!slug) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_slug', message: 'A valid URL slug is required.' },
        })
      }
      if (slug !== product.slug) {
        const existing = await Product.findOne({ slug, _id: { $ne: product._id } })
        if (existing) {
          return res.status(400).json({
            success: false,
            error: { code: 'duplicate_slug', message: `Slug "${slug}" is already taken.` },
          })
        }
        product.slug = slug
      }
    }

    // Category
    if (body.category !== undefined) {
      const categorySlug = String(body.category).trim().toLowerCase()
      const categoryDoc = await Category.findOne({ slug: categorySlug })
      if (!categoryDoc) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_category', message: `Category "${categorySlug}" does not exist.` },
        })
      }
      product.category = categorySlug
    }

    // Storefront
    if (body.storefront !== undefined) {
      const storefront = String(body.storefront).trim()
      if (storefront !== 'nutri-hub' && storefront !== 'self-care') {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_storefront', message: 'Storefront must be nutri-hub or self-care.' },
        })
      }
      product.storefront = storefront
    }

    // Description & Type
    if (body.description !== undefined) product.description = String(body.description).trim()
    if (body.type !== undefined) product.type = String(body.type).trim()

    // Price
    if (body.price !== undefined) {
      const price = Number(body.price)
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_price', message: 'Price must be greater than 0.' },
        })
      }
      product.price = price
    }

    // Original Price & Discount
    if (body.originalPrice !== undefined) {
      product.originalPrice = body.originalPrice ? Number(body.originalPrice) : null
    }
    if (body.discount !== undefined) {
      product.discount = body.discount ? Number(body.discount) : null
    }

    // SKU
    if (body.sku !== undefined) {
      const sku = String(body.sku).trim()
      if (sku !== product.sku) {
        const existingSku = await Product.findOne({ sku, _id: { $ne: product._id } })
        if (existingSku) {
          return res.status(400).json({
            success: false,
            error: { code: 'duplicate_sku', message: `SKU "${sku}" is already taken.` },
          })
        }
        product.sku = sku
      }
    }

    // Quantity / Stock
    if (body.qty !== undefined || body.stock !== undefined) {
      const qty = parseInt(body.qty !== undefined ? body.qty : body.stock, 10)
      if (isNaN(qty) || qty < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_quantity', message: 'Quantity cannot be negative.' },
        })
      }
      product.qty = qty
    }

    // Weight
    if (body.weight !== undefined) product.weight = String(body.weight).trim()

    // Images
    if (body.image !== undefined) product.image = String(body.image).trim()
    if (Array.isArray(body.gallery)) product.gallery = body.gallery.filter(Boolean)

    // Ingredients
    if (body.ingredients !== undefined) {
      product.ingredients = Array.isArray(body.ingredients)
        ? body.ingredients.map((i) => String(i).trim()).filter(Boolean)
        : String(body.ingredients)
            .split(/[\n,]/)
            .map((i) => i.trim())
            .filter(Boolean)
    }

    // Specifications / Details
    if (Array.isArray(body.specifications)) {
      product.specifications = body.specifications
    } else if (typeof body.details === 'string') {
      product.specifications = body.details
        .split('\n')
        .map((line) => {
          const parts = line.split(':')
          if (parts.length >= 2) {
            return { label: parts[0].trim(), value: parts.slice(1).join(':').trim() }
          }
          return null
        })
        .filter(Boolean)
    }

    // Active status
    if (body.active !== undefined) product.isActive = Boolean(body.active)
    if (body.isActive !== undefined) product.isActive = Boolean(body.isActive)

    // Featured
    if (body.isFeatured !== undefined) product.isFeatured = Boolean(body.isFeatured)

    // Variants handling
    if (Array.isArray(body.variants) && body.variants.length > 0) {
      const seenVariantIds = new Set()
      const seenSkus = new Set()
      const parsedVariants = []
      for (const v of body.variants) {
        const vId = String(v.variantId || v.id || '').trim()
        const vSku = String(v.sku || '').trim()
        const vPrice = Number(v.price)
        const vQty = Math.max(0, parseInt(v.qty ?? v.stock, 10) || 0)
        if (!vId || seenVariantIds.has(vId)) {
          return res.status(400).json({
            success: false,
            error: { code: 'invalid_variant', message: 'Each variant must have a unique variantId.' },
          })
        }
        if (!vSku || seenSkus.has(vSku)) {
          return res.status(400).json({
            success: false,
            error: { code: 'invalid_variant_sku', message: 'Each variant must have a unique SKU.' },
          })
        }
        if (isNaN(vPrice) || vPrice <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'invalid_variant_price', message: 'Variant price must be greater than 0.' },
          })
        }
        seenVariantIds.add(vId)
        seenSkus.add(vSku)
        parsedVariants.push({
          variantId: vId,
          label: String(v.label || v.weight || 'Standard').trim(),
          weight: String(v.weight || 'Standard').trim(),
          sku: vSku,
          price: vPrice,
          originalPrice: v.originalPrice ? Number(v.originalPrice) : null,
          discount: v.discount ? Number(v.discount) : null,
          qty: vQty,
          isActive: v.isActive !== false,
        })
      }
      product.variants = parsedVariants
    } else if (product.variants && product.variants.length === 1) {
      // Sync single variant with base fields if updated
      const v = product.variants[0]
      if (body.price !== undefined) v.price = product.price
      if (body.qty !== undefined || body.stock !== undefined) v.qty = product.qty
      if (body.sku !== undefined) v.sku = product.sku
      if (body.weight !== undefined) {
        v.weight = product.weight
        v.label = product.weight
      }
    }

    await product.save()

    res.json({
      success: true,
      data: formatAdminProduct(product),
    })
  } catch (err) {
    next(err)
  }
}

// 5. Delete product (Safe deactivation)
export async function deleteAdminProduct(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const product = await Product.findOne(query)
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'product_not_found', message: 'Product not found.' },
      })
    }

    // Deactivate safely rather than physically deleting
    product.isActive = false
    await product.save()

    res.json({
      success: true,
      message: 'Product deactivated successfully.',
      data: formatAdminProduct(product),
    })
  } catch (err) {
    next(err)
  }
}

// 6. Update inventory (PATCH /api/admin/products/:id/inventory)
export async function updateAdminProductInventory(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const product = await Product.findOne(query)
    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'product_not_found', message: 'Product not found.' },
      })
    }

    const rawStock = req.body.stock !== undefined ? req.body.stock : req.body.qty
    const stock = Number(rawStock)
    if (isNaN(stock) || !Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_stock', message: 'Stock quantity must be a non-negative integer.' },
      })
    }

    const variantId = req.body.variantId ? String(req.body.variantId).trim() : null
    if (variantId) {
      const variant = product.variants.find((v) => v.variantId === variantId)
      if (!variant) {
        return res.status(404).json({
          success: false,
          error: { code: 'variant_not_found', message: `Variant "${variantId}" not found in product.` },
        })
      }
      variant.qty = stock
      // Recompute total active variant stock
      product.qty = product.variants.reduce((sum, v) => sum + (v.isActive !== false ? v.qty : 0), 0)
    } else {
      product.qty = stock
      if (product.variants && product.variants.length > 0) {
        // If single variant, sync directly
        if (product.variants.length === 1) {
          product.variants[0].qty = stock
        } else {
          // Adjust primary (first) variant
          product.variants[0].qty = stock
        }
      }
    }

    await product.save()

    res.json({
      success: true,
      data: formatAdminProduct(product),
    })
  } catch (err) {
    next(err)
  }
}

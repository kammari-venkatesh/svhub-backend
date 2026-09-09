import mongoose from 'mongoose'
import { Product } from '../models/Product.js'

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatPublicProduct(p) {
  const activeVariants = (p.variants || [])
    .filter((v) => v.isActive !== false)
    .map((v) => ({
      id: v.variantId,
      variantId: v.variantId,
      label: v.label,
      weight: v.weight,
      sku: v.sku,
      price: v.price,
      originalPrice: v.originalPrice || null,
      discount: v.discount || null,
      stock: v.qty > 0 ? (v.qty <= 10 ? 'low-stock' : 'in-stock') : 'out-of-stock',
      inStock: v.qty > 0,
      isActive: true,
    }))

  return {
    id: String(p._id),
    slug: p.slug,
    name: p.name,
    type: p.type,
    category: p.category,
    storefront: p.storefront,
    description: p.description,
    ingredients: p.ingredients || [],
    specifications: p.specifications || [],
    information: p.specifications || [],
    image: p.image,
    gallery: p.gallery || [],
    price: p.price,
    originalPrice: p.originalPrice || null,
    discount: p.discount || null,
    weight: p.weight,
    sku: p.sku,
    stock: p.qty > 0 ? (p.qty <= 10 ? 'low-stock' : 'in-stock') : 'out-of-stock',
    inStock: p.qty > 0,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    variants: activeVariants,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

// 1. List products with filtering, search, sorting, and safe pagination
export async function getProducts(req, res, next) {
  try {
    const filter = { isActive: true }

    // Category filter
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : (typeof req.query.cat === 'string' ? req.query.cat.trim() : '')
    if (category && category !== 'all') {
      filter.category = category
    }

    // Storefront house filter
    const storefront = typeof req.query.storefront === 'string' ? req.query.storefront.trim() : (typeof req.query.house === 'string' ? req.query.house.trim() : '')
    if (storefront && storefront !== 'all') {
      filter.storefront = storefront
    }

    // Featured filter
    if (req.query.featured === 'true' || req.query.featured === true) {
      filter.isFeatured = true
    }

    // Price range filters
    const minVal = parseFloat(req.query.min || req.query.minPrice)
    const maxVal = parseFloat(req.query.max || req.query.maxPrice)
    if (!Number.isNaN(minVal) || !Number.isNaN(maxVal)) {
      filter.price = {}
      if (!Number.isNaN(minVal)) filter.price.$gte = minVal
      if (!Number.isNaN(maxVal)) filter.price.$lte = maxVal
    }

    // Search keyword query
    const searchQuery = typeof req.query.search === 'string' ? req.query.search.trim() : (typeof req.query.q === 'string' ? req.query.q.trim() : '')
    if (searchQuery) {
      const safePattern = escapeRegex(searchQuery)
      const regex = new RegExp(safePattern, 'i')
      filter.$or = [
        { name: regex },
        { type: regex },
        { description: regex },
        { category: regex },
      ]
    }

    // Sorting
    const sortParam = typeof req.query.sort === 'string' ? req.query.sort.trim() : ''
    let sort = { isFeatured: -1, createdAt: -1 }
    if (sortParam === 'price-asc' || sortParam === 'price_asc' || sortParam === 'low-to-high') {
      sort = { price: 1 }
    } else if (sortParam === 'price-desc' || sortParam === 'price_desc' || sortParam === 'high-to-low') {
      sort = { price: -1 }
    } else if (sortParam === 'newest') {
      sort = { createdAt: -1 }
    } else if (sortParam === 'name-asc') {
      sort = { name: 1 }
    } else if (sortParam === 'name-desc') {
      sort = { name: -1 }
    } else if (sortParam === 'featured') {
      sort = { isFeatured: -1, createdAt: -1 }
    }

    // Pagination bounds
    const rawPage = parseInt(req.query.page, 10)
    const rawLimit = parseInt(req.query.limit, 10)
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : 20
    const skip = (page - 1) * limit

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ])

    res.json({
      success: true,
      data: products.map(formatPublicProduct),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    })
  } catch (err) {
    next(err)
  }
}

// 2. Featured products shortcut
export async function getFeaturedProducts(req, res, next) {
  try {
    const rawLimit = parseInt(req.query.limit, 10)
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(20, rawLimit) : 8

    const products = await Product.find({ isFeatured: true, isActive: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    res.json({
      success: true,
      data: products.map(formatPublicProduct),
    })
  } catch (err) {
    next(err)
  }
}

// 3. Product detail by ID or slug
export async function getProductByIdOrSlug(req, res, next) {
  try {
    const identifier = String(req.params.id || req.params.slug || '').trim()

    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    query.isActive = true

    const product = await Product.findOne(query).lean()

    if (!product) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'product_not_found',
          message: 'Product not found or is no longer available.',
        },
      })
    }

    res.json({
      success: true,
      data: formatPublicProduct(product),
    })
  } catch (err) {
    next(err)
  }
}

// 4. Related products for PDP
export async function getRelatedProducts(req, res, next) {
  try {
    const identifier = String(req.params.id || req.params.slug || '').trim()

    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    query.isActive = true

    const product = await Product.findOne(query).lean()
    if (!product) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'product_not_found',
          message: 'Product not found.',
        },
      })
    }

    const rawLimit = parseInt(req.query.limit, 10)
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(12, rawLimit) : 4

    // Find in same category first
    let related = await Product.find({
      category: product.category,
      _id: { $ne: product._id },
      isActive: true,
    })
      .limit(limit)
      .lean()

    // If fewer than requested limit, backfill with same storefront house
    if (related.length < limit) {
      const existingIds = [product._id, ...related.map((r) => r._id)]
      const additional = await Product.find({
        storefront: product.storefront,
        _id: { $nin: existingIds },
        isActive: true,
      })
        .limit(limit - related.length)
        .lean()

      related = [...related, ...additional]
    }

    res.json({
      success: true,
      data: related.map(formatPublicProduct),
    })
  } catch (err) {
    next(err)
  }
}

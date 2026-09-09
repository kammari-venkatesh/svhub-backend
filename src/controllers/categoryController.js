import mongoose from 'mongoose'
import { Category } from '../models/Category.js'
import { Product } from '../models/Product.js'

export function formatPublicCategory(cat, count = 0) {
  return {
    id: String(cat._id),
    slug: cat.slug,
    name: cat.name,
    storefront: cat.storefront,
    description: cat.description || '',
    image: cat.image || null,
    active: Boolean(cat.active),
    isActive: Boolean(cat.active),
    sortOrder: cat.sortOrder || 0,
    count: typeof cat.count === 'number' ? cat.count : count,
    to: `/category/${cat.slug}`,
    createdAt: cat.createdAt,
    updatedAt: cat.updatedAt,
  }
}

// 1. List active categories
export async function getCategories(req, res, next) {
  try {
    const filter = { active: true }

    const storefront = typeof req.query.storefront === 'string' ? req.query.storefront.trim() : (typeof req.query.house === 'string' ? req.query.house.trim() : '')
    if (storefront && storefront !== 'all') {
      filter.storefront = storefront
    }

    const categories = await Category.find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .lean()

    // Calculate active product count per category
    const counts = await Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ])
    const countMap = new Map(counts.map((c) => [c._id, c.count]))

    res.json({
      success: true,
      data: categories.map((cat) => formatPublicCategory({ ...cat, count: countMap.get(cat.slug) || 0 })),
    })
  } catch (err) {
    next(err)
  }
}

// 2. Get category detail by ID or slug
export async function getCategoryByIdOrSlug(req, res, next) {
  try {
    const identifier = String(req.params.id || req.params.slug || '').trim()

    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    query.active = true

    const category = await Category.findOne(query).lean()

    if (!category) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'category_not_found',
          message: 'Category not found or is inactive.',
        },
      })
    }

    const count = await Product.countDocuments({ category: category.slug, isActive: true })

    res.json({
      success: true,
      data: formatPublicCategory({ ...category, count }),
    })
  } catch (err) {
    next(err)
  }
}

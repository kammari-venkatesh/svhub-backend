import mongoose from 'mongoose'
import { Category } from '../models/Category.js'
import { Product } from '../models/Product.js'

export function formatAdminCategory(cat, count = 0) {
  return {
    id: String(cat._id),
    _id: String(cat._id),
    name: cat.name,
    slug: cat.slug,
    storefront: cat.storefront,
    description: cat.description || '',
    image: cat.image || null,
    active: Boolean(cat.active),
    isActive: Boolean(cat.active),
    sortOrder: cat.sortOrder || 0,
    count: typeof cat.count === 'number' ? cat.count : count,
    createdAt: cat.createdAt,
    updatedAt: cat.updatedAt,
  }
}

// 1. List all categories (active and inactive) for admin
export async function getAdminCategories(req, res, next) {
  try {
    const filter = {}

    const storefront =
      typeof req.query.storefront === 'string'
        ? req.query.storefront.trim()
        : typeof req.query.house === 'string'
          ? req.query.house.trim()
          : ''
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
      data: categories.map((cat) => formatAdminCategory({ ...cat, count: countMap.get(cat.slug) || 0 })),
    })
  } catch (err) {
    next(err)
  }
}

// 2. Get category by ID or slug
export async function getAdminCategoryById(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const category = await Category.findOne(query).lean()
    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: 'category_not_found', message: 'Category not found.' },
      })
    }

    const count = await Product.countDocuments({ category: category.slug, isActive: true })

    res.json({
      success: true,
      data: formatAdminCategory({ ...category, count }),
    })
  } catch (err) {
    next(err)
  }
}

// 3. Create category
export async function createAdminCategory(req, res, next) {
  try {
    const body = req.body || {}
    const name = String(body.name || '').trim()
    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_category_name', message: 'Category name is required.' },
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
        error: { code: 'invalid_slug', message: 'A valid category slug is required.' },
      })
    }

    const existingSlug = await Category.findOne({ slug })
    if (existingSlug) {
      return res.status(400).json({
        success: false,
        error: { code: 'duplicate_slug', message: `Category slug "${slug}" is already in use.` },
      })
    }

    const storefront = String(body.storefront || 'nutri-hub').trim()
    if (storefront !== 'nutri-hub' && storefront !== 'self-care') {
      return res.status(400).json({
        success: false,
        error: { code: 'invalid_storefront', message: 'Storefront must be nutri-hub or self-care.' },
      })
    }

    const category = await Category.create({
      name,
      slug,
      storefront,
      description: String(body.description || '').trim(),
      image: body.image ? String(body.image).trim() : null,
      active: body.active !== false && body.isActive !== false,
      sortOrder: Number(body.sortOrder) || 0,
    })

    res.status(201).json({
      success: true,
      data: formatAdminCategory(category, 0),
    })
  } catch (err) {
    next(err)
  }
}

// 4. Update category
export async function updateAdminCategory(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const category = await Category.findOne(query)
    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: 'category_not_found', message: 'Category not found.' },
      })
    }

    const body = req.body || {}

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_category_name', message: 'Category name cannot be empty.' },
        })
      }
      category.name = name
    }

    const oldSlug = category.slug
    if (body.slug !== undefined) {
      const slug = String(body.slug)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      if (!slug) {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_slug', message: 'A valid category slug is required.' },
        })
      }
      if (slug !== oldSlug) {
        const existing = await Category.findOne({ slug, _id: { $ne: category._id } })
        if (existing) {
          return res.status(400).json({
            success: false,
            error: { code: 'duplicate_slug', message: `Category slug "${slug}" is already in use.` },
          })
        }
        category.slug = slug
        // Sync any products using old category slug
        await Product.updateMany({ category: oldSlug }, { $set: { category: slug } })
      }
    }

    if (body.storefront !== undefined) {
      const storefront = String(body.storefront).trim()
      if (storefront !== 'nutri-hub' && storefront !== 'self-care') {
        return res.status(400).json({
          success: false,
          error: { code: 'invalid_storefront', message: 'Storefront must be nutri-hub or self-care.' },
        })
      }
      category.storefront = storefront
    }

    if (body.description !== undefined) category.description = String(body.description).trim()
    if (body.image !== undefined) category.image = body.image ? String(body.image).trim() : null
    if (body.active !== undefined) category.active = Boolean(body.active)
    if (body.isActive !== undefined) category.active = Boolean(body.isActive)
    if (body.sortOrder !== undefined) category.sortOrder = Number(body.sortOrder) || 0

    await category.save()

    const count = await Product.countDocuments({ category: category.slug, isActive: true })

    res.json({
      success: true,
      data: formatAdminCategory(category, count),
    })
  } catch (err) {
    next(err)
  }
}

// 5. Delete / Deactivate category (Safety Check)
export async function deleteAdminCategory(req, res, next) {
  try {
    const identifier = String(req.params.id || '').trim()
    let query
    if (mongoose.isValidObjectId(identifier)) {
      query = { $or: [{ _id: identifier }, { slug: identifier.toLowerCase() }] }
    } else {
      query = { slug: identifier.toLowerCase() }
    }

    const category = await Category.findOne(query)
    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: 'category_not_found', message: 'Category not found.' },
      })
    }

    // Safety check: Prevent deletion if active products exist in category
    const activeProductsCount = await Product.countDocuments({ category: category.slug, isActive: true })
    if (activeProductsCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'cannot_delete_category_with_products',
          message: `Cannot delete category "${category.name}" because it contains ${activeProductsCount} active product(s). Reassign or deactivate those products first.`,
        },
      })
    }

    // Safely deactivate
    category.active = false
    await category.save()

    res.json({
      success: true,
      message: 'Category deactivated successfully.',
      data: formatAdminCategory(category, 0),
    })
  } catch (err) {
    next(err)
  }
}

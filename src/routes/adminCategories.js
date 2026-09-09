import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getAdminCategories,
  getAdminCategoryById,
  createAdminCategory,
  updateAdminCategory,
  deleteAdminCategory,
} from '../controllers/adminCategoryController.js'

const adminCategoriesRouter = Router()

// All admin category endpoints require valid JWT authentication and ADMIN role
adminCategoriesRouter.use(requireAuth, requireAdmin)

// GET /api/admin/categories - List all categories (active & inactive)
adminCategoriesRouter.get('/', getAdminCategories)

// POST /api/admin/categories - Create a new category
adminCategoriesRouter.post('/', createAdminCategory)

// GET /api/admin/categories/:id - Get category details by ID or slug
adminCategoriesRouter.get('/:id', getAdminCategoryById)

// PUT /api/admin/categories/:id - Update category details
adminCategoriesRouter.put('/:id', updateAdminCategory)

// DELETE /api/admin/categories/:id - Safe deactivation or deletion with product dependency check
adminCategoriesRouter.delete('/:id', deleteAdminCategory)

export { adminCategoriesRouter }

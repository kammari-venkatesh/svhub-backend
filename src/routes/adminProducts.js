import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  getAdminProducts,
  getAdminProductById,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  updateAdminProductInventory,
} from '../controllers/adminProductController.js'
import { adminMutationRateLimiter } from '../middleware/rateLimiter.js'

const adminProductsRouter = Router()

// All admin product endpoints require valid JWT authentication and ADMIN role
adminProductsRouter.use(requireAuth, requireAdmin)

// GET /api/admin/products - List products with filtering, search, pagination, sorting
adminProductsRouter.get('/', getAdminProducts)

// POST /api/admin/products - Create a new product
adminProductsRouter.post('/', adminMutationRateLimiter, createAdminProduct)

// GET /api/admin/products/:id - Get product details by ID or slug
adminProductsRouter.get('/:id', getAdminProductById)

// PUT & PATCH /api/admin/products/:id - Update product details
adminProductsRouter.put('/:id', adminMutationRateLimiter, updateAdminProduct)
adminProductsRouter.patch('/:id', adminMutationRateLimiter, updateAdminProduct)

// DELETE /api/admin/products/:id - Safe deactivation (isActive: false)
adminProductsRouter.delete('/:id', adminMutationRateLimiter, deleteAdminProduct)

// PATCH /api/admin/products/:id/inventory - Update variant or product stock quantity
adminProductsRouter.patch('/:id/inventory', adminMutationRateLimiter, updateAdminProductInventory)

export { adminProductsRouter }

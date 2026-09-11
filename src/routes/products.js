import { Router } from 'express'
import {
  getProducts,
  getFeaturedProducts,
  getProductByIdOrSlug,
  getRelatedProducts,
} from '../controllers/productController.js'
import { publicCatalogRateLimiter } from '../middleware/rateLimiter.js'

const productsRouter = Router()

// Apply public catalog rate limiting
productsRouter.use(publicCatalogRateLimiter)

// Public Catalog Endpoints
productsRouter.get('/', getProducts)
productsRouter.get('/featured', getFeaturedProducts)
productsRouter.get('/:id', getProductByIdOrSlug)
productsRouter.get('/:id/related', getRelatedProducts)

export { productsRouter }

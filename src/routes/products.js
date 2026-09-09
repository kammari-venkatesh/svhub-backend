import { Router } from 'express'
import {
  getProducts,
  getFeaturedProducts,
  getProductByIdOrSlug,
  getRelatedProducts,
} from '../controllers/productController.js'

const productsRouter = Router()

// Public Catalog Endpoints
productsRouter.get('/', getProducts)
productsRouter.get('/featured', getFeaturedProducts)
productsRouter.get('/:id', getProductByIdOrSlug)
productsRouter.get('/:id/related', getRelatedProducts)

export { productsRouter }

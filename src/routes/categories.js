import { Router } from 'express'
import {
  getCategories,
  getCategoryByIdOrSlug,
} from '../controllers/categoryController.js'

const categoriesRouter = Router()

// Public Category Endpoints
categoriesRouter.get('/', getCategories)
categoriesRouter.get('/:id', getCategoryByIdOrSlug)

export { categoriesRouter }

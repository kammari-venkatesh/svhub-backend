import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { getRefundDetails } from '../controllers/refundController.js'

const refundsRouter = Router()

refundsRouter.use(requireAuth)
refundsRouter.get('/:id', getRefundDetails)

export { refundsRouter }

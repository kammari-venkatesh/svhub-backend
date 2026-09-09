import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '../controllers/addressController.js'

const addressesRouter = Router()

// All Address routes require authenticated customer session
addressesRouter.use(requireAuth)

addressesRouter.get('/', getAddresses)
addressesRouter.post('/', createAddress)
addressesRouter.patch('/:id', updateAddress)
addressesRouter.put('/:id', updateAddress)
addressesRouter.delete('/:id', deleteAddress)
addressesRouter.patch('/:id/default', setDefaultAddress)

export { addressesRouter }

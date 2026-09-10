import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { authRouter } from './auth.js'
import { healthRouter } from './health.js'
import { productsRouter } from './products.js'
import { categoriesRouter } from './categories.js'
import { settingsRouter } from './settings.js'
import { cartRouter } from './cart.js'
import { addressesRouter } from './addresses.js'
import { ordersRouter } from './orders.js'
import { paymentsRouter } from './payments.js'
import { adminOrdersRouter } from './adminOrders.js'
import { adminProductsRouter } from './adminProducts.js'
import { adminCategoriesRouter } from './adminCategories.js'
import { adminCustomersRouter } from './adminCustomers.js'
import { adminDashboardRouter } from './adminDashboard.js'
import { adminSettingsRouter } from './adminSettings.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { User } from '../models/User.js'
import { fail } from '../utils/auth.js'

const apiRouter = Router()

// Core Phase 1.1 Foundation Routes
apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)

// Phase 1.3 Public Catalog Routes
apiRouter.use('/products', productsRouter)
apiRouter.use('/categories', categoriesRouter)
apiRouter.use('/settings', settingsRouter)

// Phase 1.4 Customer Commerce Routes (Cart & Address)
apiRouter.use('/cart', cartRouter)
apiRouter.use('/addresses', addressesRouter)

// Phase 1.5 Order Creation Route
apiRouter.use('/orders', ordersRouter)

// Phase 2.1 Razorpay Payment Routes
apiRouter.use('/payments', paymentsRouter)

// Phase 1.6A Admin Order Management Route
apiRouter.use('/admin/orders', adminOrdersRouter)

// Phase 1.8 Admin Catalog & Category Management Routes
apiRouter.use('/admin/products', adminProductsRouter)
apiRouter.use('/admin/categories', adminCategoriesRouter)

// Phase 1.9 Admin Customers, Dashboard & Settings Routes
apiRouter.use('/admin/customers', adminCustomersRouter)
apiRouter.use('/admin/dashboard', adminDashboardRouter)
apiRouter.use('/admin/settings', adminSettingsRouter)

// Lightweight test endpoints specifically for verifying Cases 1-7 authorization rules
apiRouter.get('/test/protected', requireAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Authenticated customer access granted.',
    user: req.user.toPublic(),
  })
})

apiRouter.get('/test/admin-only', requireAuth, requireAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Authenticated admin access granted.',
    user: req.user.toPublic(),
  })
})

apiRouter.get('/test/users/:userId/resource', requireAuth, (req, res) => {
  // Case 7: User A attempting to access User B's resource
  if (String(req.user._id) !== String(req.params.userId)) {
    return fail(res, 403, 'forbidden_resource', 'Access denied. You cannot access another user’s resource.')
  }
  res.json({
    success: true,
    message: 'Resource accessed successfully by owner.',
    ownerId: req.params.userId,
  })
})

// Dev/Test helper to securely provision a test admin in development/test mode
apiRouter.post('/test/create-admin', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Disabled in production' })
  }
  const { email, password, name } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()

  let user = await User.findOne({ email: normalizedEmail })
  if (user) {
    user.role = 'ADMIN'
    await user.save()
  } else {
    user = await User.create({
      name: name || 'Admin Test',
      email: normalizedEmail,
      phone: '9876543200',
      passwordHash: await bcrypt.hash(password || 'Admin@123', 12),
      role: 'ADMIN',
      status: 'ACTIVE',
      provider: 'PASSWORD',
    })
  }

  res.json({ success: true, user: user.toPublic() })
})

// Dev/Test cleanup endpoint
apiRouter.delete('/test/cleanup-user', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Disabled in production' })
  }
  const { email } = req.body || {}
  if (email) {
    await User.deleteMany({ email: String(email).trim().toLowerCase() })
  }
  res.json({ success: true, message: 'Cleaned up' })
})

export { apiRouter }

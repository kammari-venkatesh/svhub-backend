import { Settings } from '../models/Settings.js'

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * GET /api/admin/settings
 * Retrieves full administrative store settings
 */
export async function getAdminSettings(req, res, next) {
  try {
    const settings = await Settings.getSettings()

    res.json({
      success: true,
      data: {
        supportEmail: settings.supportEmail || 'care@svhub.in',
        supportPhone: settings.supportPhone || '+91 98765 43210',
        standardShippingFee: settings.standardShippingFee ?? 40,
        standardShipping: settings.standardShippingFee ?? 40,
        expressShippingFee: settings.expressShippingFee ?? 120,
        freeShippingThreshold: settings.freeShippingThreshold ?? 499,
        freeShippingFrom: settings.freeShippingThreshold ?? 499,
        lowStockThreshold: settings.lowStockThreshold ?? 10,
        lowStockAlert: settings.lowStockThreshold ?? 10,
        currency: settings.currency || 'INR',
        updatedAt: settings.updatedAt,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * PATCH /api/admin/settings
 * Updates operational store settings with strict validation
 */
export async function updateAdminSettings(req, res, next) {
  try {
    const settings = await Settings.getSettings()
    const body = req.body || {}

    const {
      supportEmail,
      supportPhone,
      standardShippingFee,
      standardShipping,
      expressShippingFee,
      freeShippingThreshold,
      freeShippingFrom,
      lowStockThreshold,
      lowStockAlert,
      currency,
    } = body

    // Validate email
    if (supportEmail !== undefined) {
      if (!isValidEmail(supportEmail)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_email',
          message: 'Please provide a valid support email address',
        })
      }
      settings.supportEmail = supportEmail.trim().toLowerCase()
    }

    // Validate phone
    if (supportPhone !== undefined) {
      const trimmedPhone = String(supportPhone).trim()
      if (!trimmedPhone) {
        return res.status(400).json({
          success: false,
          code: 'invalid_phone',
          message: 'Support phone number cannot be empty',
        })
      }
      settings.supportPhone = trimmedPhone
    }

    // Validate standard shipping
    const targetStandardShipping = standardShippingFee !== undefined ? standardShippingFee : standardShipping
    if (targetStandardShipping !== undefined) {
      const val = Number(targetStandardShipping)
      if (Number.isNaN(val) || val < 0) {
        return res.status(400).json({
          success: false,
          code: 'invalid_shipping_fee',
          message: 'Standard shipping fee must be a non-negative number',
        })
      }
      settings.standardShippingFee = val
    }

    // Validate express shipping
    if (expressShippingFee !== undefined) {
      const val = Number(expressShippingFee)
      if (Number.isNaN(val) || val < 0) {
        return res.status(400).json({
          success: false,
          code: 'invalid_express_fee',
          message: 'Express shipping fee must be a non-negative number',
        })
      }
      settings.expressShippingFee = val
    }

    // Validate free shipping threshold
    const targetFreeShipping = freeShippingThreshold !== undefined ? freeShippingThreshold : freeShippingFrom
    if (targetFreeShipping !== undefined) {
      const val = Number(targetFreeShipping)
      if (Number.isNaN(val) || val < 0) {
        return res.status(400).json({
          success: false,
          code: 'invalid_free_shipping_threshold',
          message: 'Free shipping threshold must be a non-negative number',
        })
      }
      settings.freeShippingThreshold = val
    }

    // Validate low stock threshold
    const targetLowStock = lowStockThreshold !== undefined ? lowStockThreshold : lowStockAlert
    if (targetLowStock !== undefined) {
      const val = Number(targetLowStock)
      if (Number.isNaN(val) || val < 0) {
        return res.status(400).json({
          success: false,
          code: 'invalid_low_stock_threshold',
          message: 'Low stock threshold must be a non-negative number',
        })
      }
      settings.lowStockThreshold = val
    }

    // Validate currency
    if (currency !== undefined) {
      const trimmedCurr = String(currency).trim().toUpperCase()
      if (!trimmedCurr || trimmedCurr.length > 5) {
        return res.status(400).json({
          success: false,
          code: 'invalid_currency',
          message: 'Currency code is invalid',
        })
      }
      settings.currency = trimmedCurr
    }

    await settings.save()

    res.json({
      success: true,
      data: {
        supportEmail: settings.supportEmail,
        supportPhone: settings.supportPhone,
        standardShippingFee: settings.standardShippingFee,
        standardShipping: settings.standardShippingFee,
        expressShippingFee: settings.expressShippingFee,
        freeShippingThreshold: settings.freeShippingThreshold,
        freeShippingFrom: settings.freeShippingThreshold,
        lowStockThreshold: settings.lowStockThreshold,
        lowStockAlert: settings.lowStockThreshold,
        currency: settings.currency,
        updatedAt: settings.updatedAt,
      },
    })
  } catch (err) {
    next(err)
  }
}

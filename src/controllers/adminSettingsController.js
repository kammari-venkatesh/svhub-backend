import { Settings } from '../models/Settings.js'
import {
  normalizeHeroCampaign,
  serializeAdminHeroCampaign,
  validateHeroCampaignPatch,
} from '../utils/heroCampaign.js'

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function buildAdminPayload(settings) {
  return {
    supportEmail: settings.supportEmail || 'info@svhub.com',
    supportPhone: settings.supportPhone || '+91 93463 99677',
    standardShippingFee: settings.standardShippingFee ?? 40,
    standardShipping: settings.standardShippingFee ?? 40,
    expressShippingFee: settings.expressShippingFee ?? 120,
    freeShippingThreshold: settings.freeShippingThreshold ?? 499,
    freeShippingFrom: settings.freeShippingThreshold ?? 499,
    lowStockThreshold: settings.lowStockThreshold ?? 10,
    lowStockAlert: settings.lowStockThreshold ?? 10,
    currency: settings.currency || 'INR',
    heroCampaign: serializeAdminHeroCampaign(settings.heroCampaign),
    updatedAt: settings.updatedAt,
  }
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
      data: buildAdminPayload(settings),
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
      heroCampaign,
    } = body

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

    let heroCampaignMerged = null

    if (heroCampaign !== undefined) {
      if (!heroCampaign || typeof heroCampaign !== 'object') {
        return res.status(400).json({
          success: false,
          code: 'invalid_hero_campaign',
          message: 'Hero campaign payload must be an object.',
        })
      }

      const current = normalizeHeroCampaign(settings.heroCampaign, { seedDates: true })
      const { errors, next } = validateHeroCampaignPatch(heroCampaign)
      if (errors.length) {
        return res.status(400).json({
          success: false,
          code: 'invalid_hero_campaign',
          message: errors[0].message,
          details: errors,
        })
      }

      const merged = normalizeHeroCampaign(
        {
          ...current,
          ...next,
          startAt: next.startAt !== undefined ? next.startAt : current.startAt,
          endAt: next.endAt !== undefined ? next.endAt : current.endAt,
        },
        { seedDates: false },
      )

      if (!(merged.endAt > merged.startAt)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_hero_campaign',
          message: 'End must be after start.',
        })
      }

      heroCampaignMerged = merged
    }

    await settings.save()

    if (heroCampaignMerged) {
      const merged = heroCampaignMerged
      await Settings.updateOne(
        { _id: settings._id },
        {
          $set: {
            'heroCampaign.enabled': merged.enabled,
            'heroCampaign.label': merged.label,
            'heroCampaign.title': merged.title,
            'heroCampaign.subtitle': merged.subtitle,
            'heroCampaign.discountPercent': merged.discountPercent,
            'heroCampaign.urgencyLabel': merged.urgencyLabel,
            'heroCampaign.ctaLabel': merged.ctaLabel,
            'heroCampaign.ctaTo': merged.ctaTo,
            'heroCampaign.imageUrl': merged.imageUrl,
            'heroCampaign.imageAlt': merged.imageAlt,
            'heroCampaign.startAt': merged.startAt,
            'heroCampaign.endAt': merged.endAt,
          },
        },
      )
    }

    const saved = await Settings.findById(settings._id)
    res.json({
      success: true,
      data: buildAdminPayload(saved),
    })
  } catch (err) {
    next(err)
  }
}

import { Settings } from '../models/Settings.js'
import { serializePublicHero } from '../utils/heroCampaign.js'

// Get safe public store operational settings + resolved homepage hero
export async function getPublicSettings(req, res, next) {
  try {
    const settings = await Settings.getSettings()
    const hero = serializePublicHero(settings.heroCampaign)

    const publicConfig = {
      currency: settings.currency || 'INR',
      standardShippingFee: settings.standardShippingFee ?? 40,
      expressShippingFee: settings.expressShippingFee ?? 120,
      freeShippingThreshold: settings.freeShippingThreshold ?? 499,
      supportEmail: settings.supportEmail || 'info@svhub.com',
      supportPhone: settings.supportPhone || '+91 93463 99677',
      hero,
    }

    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    res.json({
      success: true,
      data: publicConfig,
    })
  } catch (err) {
    next(err)
  }
}

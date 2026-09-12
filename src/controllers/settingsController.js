import { Settings } from '../models/Settings.js'
import { serializePublicHero } from '../utils/heroCampaign.js'

// Get safe public store operational settings + resolved homepage hero
export async function getPublicSettings(req, res, next) {
  try {
    // Prefer lean plain objects so heroCampaign.enabled is never lost to subdoc spreads.
    let settings = await Settings.findOne({ key: 'store_settings' }).lean()
    if (!settings) {
      const created = await Settings.getSettings()
      settings = created.toObject()
    }

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

    // Hero mode must flip immediately after admin toggle — do not CDN-cache.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.set('Pragma', 'no-cache')
    res.json({
      success: true,
      data: publicConfig,
    })
  } catch (err) {
    next(err)
  }
}

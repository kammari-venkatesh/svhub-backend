import mongoose from 'mongoose'
import { DEFAULT_HERO_CAMPAIGN, defaultCampaignWindow } from '../utils/heroCampaign.js'

const heroCampaignSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    label: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.label },
    title: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.title },
    subtitle: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.subtitle },
    discountPercent: {
      type: Number,
      default: DEFAULT_HERO_CAMPAIGN.discountPercent,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100'],
    },
    urgencyLabel: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.urgencyLabel },
    ctaLabel: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.ctaLabel },
    ctaTo: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.ctaTo },
    imageUrl: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.imageUrl },
    imageAlt: { type: String, trim: true, default: DEFAULT_HERO_CAMPAIGN.imageAlt },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
  },
  { _id: false },
)

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'store_settings',
      index: true,
      trim: true,
    },
    supportEmail: {
      type: String,
      required: [true, 'Support email is required'],
      default: 'info@svhub.com',
      trim: true,
      lowercase: true,
    },
    supportPhone: {
      type: String,
      required: [true, 'Support phone is required'],
      default: '+91 93463 99677',
      trim: true,
    },
    standardShippingFee: {
      type: Number,
      required: [true, 'Standard shipping fee is required'],
      default: 40,
      min: [0, 'Standard shipping fee cannot be negative'],
    },
    expressShippingFee: {
      type: Number,
      required: [true, 'Express shipping fee is required'],
      default: 120,
      min: [0, 'Express shipping fee cannot be negative'],
    },
    freeShippingThreshold: {
      type: Number,
      required: [true, 'Free shipping threshold is required'],
      default: 499,
      min: [0, 'Free shipping threshold cannot be negative'],
    },
    lowStockThreshold: {
      type: Number,
      required: [true, 'Low stock threshold is required'],
      default: 10,
      min: [0, 'Low stock threshold cannot be negative'],
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      default: 'INR',
      uppercase: true,
      trim: true,
    },
    heroCampaign: {
      type: heroCampaignSchema,
      default: () => {
        const { startAt, endAt } = defaultCampaignWindow()
        return {
          ...DEFAULT_HERO_CAMPAIGN,
          startAt,
          endAt,
        }
      },
    },
  },
  {
    timestamps: true,
  },
)

settingsSchema.statics.getSettings = async function getSettings() {
  let settings = await this.findOne({ key: 'store_settings' })
  if (!settings) {
    const { startAt, endAt } = defaultCampaignWindow()
    settings = await this.create({
      key: 'store_settings',
      heroCampaign: {
        ...DEFAULT_HERO_CAMPAIGN,
        startAt,
        endAt,
      },
    })
    return settings
  }

  // Migrate existing store settings that predate heroCampaign
  if (!settings.heroCampaign || !settings.heroCampaign.startAt || !settings.heroCampaign.endAt) {
    const { startAt, endAt } = defaultCampaignWindow()
    settings.heroCampaign = {
      ...DEFAULT_HERO_CAMPAIGN,
      ...(settings.heroCampaign?.toObject?.() || settings.heroCampaign || {}),
      startAt: settings.heroCampaign?.startAt || startAt,
      endAt: settings.heroCampaign?.endAt || endAt,
    }
    await settings.save()
  } else {
    const imageUrl = String(settings.heroCampaign.imageUrl || '')
    const title = String(settings.heroCampaign.title || '')
    const needsArtMigration =
      imageUrl.includes('photo-1567593810070-7a3d471af022') ||
      imageUrl.includes('ganesh-courtyard-hero') ||
      imageUrl.includes('ganesh-chaturthi-art.jpg') ||
      imageUrl.includes('ganesh-chaturthi-art.png')
    const needsTitleRhythm =
      title === 'Celebrate Ganesh Chaturthi,\nThe Natural Way.' ||
      title === 'Celebrate Ganesh Chaturthi, The Natural Way.'

    if (needsArtMigration || needsTitleRhythm) {
      if (needsArtMigration) {
        settings.heroCampaign.imageUrl = DEFAULT_HERO_CAMPAIGN.imageUrl
        settings.heroCampaign.imageAlt = DEFAULT_HERO_CAMPAIGN.imageAlt
        settings.heroCampaign.label = DEFAULT_HERO_CAMPAIGN.label
        settings.heroCampaign.subtitle = DEFAULT_HERO_CAMPAIGN.subtitle
      }
      if (needsArtMigration || needsTitleRhythm) {
        settings.heroCampaign.title = DEFAULT_HERO_CAMPAIGN.title
      }
      settings.markModified('heroCampaign')
      await settings.save()
    }
  }

  return settings
}

export const Settings = mongoose.model('Settings', settingsSchema)

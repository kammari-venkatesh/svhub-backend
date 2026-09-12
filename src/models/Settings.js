import mongoose from 'mongoose'

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
  },
  {
    timestamps: true,
  },
)

settingsSchema.statics.getSettings = async function getSettings() {
  let settings = await this.findOne({ key: 'store_settings' })
  if (!settings) {
    settings = await this.create({ key: 'store_settings' })
  }
  return settings
}

export const Settings = mongoose.model('Settings', settingsSchema)

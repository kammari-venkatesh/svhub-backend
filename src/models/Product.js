import mongoose from 'mongoose'

const variantSchema = new mongoose.Schema(
  {
    variantId: {
      type: String,
      required: [true, 'Variant ID is required'],
      trim: true,
    },
    label: {
      type: String,
      required: [true, 'Variant label is required'],
      trim: true,
    },
    weight: {
      type: String,
      required: [true, 'Variant weight is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'Variant SKU is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Variant price is required'],
      min: [0, 'Variant price cannot be negative'],
    },
    originalPrice: {
      type: Number,
      default: null,
      min: [0, 'Variant original price cannot be negative'],
    },
    discount: {
      type: Number,
      default: null,
      min: [0, 'Variant discount cannot be negative'],
      max: [100, 'Variant discount cannot exceed 100%'],
    },
    qty: {
      type: Number,
      required: [true, 'Variant stock is required'],
      default: 0,
      min: [0, 'Variant stock cannot be negative'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
)

const specificationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false },
)

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, 'Product slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Product type is required'],
      trim: true,
    },
    storefront: {
      type: String,
      required: [true, 'Storefront is required'],
      enum: {
        values: ['nutri-hub', 'self-care'],
        message: '{VALUE} is not a valid storefront house',
      },
      index: true,
    },
    category: {
      type: String,
      required: [true, 'Category slug is required'],
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
    },
    ingredients: {
      type: [String],
      default: [],
    },
    specifications: {
      type: [specificationSchema],
      default: [],
    },
    image: {
      type: String,
      required: [true, 'Hero image URL is required'],
      trim: true,
    },
    gallery: {
      type: [String],
      default: [],
    },
    price: {
      type: Number,
      required: [true, 'Base price is required'],
      min: [0, 'Base price cannot be negative'],
      index: true,
    },
    originalPrice: {
      type: Number,
      default: null,
      min: [0, 'Original price cannot be negative'],
    },
    discount: {
      type: Number,
      default: null,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100%'],
    },
    weight: {
      type: String,
      required: [true, 'Base weight is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'Base SKU is required'],
      unique: true,
      trim: true,
      index: true,
    },
    qty: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      default: 0,
      min: [0, 'Stock cannot be negative'],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    variants: {
      type: [variantSchema],
      validate: [
        (v) => Array.isArray(v) && v.length > 0,
        'Product must contain at least one pack variant',
      ],
    },
  },
  {
    timestamps: true,
  },
)

// Indexes
productSchema.index({ 'variants.sku': 1 })
productSchema.index({ name: 'text', description: 'text', type: 'text' })

export const Product = mongoose.model('Product', productSchema)

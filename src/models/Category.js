import mongoose from 'mongoose'

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, 'Category slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    storefront: {
      type: String,
      required: [true, 'Storefront house is required'],
      enum: {
        values: ['nutri-hub', 'self-care'],
        message: '{VALUE} is not a valid storefront house',
      },
      index: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    image: {
      type: String,
      default: null,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
)

// Virtual alias for isActive
categorySchema.virtual('isActive')
  .get(function () {
    return this.active
  })
  .set(function (val) {
    this.active = val
  })

export const Category = mongoose.model('Category', categorySchema)

import mongoose from 'mongoose'

const addressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    label: {
      type: String,
      enum: {
        values: ['Home', 'Work', 'Other'],
        message: '{VALUE} is not a valid address label',
      },
      default: 'Home',
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Recipient name is required'],
      minlength: [2, 'Recipient name must be at least 2 characters'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    street: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
    },
    pin: {
      type: String,
      required: [true, 'PIN code is required'],
      trim: true,
    },
    country: {
      type: String,
      default: 'India',
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
)

// Virtual aliases for naming flexibility
addressSchema.virtual('user')
  .get(function () {
    return this.userId
  })
  .set(function (val) {
    this.userId = val
  })

addressSchema.virtual('fullName')
  .get(function () {
    return this.name
  })
  .set(function (val) {
    this.name = val
  })

addressSchema.virtual('addressLine1')
  .get(function () {
    return this.street
  })
  .set(function (val) {
    this.street = val
  })

addressSchema.virtual('postalCode')
  .get(function () {
    return this.pin
  })
  .set(function (val) {
    this.pin = val
  })

export const Address = mongoose.model('Address', addressSchema)

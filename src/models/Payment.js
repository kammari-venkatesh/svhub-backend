import mongoose from 'mongoose'

const paymentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: [true, 'Order ID reference is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [0, 'Payment amount cannot be negative'],
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      default: 'INR',
      uppercase: true,
      trim: true,
    },
    gateway: {
      type: String,
      required: [true, 'Payment gateway is required'],
      default: 'razorpay',
      lowercase: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ['CREATED', 'PENDING', 'SUCCESS', 'PAID', 'FAILED', 'REFUNDED'],
        message: '{VALUE} is not a valid payment transaction status',
      },
      default: 'CREATED',
      index: true,
    },
    razorpayOrderId: {
      type: String,
      required: [true, 'Razorpay order ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    razorpaySignature: {
      type: String,
      default: null,
      trim: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    errorReason: {
      type: String,
      default: null,
    },
    rawWebhookPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  },
)

// Virtual aliases for provider-agnostic code
paymentSchema.virtual('provider')
  .get(function () {
    return this.gateway
  })
  .set(function (val) {
    this.gateway = val
  })

paymentSchema.virtual('providerOrderId')
  .get(function () {
    return this.razorpayOrderId
  })
  .set(function (val) {
    this.razorpayOrderId = val
  })

paymentSchema.virtual('providerPaymentId')
  .get(function () {
    return this.razorpayPaymentId
  })
  .set(function (val) {
    this.razorpayPaymentId = val
  })

paymentSchema.virtual('order')
  .get(function () {
    return this.orderId
  })
  .set(function (val) {
    this.orderId = val
  })

paymentSchema.virtual('user')
  .get(function () {
    return this.userId
  })
  .set(function (val) {
    this.userId = val
  })

export const Payment = mongoose.model('Payment', paymentSchema)

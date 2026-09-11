import mongoose from 'mongoose'

const refundSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: [true, 'Order ID reference is required'],
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: [true, 'Payment ID reference is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID reference is required'],
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      required: [true, 'Razorpay payment ID is required'],
      trim: true,
      index: true,
    },
    razorpayRefundId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Refund amount in rupees is required'],
      min: [0.01, 'Refund amount must be positive'],
    },
    amountInPaise: {
      type: Number,
      required: [true, 'Refund amount in paise is required'],
      min: [1, 'Refund amount in paise must be at least 1'],
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      default: 'INR',
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: [
          'REQUESTED',
          'CREATED',
          'PROCESSING',
          'PROCESSED',
          'FAILED',
          'REQUIRES_RECONCILIATION',
        ],
        message: '{VALUE} is not a valid refund transaction status',
      },
      default: 'REQUESTED',
      index: true,
    },
    reason: {
      type: String,
      required: [true, 'Refund reason is required'],
      trim: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Requested by user reference is required'],
    },
    requestedByRole: {
      type: String,
      required: true,
      enum: ['customer', 'admin', 'system'],
      default: 'customer',
    },
    source: {
      type: String,
      required: true,
      enum: [
        'customer_request',
        'admin_request',
        'cancellation',
        'webhook',
        'reconciliation',
      ],
      default: 'customer_request',
    },
    idempotencyKey: {
      type: String,
      required: [true, 'Idempotency key is required'],
      unique: true,
      trim: true,
      index: true,
    },
    isFullRefund: {
      type: Boolean,
      default: false,
    },
    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        variantId: {
          type: String,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
      },
    ],
    inventoryRestorationStatus: {
      type: String,
      required: true,
      enum: [
        'NOT_RESTORED',
        'RESTORED',
        'NOT_APPLICABLE',
        'REQUIRES_RECONCILIATION',
      ],
      default: 'NOT_RESTORED',
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    failureCode: {
      type: String,
      default: null,
    },
    safeFailureReason: {
      type: String,
      default: null,
    },
    reconciliationAttempts: {
      type: Number,
      default: 0,
    },
    lastReconciledAt: {
      type: Date,
      default: null,
    },
    gatewayStatus: {
      type: String,
      default: null,
    },
    rawGatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lockOwner: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
)

export const Refund = mongoose.model('Refund', refundSchema)

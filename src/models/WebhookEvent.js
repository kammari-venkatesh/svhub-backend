import mongoose from 'mongoose'

const webhookEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: [true, 'Webhook provider is required'],
      default: 'razorpay',
      trim: true,
      index: true,
    },
    eventId: {
      type: String,
      required: [true, 'Webhook event ID is required'],
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      required: [true, 'Webhook event type is required'],
      trim: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: [
          'RECEIVED',
          'PROCESSING',
          'PROCESSED',
          'FAILED_RETRYABLE',
          'FAILED_PERMANENT',
          'REQUIRES_RECONCILIATION',
          'IGNORED',
        ],
        message: '{VALUE} is not a valid webhook event status',
      },
      default: 'RECEIVED',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    razorpayOrderId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    razorpayRefundId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
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
    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    reconciliationReason: {
      type: String,
      default: null,
    },
    payloadSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  },
)

// Unique compound index: Provider + Event ID enforces database-level idempotency
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true })

export const WebhookEvent =
  mongoose.models.WebhookEvent ||
  mongoose.model('WebhookEvent', webhookEventSchema)

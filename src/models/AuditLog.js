import mongoose from 'mongoose'

/**
 * AuditLog Model (Phase 2.4G)
 *
 * Durable, append-only security and operational audit trail.
 * Captures authentication, admin mutations, payment transitions,
 * refund lifecycle, order cancellations, and security denial events.
 *
 * Invariants:
 * - Immutable: modifications and deletions are disallowed on the Mongoose model layer.
 * - Sensitive-data safe: never stores passwords, JWTs, Razorpay secrets, or raw payment cards.
 */

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: [true, 'Audit action is required'],
      trim: true,
      index: true,
    },
    actorType: {
      type: String,
      required: [true, 'Actor type is required'],
      enum: ['CUSTOMER', 'ADMIN', 'SYSTEM', 'GATEWAY', 'ANONYMOUS'],
      default: 'SYSTEM',
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },
    actorEmail: {
      type: String,
      default: null,
      trim: true,
    },
    resourceType: {
      type: String,
      required: [true, 'Resource type is required'],
      enum: ['ORDER', 'PAYMENT', 'REFUND', 'USER', 'PRODUCT', 'CATEGORY', 'SETTINGS', 'WEBHOOK', 'SYSTEM'],
      index: true,
    },
    resourceId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },
    refundId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },
    webhookEventId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    requestId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    ipAddress: {
      type: String,
      default: null,
      trim: true,
    },
    userAgent: {
      type: String,
      default: null,
      trim: true,
    },
    result: {
      type: String,
      required: true,
      enum: ['SUCCESS', 'FAILURE', 'DENIED', 'BLOCKED', 'INFO'],
      default: 'SUCCESS',
      index: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Append-only: zero updatedAt
    versionKey: false,
  },
)

// Primary Compound Indexes for query performance
auditLogSchema.index({ createdAt: -1 })
auditLogSchema.index({ action: 1, createdAt: -1 })
auditLogSchema.index({ actorId: 1, createdAt: -1 })
auditLogSchema.index({ orderId: 1, createdAt: -1 })
auditLogSchema.index({ paymentId: 1, createdAt: -1 })
auditLogSchema.index({ refundId: 1, createdAt: -1 })

// Prevent document modification & deletion (append-only enforcement)
const preventMutation = function () {
  // Allow test teardown/setup if explicitly flagged on query options
  if (this.getOptions?.()?.allowAuditPurge) {
    return
  }
  const err = new Error('AuditLog records are append-only and cannot be modified or deleted.')
  err.code = 'AUDIT_LOG_IMMUTABLE'
  throw err
}

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'token',
  'idtoken',
  'resettoken',
  'jwt',
  'secret',
  'keysecret',
  'razorpay_key_secret',
  'webhooksecret',
  'authorization',
  'cookie',
  'cvv',
  'cardnumber',
  'pan',
])

export function sanitizeMetadata(data, depth = 0) {
  if (depth > 5 || !data || typeof data !== 'object') {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeMetadata(item, depth + 1))
  }

  const clean = {}
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '')
    if (
      SENSITIVE_KEYS.has(lowerKey) ||
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('cvv') ||
      lowerKey.includes('card') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('cookie')
    ) {
      clean[key] = '[REDACTED]'
    } else if (value && typeof value === 'object') {
      clean[key] = sanitizeMetadata(value, depth + 1)
    } else {
      clean[key] = value
    }
  }
  return clean
}

// Automatically sanitize sensitive metadata on save
auditLogSchema.pre('save', function () {
  if (this.metadata && typeof this.metadata === 'object') {
    this.metadata = sanitizeMetadata(this.metadata)
    this.markModified('metadata')
  }
})

// Automatically sanitize sensitive metadata on insertMany
auditLogSchema.pre('insertMany', function (docs) {
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (doc && doc.metadata && typeof doc.metadata === 'object') {
        doc.metadata = sanitizeMetadata(doc.metadata)
      }
    }
  }
})

auditLogSchema.pre('updateOne', preventMutation)
auditLogSchema.pre('updateMany', preventMutation)
auditLogSchema.pre('findOneAndUpdate', preventMutation)
auditLogSchema.pre('replaceOne', preventMutation)
auditLogSchema.pre('deleteOne', preventMutation)
auditLogSchema.pre('deleteMany', preventMutation)
auditLogSchema.pre('findOneAndDelete', preventMutation)
auditLogSchema.pre('findOneAndReplace', preventMutation)

export const AuditLog = mongoose.model('AuditLog', auditLogSchema)

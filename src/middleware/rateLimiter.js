import { recordAuditLog } from '../services/auditLogger.js'

/**
 * Sliding Window In-Memory Rate Limiter Middleware (Phase 2.4D & Phase 2.4G)
 *
 * NOTE: This is an in-memory rate limiter designed for single-instance deployments.
 * In a distributed, multi-instance horizontal production deployment, this should be
 * backed by a distributed store such as Redis to synchronize counters across nodes.
 */

export class InMemorySlidingWindowRateLimiter {
  constructor({
    windowMs = 60 * 1000,
    max = 30,
    keyGenerator = null,
    message = null,
    category = 'API',
  }) {
    this.windowMs = windowMs
    this.max = max
    this.category = category
    this.keyGenerator =
      keyGenerator ||
      ((req) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown'
        if (req.user?._id || req.user?.id) {
          return `${this.category}:user:${req.user._id || req.user.id}:${ip}`
        }
        return `${this.category}:ip:${ip}`
      })
    this.message = message || 'Too many requests, please try again later.'
    this.hits = new Map()

    // Periodic sweep to prevent memory leaks every 2 minutes
    this.sweepInterval = setInterval(() => this.cleanup(), 2 * 60 * 1000)
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref()
    }
  }

  cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowMs)
      if (valid.length === 0) {
        this.hits.delete(key)
      } else {
        this.hits.set(key, valid)
      }
    }
  }

  reset() {
    this.hits.clear()
  }

  middleware() {
    return (req, res, next) => {
      const key = String(this.keyGenerator(req))
      const now = Date.now()

      let timestamps = this.hits.get(key) || []
      // Filter timestamps outside current sliding window
      timestamps = timestamps.filter((t) => now - t < this.windowMs)

      if (timestamps.length >= this.max) {
        const oldest = timestamps[0]
        const retryAfterSec = Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000))
        res.setHeader('Retry-After', retryAfterSec)
        res.setHeader('X-RateLimit-Limit', this.max)
        res.setHeader('X-RateLimit-Remaining', 0)
        res.setHeader('X-RateLimit-Reset', Math.ceil((oldest + this.windowMs) / 1000))

        // Trigger durable audit record for rate limit breach
        recordAuditLog({
          action: 'RATE_LIMIT_EXCEEDED',
          resourceType: 'SYSTEM',
          resourceId: this.category,
          result: 'BLOCKED',
          reason: `Rate limit of ${this.max} requests per ${Math.round(this.windowMs / 1000)}s exceeded for category ${this.category}`,
          metadata: {
            category: this.category,
            limit: this.max,
            windowMs: this.windowMs,
            retryAfterSec,
          },
          req,
        })

        return res.status(429).json({
          success: false,
          error: {
            code: 'rate_limit_exceeded',
            message: this.message,
          },
        })
      }

      timestamps.push(now)
      this.hits.set(key, timestamps)

      res.setHeader('X-RateLimit-Limit', this.max)
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.max - timestamps.length))
      res.setHeader('X-RateLimit-Reset', Math.ceil((timestamps[0] + this.windowMs) / 1000))

      return next()
    }
  }
}

export function createPaymentRateLimiter(options) {
  const limiter = new InMemorySlidingWindowRateLimiter(options)
  const middleware = limiter.middleware()
  middleware.limiter = limiter // Expose for testing resets
  return middleware
}

// -------------------------------------------------------------
// PRE-CONFIGURED CATEGORY RATE LIMITERS (Phase 2.4G)
// -------------------------------------------------------------

// --- AUTH LIMITERS ---
// Login: 10 attempts per 5 minutes per IP or identifier
export const authLoginRateLimiter = createPaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 10,
  category: 'AUTH_LOGIN',
  keyGenerator: (req) => {
    const raw = req.body?.identifier ?? req.body?.email
    const identifier = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
    const ip = req.ip || req.connection?.remoteAddress || 'unknown'
    return `auth_login:${identifier || ip}`
  },
  message: 'Too many login attempts. Please wait 5 minutes before trying again.',
})

// Register: 10 registrations per 15 minutes per IP
export const authRegisterRateLimiter = createPaymentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  category: 'AUTH_REGISTER',
  keyGenerator: (req) => `auth_register:${req.ip || 'unknown'}`,
  message: 'Too many registration requests. Please wait a few minutes before trying again.',
})

// Google Auth: 15 requests per 5 minutes per IP
export const authGoogleRateLimiter = createPaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  category: 'AUTH_GOOGLE',
  keyGenerator: (req) => `auth_google:${req.ip || 'unknown'}`,
  message: 'Too many Google authentication attempts. Please wait a few minutes.',
})

// Password Reset: 5 requests per 15 minutes per email/IP
export const authPasswordResetRateLimiter = createPaymentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  category: 'AUTH_PASSWORD_RESET',
  keyGenerator: (req) => {
    const raw = req.body?.email
    const email = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
    const ip = req.ip || req.connection?.remoteAddress || 'unknown'
    return `auth_pw_reset:${email || ip}`
  },
  message: 'Too many password reset requests. Please wait 15 minutes before retrying.',
})

// --- PAYMENT LIMITERS ---
// Order creation: 10 requests per minute per user/IP
export const paymentCreateRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  category: 'PAYMENT_CREATE',
  keyGenerator: (req) => `payment_create:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Payment creation limit exceeded. Please wait a moment before trying again.',
})

// Verification: 15 requests per minute per user/IP
export const paymentVerifyRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  category: 'PAYMENT_VERIFY',
  keyGenerator: (req) => `payment_verify:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Payment verification limit exceeded. Please wait a moment before retrying.',
})

// Failure record: 20 requests per minute per user/IP
export const paymentFailureRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  category: 'PAYMENT_FAIL',
  keyGenerator: (req) => `payment_fail:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Payment failure reporting limit exceeded.',
})

// --- WEBHOOK LIMITER ---
// High burst tolerance: 120 requests per minute keyed by IP / Provider
// Must NEVER block legitimate Razorpay webhook retries
export const webhookRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  category: 'WEBHOOK',
  keyGenerator: (req) => `webhook:${req.ip || 'razorpay'}`,
  message: 'Webhook burst threshold exceeded.',
})

// --- REFUND LIMITERS ---
// Customer refund rate limiter: 10 requests per 15 minutes per user/IP
export const customerRefundRateLimiter = createPaymentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  category: 'CUSTOMER_REFUND',
  keyGenerator: (req) => `cust_refund:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Refund request limit exceeded. Please wait before submitting another refund request.',
})

// Admin refund rate limiter: 30 requests per minute per admin
export const adminRefundRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  category: 'ADMIN_REFUND',
  keyGenerator: (req) => `admin_refund:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Admin refund action limit exceeded. Please wait a moment.',
})

// --- ORDER LIMITERS ---
// Order creation: 80 requests per 10 minutes per user/IP
export const orderCreateRateLimiter = createPaymentRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 80,
  category: 'ORDER_CREATE',
  keyGenerator: (req) => `order_create:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Order creation rate limit exceeded. Please wait before placing new orders.',
})

// Order cancellation: 15 requests per 15 minutes per user/IP
export const orderCancelRateLimiter = createPaymentRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  category: 'ORDER_CANCEL',
  keyGenerator: (req) => `order_cancel:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Order cancellation limit exceeded. Please wait before submitting further cancellations.',
})

// --- ADMIN MUTATION LIMITER ---
// Admin mutations: 60 mutating requests per minute per admin user + IP
export const adminMutationRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  category: 'ADMIN_MUTATION',
  keyGenerator: (req) => `admin_mut:${req.user?._id || req.user?.id || req.ip}`,
  message: 'Admin mutation limit exceeded. Please wait a moment.',
})

// --- PUBLIC CATALOG LIMITER ---
// Public catalog browse/search: 300 requests per minute per IP
export const publicCatalogRateLimiter = createPaymentRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  category: 'PUBLIC_CATALOG',
  keyGenerator: (req) => `pub_cat:${req.ip || 'anon'}`,
  message: 'Too many requests. Please slow down.',
})

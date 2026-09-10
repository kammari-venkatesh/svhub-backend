import crypto from 'crypto'
import Razorpay from 'razorpay'
import { env } from './env.js'

let clientInstance = null

export function isRazorpayConfigured() {
  const keyId = env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID
  const keySecret = env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET
  return Boolean(keyId && keySecret)
}

export function getRazorpayKeyId() {
  return env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || ''
}

export function getRazorpayKeySecret() {
  return env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || ''
}

export function getRazorpayClient() {
  const keyId = getRazorpayKeyId()
  const keySecret = getRazorpayKeySecret()

  if (!keyId || !keySecret) {
    const error = new Error('Razorpay configuration missing: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured.')
    error.statusCode = 500
    error.code = 'RAZORPAY_CONFIG_MISSING'
    throw error
  }

  if (!clientInstance) {
    clientInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    })
  }

  return clientInstance
}

/**
 * Verifies Razorpay HMAC SHA256 signature using server-stored razorpayOrderId and key secret.
 * @param {Object} params
 * @param {string} params.serverOrderId  - Razorpay order ID stored in our server record
 * @param {string} params.paymentId      - razorpay_payment_id returned by Razorpay
 * @param {string} params.signature      - razorpay_signature returned by Razorpay
 * @param {string} [params.secret]       - Optional override secret for testing
 * @returns {boolean}
 */
export function verifyRazorpaySignature({ serverOrderId, paymentId, signature, secret }) {
  const keySecret = secret || getRazorpayKeySecret()
  if (!keySecret || !serverOrderId || !paymentId || !signature) {
    return false
  }

  const payload = `${serverOrderId}|${paymentId}`
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex')

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
  const clientBuffer = Buffer.from(String(signature), 'utf8')

  if (expectedBuffer.length !== clientBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBuffer, clientBuffer)
}

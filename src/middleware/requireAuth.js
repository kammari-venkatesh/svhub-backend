import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { fail, jwtSecret } from '../utils/auth.js'

export async function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!token) {
    return fail(res, 401, 'unauthenticated', 'Please log in to continue.')
  }

  try {
    const payload = jwt.verify(token, jwtSecret())

    if (!payload?.sub) {
      return fail(res, 401, 'invalid_token', 'Invalid session token. Please log in again.')
    }

    const user = await User.findById(payload.sub)
    if (!user) {
      return fail(res, 401, 'unauthenticated', 'User account no longer exists. Please log in again.')
    }

    const status = String(user.status || 'ACTIVE').toUpperCase()
    if (status === 'SUSPENDED' || status === 'INACTIVE') {
      return fail(res, 403, 'account_inactive', 'Your account has been deactivated. Please contact support.')
    }

    req.user = user
    return next()
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return fail(res, 401, 'token_expired', 'Your session has expired. Please log in again.')
    }
    return fail(res, 401, 'unauthenticated', 'Invalid session token. Please log in again.')
  }
}

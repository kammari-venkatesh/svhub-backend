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
    const user = await User.findById(payload.sub)
    if (!user) {
      return fail(res, 401, 'unauthenticated', 'Please log in to continue.')
    }
    req.user = user
    return next()
  } catch {
    return fail(res, 401, 'unauthenticated', 'Your session has expired. Please log in again.')
  }
}

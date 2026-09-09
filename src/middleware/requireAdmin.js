import { fail } from '../utils/auth.js'

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return fail(res, 401, 'unauthenticated', 'Please log in to continue.')
  }

  const role = String(req.user.role || '').toUpperCase()

  if (role !== 'ADMIN') {
    return fail(
      res,
      403,
      'forbidden_admin_access',
      'Access denied. Administrator privileges are required to perform this action.',
    )
  }

  return next()
}

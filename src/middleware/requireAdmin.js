import { fail } from '../utils/auth.js'
import { recordAuditLog } from '../services/auditLogger.js'

export function requireAdmin(req, res, next) {
  if (!req.user) {
    recordAuditLog({
      action: 'AUTHORIZATION_DENIED',
      actorType: 'ANONYMOUS',
      resourceType: 'SYSTEM',
      resourceId: req.originalUrl || req.url,
      result: 'DENIED',
      reason: 'Unauthenticated attempt to access administrative endpoint',
      req,
    })
    return fail(res, 401, 'unauthenticated', 'Please log in to continue.')
  }

  const role = String(req.user.role || '').toUpperCase()

  if (role !== 'ADMIN') {
    recordAuditLog({
      action: 'AUTHORIZATION_DENIED',
      actorType: 'CUSTOMER',
      actorId: req.user._id,
      actorEmail: req.user.email,
      resourceType: 'SYSTEM',
      resourceId: req.originalUrl || req.url,
      result: 'DENIED',
      reason: `Customer role "${role}" denied administrative access`,
      req,
    })
    return fail(
      res,
      403,
      'forbidden_admin_access',
      'Access denied. Administrator privileges are required to perform this action.',
    )
  }

  return next()
}

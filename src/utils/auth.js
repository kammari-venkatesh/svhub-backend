const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase()
}

export function emailError(value = '') {
  const email = String(value).trim()
  if (!email) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
  return ''
}

export function nameError(value = '') {
  const name = String(value).trim()
  if (!name) return 'Enter your full name.'
  if (name.length < 2) return 'Enter your full name.'
  return ''
}

export function normalizePhone(value = '') {
  const digits = String(value).replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

export function phoneError(value = '') {
  if (!String(value).trim()) return 'Enter your phone number.'
  const digits = normalizePhone(value)
  if (!/^[6-9]\d{9}$/.test(digits)) return 'Enter a valid 10-digit Indian mobile number.'
  return ''
}

export function loginIdentifierError(value = '') {
  const identifier = String(value).trim()
  if (!identifier) return 'Enter your email or mobile number.'
  if (identifier.includes('@')) return emailError(identifier)
  return phoneError(identifier)
}

const PASSWORD_RULES = [
  { id: 'length', test: (value) => value.length >= 8 },
  { id: 'upper', test: (value) => /[A-Z]/.test(value) },
  { id: 'lower', test: (value) => /[a-z]/.test(value) },
  { id: 'number', test: (value) => /\d/.test(value) },
  { id: 'special', test: (value) => /[^A-Za-z0-9]/.test(value) },
]

export function passwordError(password = '') {
  const value = String(password)
  if (!value) return 'Enter a password.'
  if (!PASSWORD_RULES.every((rule) => rule.test(value))) {
    return 'Use 8+ characters with upper, lower, number, and a special character.'
  }
  return ''
}

export function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret === 'change-me') {
    throw new Error('JWT_SECRET is not set')
  }
  return secret
}

export function fail(res, status, code, message) {
  return res.status(status).json({ code, message })
}

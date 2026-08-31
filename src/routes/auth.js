import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { User } from '../models/User.js'
import { isFirebaseAdminConfigured, verifyGoogleIdToken } from '../lib/firebaseAdmin.js'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  emailError,
  fail,
  jwtSecret,
  loginIdentifierError,
  nameError,
  normalizeEmail,
  normalizePhone,
  passwordError,
  phoneError,
} from '../utils/auth.js'

const authRouter = Router()
const TOKEN_TTL_MS = 30 * 60 * 1000
const SALT_ROUNDS = 12

function signUser(user) {
  return jwt.sign({ sub: String(user._id) }, jwtSecret(), { expiresIn: '7d' })
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function createResetToken() {
  return crypto.randomBytes(32).toString('hex')
}

authRouter.post('/register', async (req, res) => {
  try {
    const nameIssue = nameError(req.body?.name)
    const emailIssue = emailError(req.body?.email)
    const phoneIssue = phoneError(req.body?.phone)
    const passIssue = passwordError(req.body?.password)

    if (nameIssue) return fail(res, 400, 'invalid_name', nameIssue)
    if (emailIssue) return fail(res, 400, 'invalid_email', emailIssue)
    if (phoneIssue) return fail(res, 400, 'invalid_phone', phoneIssue)
    if (passIssue) return fail(res, 400, 'weak_password', passIssue)

    const email = normalizeEmail(req.body.email)
    const existing = await User.findOne({ email })
    if (existing) {
      return fail(res, 409, 'duplicate_email', 'An account with this email already exists. Try logging in.')
    }

    const user = await User.create({
      name: String(req.body.name).trim(),
      email,
      phone: normalizePhone(req.body.phone),
      passwordHash: await bcrypt.hash(String(req.body.password), SALT_ROUNDS),
      provider: 'password',
    })

    return res.status(201).json({ user: user.toPublic(), token: signUser(user) })
  } catch (error) {
    if (error?.code === 11000) {
      return fail(res, 409, 'duplicate_email', 'An account with this email already exists. Try logging in.')
    }
    console.error('register failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

authRouter.post('/login', async (req, res) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.email ?? '')
    const identifierIssue = loginIdentifierError(identifier)
    if (identifierIssue) return fail(res, 400, 'invalid_identifier', identifierIssue)
    if (!req.body?.password) return fail(res, 400, 'invalid_password', 'Enter your password.')

    const user = identifier.includes('@')
      ? await User.findOne({ email: normalizeEmail(identifier) })
      : await User.findOne({ phone: normalizePhone(identifier) })

    if (user && !user.passwordHash) {
      return fail(
        res,
        401,
        'google_only',
        'This account uses Google Sign-In. Continue with Google to log in.',
      )
    }

    const ok = user ? await bcrypt.compare(String(req.body.password), user.passwordHash) : false

    if (!user || !ok) {
      return fail(
        res,
        401,
        'invalid_credentials',
        'That email or mobile number and password didn’t match. Please try again.',
      )
    }

    return res.json({ user: user.toPublic(), token: signUser(user) })
  } catch (error) {
    console.error('login failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

authRouter.post('/google', async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || '')
    if (!idToken) {
      return fail(res, 400, 'invalid_token', 'Google Sign-In did not return a valid token.')
    }
    if (!isFirebaseAdminConfigured()) {
      return fail(res, 503, 'config', 'Google Sign-In is not configured on the server.')
    }

    let decoded
    try {
      decoded = await verifyGoogleIdToken(idToken)
    } catch (error) {
      console.error('google token verify failed', error)
      return fail(res, 401, 'invalid_token', 'Google Sign-In could not be verified. Please try again.')
    }

    const email = normalizeEmail(decoded.email)
    if (!email) {
      return fail(res, 400, 'invalid_email', 'Google did not provide an email address for this account.')
    }
    if (decoded.firebase?.sign_in_provider && decoded.firebase.sign_in_provider !== 'google.com') {
      return fail(res, 401, 'invalid_token', 'This sign-in method is not supported.')
    }

    const name = String(decoded.name || email.split('@')[0]).trim()
    const firebaseUid = decoded.uid
    let created = false

    let user = await User.findOne({ firebaseUid })
    if (!user) user = await User.findOne({ email })

    if (user) {
      if (!user.firebaseUid) user.firebaseUid = firebaseUid
      if (!user.name) user.name = name
      await user.save()
    } else {
      created = true
      user = await User.create({
        name,
        email,
        firebaseUid,
        provider: 'google',
      })
    }

    return res.json({ user: user.toPublic(), token: signUser(user), created })
  } catch (error) {
    if (error?.code === 11000) {
      return fail(res, 409, 'duplicate_email', 'An account with this email already exists. Try logging in.')
    }
    console.error('google login failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

authRouter.post('/forgot-password', async (req, res) => {
  try {
    const emailIssue = emailError(req.body?.email)
    if (emailIssue) return fail(res, 400, 'invalid_email', emailIssue)

    const email = normalizeEmail(req.body.email)
    const user = await User.findOne({ email })

    if (!user) {
      return fail(res, 404, 'unknown_email', 'We couldn’t find an account with that email.')
    }

    const token = createResetToken()
    user.resetTokenHash = hashToken(token)
    user.resetTokenExpires = new Date(Date.now() + TOKEN_TTL_MS)
    await user.save()

    const origin = process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173'
    const resetUrl = `${origin}/reset-password?token=${token}`
    console.log(`Password reset for ${email}: ${resetUrl}`)

    return res.json({ email, token })
  } catch (error) {
    console.error('forgot-password failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

authRouter.get('/reset-password', async (req, res) => {
  try {
    const token = String(req.query.token || '')
    if (!token) {
      return fail(res, 400, 'invalid_token', 'This reset link is missing or incomplete.')
    }

    const user = await User.findOne({
      resetTokenHash: hashToken(token),
      resetTokenExpires: { $gt: new Date() },
    })

    if (!user) {
      return fail(res, 400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.')
    }

    return res.json({ email: user.email })
  } catch (error) {
    console.error('inspect reset failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

authRouter.patch('/profile', requireAuth, async (req, res) => {
  try {
    const user = req.user
    const nameIssue = nameError(req.body?.name)
    const emailIssue = emailError(req.body?.email)
    const phoneIssue = phoneError(req.body?.phone)

    if (nameIssue) return fail(res, 400, 'invalid_name', nameIssue)
    if (emailIssue) return fail(res, 400, 'invalid_email', emailIssue)
    if (phoneIssue) return fail(res, 400, 'invalid_phone', phoneIssue)

    const email = normalizeEmail(req.body.email)
    if (email !== user.email) {
      const taken = await User.findOne({ email, _id: { $ne: user._id } })
      if (taken) {
        return fail(res, 409, 'duplicate_email', 'An account with this email already exists.')
      }
    }

    const currentPassword = String(req.body?.currentPassword ?? '')
    const newPassword = String(req.body?.newPassword ?? req.body?.password ?? '')
    const changingPassword = Boolean(currentPassword || newPassword)

    if (changingPassword) {
      if (user.passwordHash) {
        if (!currentPassword) {
          return fail(res, 400, 'invalid_password', 'Enter your current password.')
        }
        const matches = await bcrypt.compare(currentPassword, user.passwordHash)
        if (!matches) {
          return fail(
            res,
            401,
            'invalid_credentials',
            'That current password didn’t match. Please try again.',
          )
        }
      }

      const passIssue = passwordError(newPassword)
      if (passIssue) return fail(res, 400, 'weak_password', passIssue)

      if (user.passwordHash && currentPassword && newPassword === currentPassword) {
        return fail(
          res,
          400,
          'same_password',
          'Choose a new password that’s different from your current one.',
        )
      }

      user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
    }

    user.name = String(req.body.name).trim()
    user.email = email
    user.phone = normalizePhone(req.body.phone)
    await user.save()

    return res.json({ user: user.toPublic() })
  } catch (error) {
    if (error?.code === 11000) {
      return fail(res, 409, 'duplicate_email', 'An account with this email already exists.')
    }
    console.error('update profile failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

authRouter.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '')
    const passIssue = passwordError(req.body?.password)
    if (!token) return fail(res, 400, 'invalid_token', 'This reset link is missing or incomplete.')
    if (passIssue) return fail(res, 400, 'weak_password', passIssue)

    const user = await User.findOne({
      resetTokenHash: hashToken(token),
      resetTokenExpires: { $gt: new Date() },
    })

    if (!user) {
      return fail(res, 400, 'expired_token', 'This reset link is invalid or has expired. Request a new one.')
    }

    user.passwordHash = await bcrypt.hash(String(req.body.password), SALT_ROUNDS)
    user.resetTokenHash = ''
    user.resetTokenExpires = null
    await user.save()

    return res.json({ email: user.email })
  } catch (error) {
    console.error('reset-password failed', error)
    return fail(res, 500, 'server', 'Something went wrong. Please try again.')
  }
})

export { authRouter }

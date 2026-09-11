import jwt from 'jsonwebtoken'

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

let certCache = { expires: 0, certs: null }

function projectId() {
  return process.env.FIREBASE_PROJECT_ID || ''
}

function privateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY || ''
  return key.replace(/\\n/g, '\n')
}

export function hasServiceAccount() {
  return Boolean(projectId() && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
}

export function isFirebaseAdminConfigured() {
  return Boolean(projectId())
}

function decodeHeader(idToken) {
  const [raw] = String(idToken).split('.')
  if (!raw) throw new Error('invalid_token')
  return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
}

async function googleCerts() {
  if (certCache.certs && Date.now() < certCache.expires) return certCache.certs

  const response = await fetch(CERTS_URL)
  if (!response.ok) throw new Error('certs_unavailable')

  const certs = await response.json()
  const maxAge = Number.parseInt(
    String(response.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || '3600',
    10,
  )

  certCache = {
    certs,
    expires: Date.now() + Math.max(maxAge, 60) * 1000,
  }

  return certs
}

async function verifyWithPublicKeys(idToken) {
  const header = decodeHeader(idToken)
  const certs = await googleCerts()
  const certificate = certs[header.kid]
  if (!certificate) throw new Error('unknown_kid')

  const audience = projectId()
  const payload = jwt.verify(idToken, certificate, {
    algorithms: ['RS256'],
    audience,
    issuer: `https://securetoken.google.com/${audience}`,
  })

  if (!payload?.sub) throw new Error('missing_sub')

  return {
    uid: payload.sub,
    email: payload.email,
    name: payload.name,
    firebase: payload.firebase,
  }
}

export async function getFirebaseAdminAuth() {
  if (!hasServiceAccount()) {
    throw new Error('Firebase Admin service account is not configured')
  }

  const { cert, getApps, initializeApp } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: projectId(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey(),
      }),
    })
  }

  return getAuth()
}

export async function verifyGoogleIdToken(idToken) {
  if (!isFirebaseAdminConfigured()) {
    throw new Error('Firebase Admin is not configured')
  }

  if (hasServiceAccount()) {
    try {
      const auth = await getFirebaseAdminAuth()
      return await auth.verifyIdToken(idToken)
    } catch (adminErr) {
      console.warn('Firebase Admin SDK verification failed, falling back to public cert verification:', adminErr.message)
    }
  }

  return verifyWithPublicKeys(idToken)
}

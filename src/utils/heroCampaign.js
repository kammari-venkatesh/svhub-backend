/**
 * Hero campaign helpers — Asia/Kolkata scheduling is the source of truth.
 */

export const HERO_TZ = 'Asia/Kolkata'

export const DEFAULT_HERO_CAMPAIGN = {
  // Fail-safe: missing/corrupt docs show the normal homepage hero.
  enabled: false,
  label: 'Ganesh Chaturthi Special',
  title: 'Celebrate Ganesh\nChaturthi,\nThe Natural Way.',
  subtitle: 'Celebrate the festival with goodness rooted in tradition and nature.',
  discountPercent: 10,
  urgencyLabel: '5 Days Only',
  ctaLabel: 'Shop the Celebration',
  ctaTo: '/shop',
  imageUrl: '/ganesh-chaturthi-art.webp',
  imageAlt:
    'Traditional watercolor illustration of Lord Ganesh with marigold tones and botanical leaves',
}

/** Current instant as Date (UTC internally; comparisons are absolute). */
export function nowDate(reference = new Date()) {
  return reference instanceof Date ? new Date(reference.getTime()) : new Date(reference)
}

/**
 * Format a Date for datetime-local inputs in Asia/Kolkata (YYYY-MM-DDTHH:mm).
 */
export function toKolkataInputValue(date) {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HERO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type) => parts.find((p) => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/**
 * Parse a datetime-local string as Asia/Kolkata wall time → UTC Date.
 * Accepts "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss".
 */
export function parseKolkataDateTime(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const raw = String(value || '').trim()
  if (!raw) return null

  // Already ISO with Z or offset — trust absolute instant
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/,
  )
  if (!match) {
    const fallback = new Date(raw)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }

  const [, y, mo, d, h, mi, s = '0'] = match
  // IST is UTC+5:30 with no DST
  const utcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h) - 5,
    Number(mi) - 30,
    Number(s),
  )
  const date = new Date(utcMs)
  return Number.isNaN(date.getTime()) ? null : date
}

export function defaultCampaignWindow(reference = new Date()) {
  const start = nowDate(reference)
  const end = new Date(start.getTime() + 5 * 24 * 60 * 60 * 1000)
  return { startAt: start, endAt: end }
}

function toPlainCampaign(raw) {
  if (!raw || typeof raw !== 'object') return {}
  if (typeof raw.toObject === 'function') {
    return raw.toObject({ depopulate: true, flattenMaps: true })
  }
  // Mongoose subdocuments sometimes expose fields on `_doc` when spread is empty.
  if (raw._doc && typeof raw._doc === 'object') {
    return { ...raw._doc }
  }
  return { ...raw }
}

export function normalizeHeroCampaign(raw, { seedDates = true, reference = new Date() } = {}) {
  const plain = toPlainCampaign(raw)
  const base = { ...DEFAULT_HERO_CAMPAIGN, ...plain }
  const window = defaultCampaignWindow(reference)

  let startAt = base.startAt ? parseKolkataDateTime(base.startAt) : null
  let endAt = base.endAt ? parseKolkataDateTime(base.endAt) : null

  if (seedDates) {
    if (!startAt) startAt = window.startAt
    if (!endAt) endAt = window.endAt
  }

  const discount = Number(base.discountPercent)
  let imageUrl = String(base.imageUrl || DEFAULT_HERO_CAMPAIGN.imageUrl).trim()
  if (
    !imageUrl ||
    imageUrl.includes('photo-1567593810070-7a3d471af022') ||
    imageUrl.includes('ganesh-courtyard-hero') ||
    imageUrl.includes('ganesh-chaturthi-art.jpg') ||
    imageUrl.includes('ganesh-chaturthi-art.png')
  ) {
    imageUrl = DEFAULT_HERO_CAMPAIGN.imageUrl
  }

  // Preserve explicit false — do not let DEFAULT_HERO_CAMPAIGN.enabled:true win.
  const enabled = Object.prototype.hasOwnProperty.call(plain, 'enabled')
    ? Boolean(plain.enabled)
    : Boolean(DEFAULT_HERO_CAMPAIGN.enabled)

  return {
    enabled,
    label: String(base.label || DEFAULT_HERO_CAMPAIGN.label).trim(),
    title: String(base.title || DEFAULT_HERO_CAMPAIGN.title).trim(),
    subtitle: String(base.subtitle || DEFAULT_HERO_CAMPAIGN.subtitle).trim(),
    discountPercent: Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 10,
    urgencyLabel: String(base.urgencyLabel || DEFAULT_HERO_CAMPAIGN.urgencyLabel).trim(),
    ctaLabel: String(base.ctaLabel || DEFAULT_HERO_CAMPAIGN.ctaLabel).trim(),
    ctaTo: String(base.ctaTo || DEFAULT_HERO_CAMPAIGN.ctaTo).trim() || '/shop',
    imageUrl,
    imageAlt: String(base.imageAlt || DEFAULT_HERO_CAMPAIGN.imageAlt).trim(),
    startAt,
    endAt,
  }
}

/**
 * Resolve campaign lifecycle status using absolute instants (timezone-safe).
 */
export function resolveHeroCampaignStatus(campaign, reference = new Date()) {
  const now = nowDate(reference)
  if (!campaign || !campaign.enabled) return 'disabled'
  if (!campaign.startAt || !campaign.endAt) return 'disabled'
  if (!(campaign.endAt > campaign.startAt)) return 'disabled'
  if (now < campaign.startAt) return 'scheduled'
  if (now >= campaign.endAt) return 'expired'
  return 'active'
}

export function isCampaignHeroActive(campaign, reference = new Date()) {
  return resolveHeroCampaignStatus(campaign, reference) === 'active'
}

export function serializeAdminHeroCampaign(campaign, reference = new Date()) {
  const normalized = normalizeHeroCampaign(campaign, { seedDates: true, reference })
  const status = resolveHeroCampaignStatus(normalized, reference)
  return {
    enabled: normalized.enabled,
    status,
    label: normalized.label,
    title: normalized.title,
    subtitle: normalized.subtitle,
    discountPercent: normalized.discountPercent,
    urgencyLabel: normalized.urgencyLabel,
    ctaLabel: normalized.ctaLabel,
    ctaTo: normalized.ctaTo,
    imageUrl: normalized.imageUrl,
    imageAlt: normalized.imageAlt,
    startAt: normalized.startAt ? normalized.startAt.toISOString() : null,
    endAt: normalized.endAt ? normalized.endAt.toISOString() : null,
    startAtLocal: toKolkataInputValue(normalized.startAt),
    endAtLocal: toKolkataInputValue(normalized.endAt),
    timezone: HERO_TZ,
    discountAppliesAtCheckout: false,
  }
}

export function serializePublicHero(campaign, reference = new Date()) {
  const normalized = normalizeHeroCampaign(campaign, { seedDates: true, reference })
  const status = resolveHeroCampaignStatus(normalized, reference)
  const active = status === 'active'
  const serverNow = nowDate(reference).toISOString()

  if (!active) {
    return {
      mode: 'normal',
      status,
      serverNow,
      timezone: HERO_TZ,
      campaign: null,
    }
  }

  return {
    mode: 'campaign',
    status,
    serverNow,
    timezone: HERO_TZ,
    campaign: {
      label: normalized.label,
      title: normalized.title,
      subtitle: normalized.subtitle,
      discountPercent: normalized.discountPercent,
      urgencyLabel: normalized.urgencyLabel,
      ctaLabel: normalized.ctaLabel,
      ctaTo: normalized.ctaTo,
      imageUrl: normalized.imageUrl,
      imageAlt: normalized.imageAlt,
      endAt: normalized.endAt.toISOString(),
      discountAppliesAtCheckout: false,
    },
  }
}

export function validateHeroCampaignPatch(input = {}) {
  const errors = []
  const next = { ...input }

  if (next.enabled !== undefined) next.enabled = Boolean(next.enabled)

  if (next.discountPercent !== undefined) {
    const val = Number(next.discountPercent)
    if (!Number.isFinite(val) || val < 0 || val > 100) {
      errors.push({ field: 'discountPercent', message: 'Discount must be between 0 and 100.' })
    } else {
      next.discountPercent = val
    }
  }

  if (next.ctaTo !== undefined) {
    const to = String(next.ctaTo).trim()
    if (!to.startsWith('/')) {
      errors.push({ field: 'ctaTo', message: 'CTA destination must be a site path starting with /.' })
    } else {
      next.ctaTo = to
    }
  }

  for (const field of ['label', 'title', 'subtitle', 'ctaLabel']) {
    if (next[field] !== undefined && !String(next[field]).trim()) {
      errors.push({ field, message: `${field} cannot be empty.` })
    }
  }

  let startAt = next.startAt !== undefined ? parseKolkataDateTime(next.startAt) : undefined
  let endAt = next.endAt !== undefined ? parseKolkataDateTime(next.endAt) : undefined

  if (next.startAt !== undefined && !startAt) {
    errors.push({ field: 'startAt', message: 'Enter a valid campaign start date/time.' })
  }
  if (next.endAt !== undefined && !endAt) {
    errors.push({ field: 'endAt', message: 'Enter a valid campaign end date/time.' })
  }

  if (startAt) next.startAt = startAt
  if (endAt) next.endAt = endAt

  if (startAt && endAt && !(endAt > startAt)) {
    errors.push({ field: 'endAt', message: 'End must be after start.' })
  }

  return { errors, next }
}

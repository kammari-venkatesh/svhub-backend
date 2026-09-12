/**
 * Unit tests for hero campaign scheduling (Asia/Kolkata).
 */
import assert from 'node:assert/strict'
import {
  isCampaignHeroActive,
  normalizeHeroCampaign,
  parseKolkataDateTime,
  resolveHeroCampaignStatus,
  serializePublicHero,
  toKolkataInputValue,
  validateHeroCampaignPatch,
} from '../src/utils/heroCampaign.js'

const start = parseKolkataDateTime('2026-09-12T10:00')
const end = parseKolkataDateTime('2026-09-17T10:00')
assert.ok(start)
assert.ok(end)
assert.ok(end > start)

// Round-trip Kolkata local input
const local = toKolkataInputValue(start)
assert.match(local, /^2026-09-12T10:00$/)

const campaign = normalizeHeroCampaign(
  {
    enabled: true,
    label: 'Ganesh Chaturthi Special',
    title: 'Celebrate',
    subtitle: '10% off',
    discountPercent: 10,
    startAt: start,
    endAt: end,
  },
  { seedDates: false },
)

assert.equal(resolveHeroCampaignStatus(campaign, new Date(start.getTime() - 1000)), 'scheduled')
assert.equal(resolveHeroCampaignStatus(campaign, start), 'active')
assert.equal(resolveHeroCampaignStatus(campaign, new Date(start.getTime() + 60_000)), 'active')
assert.equal(resolveHeroCampaignStatus(campaign, end), 'expired')
assert.equal(resolveHeroCampaignStatus(campaign, new Date(end.getTime() + 1)), 'expired')

const disabled = normalizeHeroCampaign({ ...campaign, enabled: false }, { seedDates: false })
assert.equal(resolveHeroCampaignStatus(disabled, start), 'disabled')
assert.equal(isCampaignHeroActive(disabled, start), false)

const publicActive = serializePublicHero(campaign, new Date(start.getTime() + 1000))
assert.equal(publicActive.mode, 'campaign')
assert.equal(publicActive.campaign.discountPercent, 10)
assert.equal(publicActive.campaign.discountAppliesAtCheckout, false)
assert.ok(publicActive.campaign.endAt)

const publicExpired = serializePublicHero(campaign, end)
assert.equal(publicExpired.mode, 'normal')
assert.equal(publicExpired.campaign, null)

const publicDisabled = serializePublicHero(disabled, start)
assert.equal(publicDisabled.mode, 'normal')

const invalid = validateHeroCampaignPatch({
  startAt: '2026-09-17T10:00',
  endAt: '2026-09-12T10:00',
  discountPercent: 150,
  ctaTo: 'shop',
  label: '  ',
})
assert.ok(invalid.errors.length >= 3)

const ok = validateHeroCampaignPatch({
  enabled: true,
  label: 'Diwali',
  discountPercent: 15,
  ctaTo: '/shop',
  startAt: '2026-10-20T09:00',
  endAt: '2026-10-25T21:00',
})
assert.equal(ok.errors.length, 0)

console.log('heroCampaign: all cases passed')

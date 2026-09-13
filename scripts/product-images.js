/**
 * product-images.js
 * ONE real hero image for EVERY catalog product. No placeholders.
 *
 * Priority:
 * 1. Self-hosted /catalog/{slug}.jpg when present (stable, product-curated)
 * 2. Earlier working remote map from commit 6e60c55 (pre-research blank-card regression)
 * 3. Never blank / never "coming soon" for catalog SKUs
 */

const u = (id, w = 1200) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`
const p = (id, w = 1200) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`
const local = (slug) => `/catalog/${slug}.jpg`

/**
 * Complete 59-product map. Every slug MUST have a non-empty URL.
 * @type {Record<string, string>}
 */
export const productImages = {
  // ── Daily meal ─────────────────────────────────────────────────────────────
  'idiyappam-meal': `${local('idiyappam-meal')}?v=heritage-4`,

  // ── Handmade soaps ─────────────────────────────────────────────────────────
  'hibiscus-soap': `${local('hibiscus-soap')}?v=heritage-4`,
  'kasthuri-manjal-soap': `${local('kasthuri-manjal-soap')}?v=heritage-1`,
  'kuppaimeni-soap': `${local('kuppaimeni-soap')}?v=heritage-4`,
  'multanimitti-soap': `${local('multanimitti-soap')}?v=heritage-4`,
  'sweet-basil-soap': `${local('sweet-basil-soap')}?v=heritage-4`,
  'vettiver-soap': local('vettiver-soap'),

  // ── Health & wellness ──────────────────────────────────────────────────────
  'multimillet-muesli': `${local('multimillet-muesli')}?v=heritage-1`,
  'beetroot-nutrimix': `${local('beetroot-nutrimix')}?v=heritage-2`,
  'healthmix': `${local('healthmix')}?v=heritage-1`,

  // ── Idli podi ──────────────────────────────────────────────────────────────
  'idli-podi-regular': `${local('idli-podi-regular')}?v=heritage-1`,
  'ellu-idli-podi': `${local('ellu-idli-podi')}?v=heritage-2`,
  'karuveppilai-idli-podi': `${local('karuveppilai-idli-podi')}?v=heritage-2`,
  'murungai-idli-podi': `${local('murungai-idli-podi')}?v=heritage-2`,
  'paruppu-podi': `${local('paruppu-podi')}?v=heritage-2`,

  // ── Seasonings ─────────────────────────────────────────────────────────────
  'cream-onion-powder': u('photo-1508747703725-719777637510'),
  'noodles-masala': u('photo-1569718212165-3a8278d5f624'),
  'pasta-seasoning': u('photo-1621996346565-e3dbc646d9a9'),
  'peri-peri-seasoning': u('photo-1604908176997-125f25cc6f3d'),

  // ── Native rice ────────────────────────────────────────────────────────────
  'karuppu-kavuni-rice': `${local('karuppu-kavuni-rice')}?v=heritage-1`,
  'kullakar-rice': `${local('kullakar-rice')}?v=heritage-1`,
  'mappillai-samba-rice': p('723198'),
  'security-test-product-prod': `${local('security-test-product-prod')}?v=heritage-1`,

  // ── Pickles & thokku / pastes ───────────────────────────────────────────────
  'vadu-maangai-pickle': `${local('vadu-maangai-pickle')}?v=heritage-1`,
  'vadu-maanga-thokku': local('vadu-maanga-thokku'),
  'tomato-thokku': `${local('tomato-thokku')}?v=heritage-1`,
  'mango-thokku': `${local('mango-thokku')}?v=heritage-3`,
  'garlic-sweet-hot-pickle': `${local('garlic-sweet-hot-pickle')}?v=heritage-3`,
  'ginger-garlic-paste': `${local('ginger-garlic-paste')}?v=heritage-3`,
  'karuveppilai-thokku': p('1172675'),
  'venthaya-thokku': `${local('venthaya-thokku')}?v=heritage-1`,
  'curry-leaves-thokku': `${local('curry-leaves-thokku')}?v=heritage-4`,
  'ginger-thokku': `${local('ginger-thokku')}?v=heritage-3`,
  'mango-ginger-thokku': `${local('mango-ginger-thokku')}?v=heritage-3`,
  'naatu-malli-thokku': `${local('naatu-malli-thokku')}?v=heritage-3`,
  'nutmeg-jaathikai-thokku': `${local('nutmeg-jaathikai-thokku')}?v=heritage-3`,
  'pirandai-thokku': `${local('pirandai-thokku')}?v=heritage-3`,
  'pulikaichal': `${local('pulikaichal')}?v=heritage-1`,
  'small-onion-thokku': `${local('small-onion-thokku')}?v=heritage-3`,
  'sprouted-venthayam-thokku': `${local('sprouted-venthayam-thokku')}?v=heritage-3`,
  'vaazhaipoo-thokku': `${local('vaazhaipoo-thokku')}?v=heritage-3`,
  'vallarai-thokku': `${local('vallarai-thokku')}?v=heritage-4`,
  'vatha-kuzhambu-paste': `${local('vatha-kuzhambu-paste')}?v=heritage-4`,

  // ── Spice powders & masalas ────────────────────────────────────────────────
  'chilli-powder': `${local('chilli-powder')}?v=heritage-2`,
  'turmeric-powder': `${local('turmeric-powder')}?v=heritage-3`,
  'coriander-powder': `${local('coriander-powder')}?v=heritage-2`,
  'cumin-powder': `${local('cumin-powder')}?v=heritage-2`,
  'garam-masala': local('garam-masala'),
  'sambar-powder': `${local('sambar-powder')}?v=heritage-1`,
  'rasam-powder': `${local('rasam-powder')}?v=heritage-2`,
  'briyani-masala': `${local('briyani-masala')}?v=heritage-2`,
  'chat-masala': local('chat-masala'),
  'kulambu-chilli-powder': `${local('kulambu-chilli-powder')}?v=heritage-2`,
  'paneer-butter-masala': u('photo-1631452180519-c014fe946bc7'),
  'peri-peri-snack-seasoning': `${local('peri-peri-snack-seasoning')}?v=heritage-2`,

  // ── Sweets & savouries ─────────────────────────────────────────────────────
  'athirasam': `${local('athirasam')}?v=heritage-4`,
  'mysore-pak': `${local('mysore-pak')}?v=heritage-4`,
  'murukku': `${local('murukku')}?v=heritage-4`,
  'thattai': `${local('thattai')}?v=heritage-4`,
}

/** @deprecated Kept empty — catalog products must never use the photo-required placeholder. */
export const productImageRequiresOriginal = {}

/** Last-resort technical asset only — must not be assigned to any of the 59 catalog SKUs. */
export const PHOTO_REQUIRED_PLACEHOLDER = '/catalog/_photo-required.svg'

/** Resolve image URL for a slug. Always returns a real catalog hero for known SKUs. */
export function resolveProductImage(slug) {
  if (productImages[slug]) return productImages[slug]
  console.warn(`[product-images] Missing map entry for slug "${slug}"`)
  return PHOTO_REQUIRED_PLACEHOLDER
}

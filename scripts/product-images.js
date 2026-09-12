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
  'idiyappam-meal': local('idiyappam-meal'),

  // ── Handmade soaps ─────────────────────────────────────────────────────────
  'hibiscus-soap': local('hibiscus-soap'),
  'kasthuri-manjal-soap': local('kasthuri-manjal-soap'),
  'kuppaimeni-soap': local('kuppaimeni-soap'),
  'multanimitti-soap': local('multanimitti-soap'),
  'sweet-basil-soap': local('sweet-basil-soap'),
  'vettiver-soap': local('vettiver-soap'),

  // ── Health & wellness ──────────────────────────────────────────────────────
  'multimillet-muesli': local('multimillet-muesli'),
  'beetroot-nutrimix': p('244393'),
  'healthmix': u('photo-1498837167922-ddd27525d352'),

  // ── Idli podi ──────────────────────────────────────────────────────────────
  'idli-podi-regular': local('idli-podi-regular'),
  'ellu-idli-podi': p('4110251'),
  'karuveppilai-idli-podi': u('photo-1596040033229-a9821ebd058d'),
  'murungai-idli-podi': p('2255935'),
  'paruppu-podi': u('photo-1586201375761-83865001e31c'),

  // ── Seasonings ─────────────────────────────────────────────────────────────
  'cream-onion-powder': u('photo-1508747703725-719777637510'),
  'noodles-masala': u('photo-1569718212165-3a8278d5f624'),
  'pasta-seasoning': u('photo-1621996346565-e3dbc646d9a9'),
  'peri-peri-seasoning': u('photo-1604908176997-125f25cc6f3d'),

  // ── Native rice ────────────────────────────────────────────────────────────
  // Local karuppu file was mislabeled; keep earlier working Unsplash rice hero.
  'karuppu-kavuni-rice': u('photo-1536304993881-ff6e9eefa2a6'),
  'kullakar-rice': local('kullakar-rice'),
  'mappillai-samba-rice': p('723198'),
  'security-test-product-prod': u('photo-1516684669134-de6f7c473a2a'),

  // ── Pickles & thokku / pastes ───────────────────────────────────────────────
  'vadu-maangai-pickle': local('vadu-maangai-pickle'),
  'vadu-maanga-thokku': local('vadu-maanga-thokku'),
  'tomato-thokku': local('tomato-thokku'),
  'mango-thokku': local('mango-thokku'),
  'garlic-sweet-hot-pickle': local('garlic-sweet-hot-pickle'),
  // Unbranded ingredients shot (replaced Spice Nest jar); ?v= busts old branded cache
  'ginger-garlic-paste': `${local('ginger-garlic-paste')}?v=2`,
  'karuveppilai-thokku': p('1172675'),
  'venthaya-thokku': p('2802527'),
  'curry-leaves-thokku': p('4198023'),
  'ginger-thokku': u('photo-1576045057995-568f588f82fb'),
  'mango-ginger-thokku': u('photo-1605027990121-cbae9e0642df'),
  'naatu-malli-thokku': u('photo-1506368249639-73a05d6f6488'),
  'nutmeg-jaathikai-thokku': p('1435904'),
  'pirandai-thokku':
    'https://upload.wikimedia.org/wikipedia/commons/a/a3/Amla_Pickles.jpg',
  'pulikaichal': u('photo-1585937421612-70a008356fbe'),
  'small-onion-thokku': u('photo-1518977676601-b53f82aba655'),
  'sprouted-venthayam-thokku': u('photo-1515543904379-3d757afe72e4'),
  'vaazhaipoo-thokku': u('photo-1571771894821-ce9b6c11b08e'),
  'vallarai-thokku': p('1656663'),
  'vatha-kuzhambu-paste': u('photo-1565557623262-b51c2513a641'),

  // ── Spice powders & masalas ────────────────────────────────────────────────
  'chilli-powder': local('chilli-powder'),
  'turmeric-powder': local('turmeric-powder'),
  // Unbranded powder shots (replaced Quityfress packets); ?v= busts old branded cache
  'coriander-powder': `${local('coriander-powder')}?v=2`,
  'cumin-powder': `${local('cumin-powder')}?v=2`,
  'garam-masala': local('garam-masala'),
  'sambar-powder': local('sambar-powder'),
  'rasam-powder': local('rasam-powder'),
  'briyani-masala': local('briyani-masala'),
  'chat-masala': local('chat-masala'),
  'kulambu-chilli-powder': local('kulambu-chilli-powder'),
  'paneer-butter-masala': u('photo-1631452180519-c014fe946bc7'),
  'peri-peri-snack-seasoning': p('4198021'),

  // ── Sweets & savouries ─────────────────────────────────────────────────────
  'athirasam': local('athirasam'),
  'mysore-pak': local('mysore-pak'),
  'murukku': local('murukku'),
  'thattai': local('thattai'),
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

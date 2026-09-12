/**
 * seed-products.js
 * SV HUB — Phase 1.7 Canonical 37-Product Catalog & Category Seeder
 *
 * Seeds:
 *  1. The 4 canonical categories:
 *     - Pickles & Thokku (pickles-thokku)
 *     - Spice Powders & Masalas (spice-powders-masalas)
 *     - Idli Podi (idli-podi)
 *     - Health & Wellness (health-wellness)
 *  2. Exactly the 37 canonical products with deterministic slugs, SKUs, and variants.
 *  3. Deactivates any legacy/mock products so the active catalog contains exactly 37 products.
 *
 * Run: node scripts/seed-products.js
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { Product } from '../src/models/Product.js'
import { Category } from '../src/models/Category.js'
import { resolveProductImage } from './product-images.js'

const MONGO_URI = process.env.MONGO_URI
const MONGO_DB = process.env.MONGO_DB || 'svhub'

if (!MONGO_URI) {
  console.error('Missing MONGO_URI in environment')
  process.exit(1)
}

// ─── Verified Image CDN Assets ───────────────────────────────────────────────
const pexels = (id, w) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`
const unsplash = (id, w) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`

const img = {
  pickles: 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Amla_Pickles.jpg',
  spices: pexels('2802527', 1200),
  podi: pexels('4110256', 1000),
  wellness: pexels('14132109', 1200),
  cooking: pexels('14132109', 1200),
  farmland: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A_colorful_Paddy_field.JPG/1280px-A_colorful_Paddy_field.JPG',
}

// ─── 1. Canonical Categories (4) ─────────────────────────────────────────────
const canonicalCategories = [
  {
    name: 'Pickles & Thokku',
    slug: 'pickles-thokku',
    storefront: 'nutri-hub',
    description: 'Authentic traditional pickles, slow-cooked thokkus, and savory pastes prepared with heirloom recipes.',
    image: img.pickles,
    active: true,
    sortOrder: 1,
  },
  {
    name: 'Spice Powders & Masalas',
    slug: 'spice-powders-masalas',
    storefront: 'nutri-hub',
    description: 'Pure, aromatic stone-ground spice powders and authentic daily meal masalas crafted without artificial additives.',
    image: img.spices,
    active: true,
    sortOrder: 2,
  },
  {
    name: 'Idli Podi',
    slug: 'idli-podi',
    storefront: 'nutri-hub',
    description: 'Handcrafted traditional idli podis and roasted lentil powders blended with aromatic spices and cold-pressed oils.',
    image: img.podi,
    active: true,
    sortOrder: 3,
  },
  {
    name: 'Health & Wellness',
    slug: 'health-wellness',
    storefront: 'nutri-hub',
    description: 'Wholesome native multi-millet mixes, nutrimixes, and heritage porridge blends for everyday vitality.',
    image: img.wellness,
    active: true,
    sortOrder: 4,
  },
  {
    name: 'Native Rice',
    slug: 'native-rice',
    storefront: 'nutri-hub',
    description: 'Indigenous grains grown with care for everyday pots of rice, kanji and festive meals.',
    image: img.farmland,
    active: true,
    sortOrder: 5,
  },
  {
    name: 'Handmade Soaps',
    slug: 'handmade-soaps',
    storefront: 'self-care',
    description: 'Herbal soaps made by hand with traditional ingredients for everyday care.',
    image: img.wellness,
    active: true,
    sortOrder: 6,
  },
  {
    name: 'Traditional Sweets',
    slug: 'sweets',
    storefront: 'nutri-hub',
    description: 'Time-honoured sweets made in small batches with native ingredients.',
    image: img.cooking,
    active: true,
    sortOrder: 7,
  },
  {
    name: 'Traditional Savouries',
    slug: 'savouries',
    storefront: 'nutri-hub',
    description: 'Crisp, homemade-style snacks for tea-time and everyday sharing.',
    image: img.cooking,
    active: true,
    sortOrder: 8,
  },
  {
    name: 'Daily Meals',
    slug: 'daily-meals',
    storefront: 'nutri-hub',
    description: 'Wholesome prepared meals rooted in South Indian kitchens.',
    image: img.cooking,
    active: true,
    sortOrder: 9,
  },
]

// ─── Helper for product variants ─────────────────────────────────────────────
function makeVariants(prefix, price250, price500) {
  const v = [
    {
      variantId: '250g',
      label: '250g',
      weight: '250g',
      sku: `SVH-${prefix}-250G`,
      price: price250,
      originalPrice: price250,
      discount: 0,
      qty: 100,
      isActive: true,
    },
  ]
  if (price500) {
    v.push({
      variantId: '500g',
      label: '500g',
      weight: '500g',
      sku: `SVH-${prefix}-500G`,
      price: price500,
      originalPrice: price500,
      discount: 0,
      qty: 100,
      isActive: true,
    })
  }
  return v
}

// ─── 2. Canonical Products (37) ──────────────────────────────────────────────
const canonicalProducts = [
  // ── PICKLES / THOKKU / PASTES (1–17) ────────────────────────────────────────
  {
    name: 'VADU MAANGAI Pickle',
    slug: 'vadu-maangai-pickle',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Tender baby mangoes carefully steeped in sun-warmed spices and cold-pressed sesame oil. One spoonful. A whole lot of tradition.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 199,
    weight: '250g',
    sku: 'SVH-VMP-250G',
    qty: 100,
    isFeatured: true,
    specifications: [
      { label: 'How to Enjoy', value: 'Perfect accompaniment with hot curd rice, sambar sadham, or parathas.' },
      { label: 'Storage', value: 'Store in a cool, dry place. Use a dry spoon. Keep the oil layer intact.' },
      { label: 'Made for', value: 'Those who love real, authentic traditional flavours.' },
    ],
    variants: makeVariants('VMP', 199, 369),
  },
  {
    name: 'TOMATO THOKKU',
    slug: 'tomato-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Farm-ripe country tomatoes slow-simmered with cold-pressed sesame oil, mustard, and fragrant spices to a rich, luscious paste.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 169,
    weight: '250g',
    sku: 'SVH-TT-250G',
    qty: 100,
    isFeatured: true,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix with warm rice and ghee, or spread on dosas, idlis, and chapathis.' },
      { label: 'Storage', value: 'Store in a clean, airtight jar in a cool place.' },
      { label: 'Made for', value: 'Those who love real, home-style tomato flavours.' },
    ],
    variants: makeVariants('TT', 169, 319),
  },
  {
    name: 'CURRY LEAVES THOKKU',
    slug: 'curry-leaves-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Hand-harvested fresh curry leaves stone-ground and gently cooked with tamarind, jaggery, and aromatic spices.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 179,
    weight: '250g',
    sku: 'SVH-CLT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Stir into hot steamed rice with sesame oil, or pair with crispy dosas.' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry pantry.' },
      { label: 'Made for', value: 'Those who love wholesome herb-infused flavours.' },
    ],
    variants: makeVariants('CLT', 179, 329),
  },
  {
    name: 'VALLARAI THOKKU',
    slug: 'vallarai-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Traditional Brahmi (Vallarai) greens carefully prepared with country tamarind, red chillies, and cold-pressed oil.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 199,
    weight: '250g',
    sku: 'SVH-VT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix directly with warm rice and a dollop of fresh butter or ghee.' },
      { label: 'Storage', value: 'Store in an airtight jar away from direct sunlight.' },
      { label: 'Made for', value: 'Heirloom herb lovers seeking authentic South Indian preparation.' },
    ],
    variants: makeVariants('VT', 199, 369),
  },
  {
    name: 'VATHA KUZHAMBU PASTE',
    slug: 'vatha-kuzhambu-paste',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Rich, tangy tamarind paste seasoned with sun-dried turkey berry (sundakkai) and manathakkali for instant traditional vatha kuzhambu.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 199,
    weight: '250g',
    sku: 'SVH-VKP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Dissolve in hot water, simmer with veggies or turkey berries, and serve with rice.' },
      { label: 'Storage', value: 'Keep refrigerated after opening for longest freshness.' },
      { label: 'Made for', value: 'Comfort food lovers craving authentic grandmother-style kuzhambu.' },
    ],
    variants: makeVariants('VKP', 199, 369),
  },
  {
    name: 'NAATU MALLI THOKKU',
    slug: 'naatu-malli-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Country coriander seeds and fresh green coriander leaves slow-cooked with tamarind and mild spices.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 189,
    weight: '250g',
    sku: 'SVH-NMT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix with warm rice or use as a fragrant condiment with upma and idlis.' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry area.' },
      { label: 'Made for', value: 'Those who appreciate deep herbal aromas.' },
    ],
    variants: makeVariants('NMT', 189, 349),
  },
  {
    name: 'PIRANDAI THOKKU',
    slug: 'pirandai-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Tender adamantine creeper (Pirandai) thoroughly cleaned and slow-cooked in sesame oil to balance natural tangy warmth.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 199,
    weight: '250g',
    sku: 'SVH-PT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix with warm rice and sesame oil for traditional meal beginnings.' },
      { label: 'Storage', value: 'Use a dry spoon; store away from moisture.' },
      { label: 'Made for', value: 'Those seeking heritage native plant delicacies.' },
    ],
    variants: makeVariants('PT', 199, 369),
  },
  {
    name: 'SPROUTED VENTHAYAM THOKKU',
    slug: 'sprouted-venthayam-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Sprouted whole fenugreek seeds gently braised in tamarind, jaggery, and sesame oil, turning slight bitterness into savory depth.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 189,
    weight: '250g',
    sku: 'SVH-SVT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Classic side for cooling curd rice and soft idlis.' },
      { label: 'Storage', value: 'Keep tightly sealed in a cool pantry.' },
      { label: 'Made for', value: 'Those who love authentic bittersweet South Indian relishes.' },
    ],
    variants: makeVariants('SVT', 189, 349),
  },
  {
    name: 'VAAZHAIPOO THOKKU',
    slug: 'vaazhaipoo-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Fresh banana blossoms meticulously cleaned and slow-simmered with heritage spices for a unique earthy taste.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 199,
    weight: '250g',
    sku: 'SVH-VPT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Blend with warm rice and ghee or enjoy with chapathis.' },
      { label: 'Storage', value: 'Store in an airtight jar in a cool spot.' },
      { label: 'Made for', value: 'Lovers of traditional Tamil banana flower delicacies.' },
    ],
    variants: makeVariants('VPT', 199, 369),
  },
  {
    name: 'GINGER THOKKU',
    slug: 'ginger-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Fresh zesty ginger minced fine and cooked with spicy red chillies, tamarind pulp, and jaggery in cold-pressed oil.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 179,
    weight: '250g',
    sku: 'SVH-GT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Ideal pairing with pesarattu, adai, idli, or warm rice.' },
      { label: 'Storage', value: 'Store in a dry glass jar.' },
      { label: 'Made for', value: 'Ginger enthusiasts craving zesty warmth.' },
    ],
    variants: makeVariants('GT', 179, 329),
  },
  {
    name: 'NUTMEG / JAATHIKAI THOKKU',
    slug: 'nutmeg-jaathikai-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Rare traditional preserve prepared from fresh nutmeg rind simmered in aromatic spices and cold-pressed oil.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 219,
    weight: '250g',
    sku: 'SVH-NJT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'A tiny spoonful with hot rice and ghee or cooling curd rice.' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place.' },
      { label: 'Made for', value: 'Adventurous palates seeking rare heritage recipes.' },
    ],
    variants: makeVariants('NJT', 219, 399),
  },
  {
    name: 'GARLIC SWEET & HOT PICKLE',
    slug: 'garlic-sweet-hot-pickle',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Peeled country garlic cloves bathed in jaggery syrup, fiery red chillies, and mustard-infused cold-pressed oil.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 189,
    weight: '250g',
    sku: 'SVH-GSHP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Pairs wonderfully with stuffed parathas, curd rice, or khichdi.' },
      { label: 'Storage', value: 'Keep tightly closed with an oil seal.' },
      { label: 'Made for', value: 'Garlic lovers who adore a sweet-and-spicy balance.' },
    ],
    variants: makeVariants('GSHP', 189, 349),
  },
  {
    name: 'MANGO GINGER THOKKU',
    slug: 'mango-ginger-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Aromatic mango ginger (Maa Inji) freshly grated and preserved with lemon, mild spices, and sesame oil.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 179,
    weight: '250g',
    sku: 'SVH-MGT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'The ultimate refreshing side for curd rice and lemon rice.' },
      { label: 'Storage', value: 'Store in an airtight container.' },
      { label: 'Made for', value: 'Those who love the fresh raw-mango aroma of tender ginger.' },
    ],
    variants: makeVariants('MGT', 179, 329),
  },
  {
    name: 'MANGO THOKKU',
    slug: 'mango-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Shredded raw country green mangoes cooked slowly with red chilli powder, roasted fenugreek, and gingelly oil.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 169,
    weight: '250g',
    sku: 'SVH-MT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'A timeless staple for dosas, poories, curd rice, and sandwiches.' },
      { label: 'Storage', value: 'Keep sealed in a cool place.' },
      { label: 'Made for', value: 'Classic pickle aficionados.' },
    ],
    variants: makeVariants('MT', 169, 319),
  },
  {
    name: 'PULIKAICHAL',
    slug: 'pulikaichal',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Temple-style concentrated tamarind paste simmered with roasted sesame, peanuts, chana dal, and curry leaves.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 189,
    weight: '250g',
    sku: 'SVH-PK-250G',
    qty: 100,
    isFeatured: true,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix directly with freshly cooked rice and a spoon of gingelly oil for instant Puliyodharai.' },
      { label: 'Storage', value: 'Keeps fresh for months in a cool, dry pantry.' },
      { label: 'Made for', value: 'Devotees of authentic temple puliyodharai flavours.' },
    ],
    variants: makeVariants('PK', 189, 349),
  },
  {
    name: 'SMALL ONION THOKKU',
    slug: 'small-onion-thokku',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Sweet South Indian shallots (chinna vengayam) caramelized gently in gingelly oil with spicy tamarind masala.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 199,
    weight: '250g',
    sku: 'SVH-SOT-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Irresistible with hot idlis, crispy dosas, or mixed with warm rice.' },
      { label: 'Storage', value: 'Keep airtight in a cool spot.' },
      { label: 'Made for', value: 'Shallot lovers who cherish caramelized richness.' },
    ],
    variants: makeVariants('SOT', 199, 369),
  },
  {
    name: 'GINGER GARLIC PASTE',
    slug: 'ginger-garlic-paste',
    type: 'Pickles & Thokku',
    storefront: 'nutri-hub',
    category: 'pickles-thokku',
    description: 'Fresh peeled ginger and country garlic crushed together with zero water, zero starch, and zero artificial preservatives.',
    image: img.pickles,
    gallery: [img.pickles, img.cooking],
    price: 149,
    weight: '250g',
    sku: 'SVH-GGP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Add to biryanis, curries, and marinades for pure home-ground aroma.' },
      { label: 'Storage', value: 'Refrigerate immediately after opening.' },
      { label: 'Made for', value: 'Home chefs who refuse chemical-laden commercial pastes.' },
    ],
    variants: makeVariants('GGP', 149, 279),
  },

  // ── SPICE POWDERS & EVERYDAY ESSENTIALS (18–29) ─────────────────────────────
  {
    name: 'Turmeric Powder',
    slug: 'turmeric-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Pure sun-dried Salem finger turmeric finely milled with high natural curcumin content and zero artificial coloring.',
    image: img.spices,
    gallery: [img.spices],
    price: 79,
    weight: '250g',
    sku: 'SVH-TP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Essential for everyday cooking, golden milk, and daily seasoning.' },
      { label: 'Storage', value: 'Keep sealed in an airtight spice container.' },
      { label: 'Made for', value: 'Purity seekers wanting single-origin heirloom turmeric.' },
    ],
    variants: makeVariants('TP', 79, 149),
  },
  {
    name: 'Chilli Powder',
    slug: 'chilli-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Sun-dried premium whole red chillies pounded to a vibrant red powder with well-rounded heat and smoky aroma.',
    image: img.spices,
    gallery: [img.spices],
    price: 89,
    weight: '250g',
    sku: 'SVH-CP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Add to gravies, roasts, and marinades for rich color and authentic heat.' },
      { label: 'Storage', value: 'Store in a dry, airtight jar.' },
      { label: 'Made for', value: 'Those who demand unadulterated fiery spice.' },
    ],
    variants: makeVariants('CP', 89, 169),
  },
  {
    name: 'Coriander Powder',
    slug: 'coriander-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Slow-roasted whole coriander seeds pulverized to capture delicate citrusy notes and warm herbal aroma.',
    image: img.spices,
    gallery: [img.spices],
    price: 89,
    weight: '250g',
    sku: 'SVH-CORP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Forms the foundational base for curries, rasams, and stews.' },
      { label: 'Storage', value: 'Keep away from moisture in a sealed container.' },
      { label: 'Made for', value: 'Everyday cooks seeking aromatic depth.' },
    ],
    variants: makeVariants('CORP', 89, 169),
  },
  {
    name: 'Sambar Powder',
    slug: 'sambar-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Heirloom South Indian recipe roasted with coriander, red chillies, toor dal, chana dal, cumin, fenugreek, and asafoetida.',
    image: img.spices,
    gallery: [img.spices],
    price: 119,
    weight: '250g',
    sku: 'SVH-SP-250G',
    qty: 100,
    isFeatured: true,
    specifications: [
      { label: 'How to Enjoy', value: 'Add 2 tablespoons to boiling lentils and vegetables for traditional aromatic sambar.' },
      { label: 'Storage', value: 'Store in an airtight container.' },
      { label: 'Made for', value: 'Authentic South Indian lunch lovers.' },
    ],
    variants: makeVariants('SP', 119, 229),
  },
  {
    name: 'Rasam Powder',
    slug: 'rasam-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Crushed black pepper, cumin, coriander, and red chillies proportioned for comforting, piping-hot South Indian rasam.',
    image: img.spices,
    gallery: [img.spices],
    price: 119,
    weight: '250g',
    sku: 'SVH-RP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Simmer with crushed tomatoes, garlic, tamarind, and fresh coriander.' },
      { label: 'Storage', value: 'Airtight storage preserves peppery aroma.' },
      { label: 'Made for', value: 'Soothing meal beginnings and comfort soups.' },
    ],
    variants: makeVariants('RP', 119, 229),
  },
  {
    name: 'Paneer Butter Masala',
    slug: 'paneer-butter-masala',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'A creamy, fragrant spice blend balanced with Kashmiri chilli, cardamom, mace, and kasuri methi for restaurant-style curries.',
    image: img.spices,
    gallery: [img.spices],
    price: 139,
    weight: '250g',
    sku: 'SVH-PBM-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Simmer with tomato-cashew gravy and paneer cubes for an indulgent dinner.' },
      { label: 'Storage', value: 'Seal tightly after opening.' },
      { label: 'Made for', value: 'Family feasts and rich vegetable gravies.' },
    ],
    variants: makeVariants('PBM', 139, 259),
  },
  {
    name: 'Peri Peri Snack Seasoning',
    slug: 'peri-peri-snack-seasoning',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Zesty, tangy, spicy seasoning crafted with African bird’s eye chillies, garlic powder, herbs, and lemon crystals.',
    image: img.spices,
    gallery: [img.spices],
    price: 129,
    weight: '250g',
    sku: 'SVH-PPSS-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Dust over fresh french fries, popcorn, roasted nuts, or grilled veggies.' },
      { label: 'Storage', value: 'Keep in a dry shaker jar.' },
      { label: 'Made for', value: 'Snack lovers wanting bold punchy flavor.' },
    ],
    variants: makeVariants('PPSS', 129, 239),
  },
  {
    name: 'Chat Masala',
    slug: 'chat-masala',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Tangy, peppery blend of amchur (dry mango), black salt, roasted cumin, and mint for irresistible street-food zest.',
    image: img.spices,
    gallery: [img.spices],
    price: 109,
    weight: '250g',
    sku: 'SVH-CM-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Sprinkle over sliced fruits, chaats, salads, lemonades, or roasted snacks.' },
      { label: 'Storage', value: 'Keep moisture-free in an airtight jar.' },
      { label: 'Made for', value: 'Anyone craving a tangy burst of flavor.' },
    ],
    variants: makeVariants('CM', 109, 199),
  },
  {
    name: 'Kulambu Chilli Powder',
    slug: 'kulambu-chilli-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'All-in-one South Indian curry powder blended with dry red chillies, coriander, cumin, pepper, and lentils.',
    image: img.spices,
    gallery: [img.spices],
    price: 119,
    weight: '250g',
    sku: 'SVH-KCP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'One powder for fish curry, vegetable kuzhambu, kara kuzhambu, and gravies.' },
      { label: 'Storage', value: 'Keep in a sealed container.' },
      { label: 'Made for', value: 'Effortless authentic daily curry preparations.' },
    ],
    variants: makeVariants('KCP', 119, 229),
  },
  {
    name: 'Garam Masala',
    slug: 'garam-masala',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Small-batch royal spice mix of cloves, cinnamon, green cardamom, black cardamom, star anise, nutmeg, and bay leaves.',
    image: img.spices,
    gallery: [img.spices],
    price: 129,
    weight: '250g',
    sku: 'SVH-GM-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'A pinch towards the end of cooking infuses warmth and regal aroma.' },
      { label: 'Storage', value: 'Store away from heat in an airtight container.' },
      { label: 'Made for', value: 'Those who appreciate deep, nuanced spice warmth.' },
    ],
    variants: makeVariants('GM', 129, 249),
  },
  {
    name: 'Briyani Masala',
    slug: 'briyani-masala',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Whole aromatic spices stone-ground for rich dum biryanis, pulaos, and celebratory rice dishes.',
    image: img.spices,
    gallery: [img.spices],
    price: 139,
    weight: '250g',
    sku: 'SVH-BM-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Layer with seeradhasamba or basmati rice for fragrant Sunday biryanis.' },
      { label: 'Storage', value: 'Store sealed in a cool, dry place.' },
      { label: 'Made for', value: 'Biryani perfectionists.' },
    ],
    variants: makeVariants('BM', 139, 259),
  },
  {
    name: 'Cumin Powder',
    slug: 'cumin-powder',
    type: 'Spice Powders & Masalas',
    storefront: 'nutri-hub',
    category: 'spice-powders-masalas',
    description: 'Lightly dry-roasted whole cumin seeds crushed into a fine, nutty, aromatic powder.',
    image: img.spices,
    gallery: [img.spices],
    price: 99,
    weight: '250g',
    sku: 'SVH-CUMP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Stir into raitas, buttermilk, dals, and vegetable stir-fries.' },
      { label: 'Storage', value: 'Keep sealed in an airtight container.' },
      { label: 'Made for', value: 'Everyday seasoning and digestive drinks.' },
    ],
    variants: makeVariants('CUMP', 99, 189),
  },

  // ── IDLI PODI (30–34) ───────────────────────────────────────────────────────
  {
    name: 'Idli Podi – Regular',
    slug: 'idli-podi-regular',
    type: 'Idli Podi',
    storefront: 'nutri-hub',
    category: 'idli-podi',
    description: 'The quintessential Tamil Nadu gunpowder. Roasted urad dal, chana dal, sesame seeds, and dried red chillies ground to a coarse crunchy perfection.',
    image: img.podi,
    gallery: [img.podi],
    price: 119,
    weight: '250g',
    sku: 'SVH-IPR-250G',
    qty: 100,
    isFeatured: true,
    specifications: [
      { label: 'How to Enjoy', value: 'Generously mix with hot sesame oil or melted ghee and dip soft steamed idlis.' },
      { label: 'Storage', value: 'Store in an airtight container away from moisture.' },
      { label: 'Made for', value: 'Every morning breakfast table.' },
    ],
    variants: makeVariants('IPR', 119, 229),
  },
  {
    name: 'Paruppu Podi',
    slug: 'paruppu-podi',
    type: 'Idli Podi',
    storefront: 'nutri-hub',
    category: 'idli-podi',
    description: 'Gentle golden blend of roasted toor dal, roasted gram, cumin, pepper, and garlic for soothing rice beginnings.',
    image: img.podi,
    gallery: [img.podi],
    price: 129,
    weight: '250g',
    sku: 'SVH-PP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix with piping hot rice and fresh ghee before every meal.' },
      { label: 'Storage', value: 'Store in a dry airtight jar.' },
      { label: 'Made for', value: 'Comforting, protein-rich family meal starters.' },
    ],
    variants: makeVariants('PP', 129, 249),
  },
  {
    name: 'Murungai Idli Podi',
    slug: 'murungai-idli-podi',
    type: 'Idli Podi',
    storefront: 'nutri-hub',
    category: 'idli-podi',
    description: 'Sun-dried fresh drumstick leaves (moringa) roasted alongside traditional lentils, red chillies, and aromatic garlic.',
    image: img.podi,
    gallery: [img.podi],
    price: 139,
    weight: '250g',
    sku: 'SVH-MIP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Smear on dosas with ghee or sprinkle over hot idlis for a nutrient-rich crunch.' },
      { label: 'Storage', value: 'Keep sealed in an airtight jar.' },
      { label: 'Made for', value: 'Those wanting the goodness of moringa in their daily breakfast.' },
    ],
    variants: makeVariants('MIP', 139, 269),
  },
  {
    name: 'Karuveppilai Idli Podi',
    slug: 'karuveppilai-idli-podi',
    type: 'Idli Podi',
    storefront: 'nutri-hub',
    category: 'idli-podi',
    description: 'Fragrant fresh curry leaves slow-roasted with black pepper, urad dal, and red chillies into an intensely aromatic green podi.',
    image: img.podi,
    gallery: [img.podi],
    price: 139,
    weight: '250g',
    sku: 'SVH-KIP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Mix with gingelly oil and pair with idlis, dosas, or toss with roasted baby potatoes.' },
      { label: 'Storage', value: 'Keep sealed in a cool, dry place.' },
      { label: 'Made for', value: 'Herbal podi lovers seeking iron-rich morning meals.' },
    ],
    variants: makeVariants('KIP', 139, 269),
  },
  {
    name: 'Ellu Idli Podi',
    slug: 'ellu-idli-podi',
    type: 'Idli Podi',
    storefront: 'nutri-hub',
    category: 'idli-podi',
    description: 'Nutty roasted black and white sesame seeds ground with roasted lentils, red chillies, and asafoetida.',
    image: img.podi,
    gallery: [img.podi],
    price: 129,
    weight: '250g',
    sku: 'SVH-EIP-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Serve with dosas, idlis, or mix into warm rice with sesame oil.' },
      { label: 'Storage', value: 'Airtight storage keeps sesame oils aromatic.' },
      { label: 'Made for', value: 'Sesame seed enthusiasts who love nutty depth.' },
    ],
    variants: makeVariants('EIP', 129, 249),
  },

  // ── HEALTH & WELLNESS (35–37) ───────────────────────────────────────────────
  {
    name: 'Multimillet Muesli',
    slug: 'multimillet-muesli',
    type: 'Health & Wellness',
    storefront: 'nutri-hub',
    category: 'health-wellness',
    description: 'Wholesome breakfast blend of roasted ragi, foxtail, barnyard, and kodo millet flakes with dry fruits and native seeds.',
    image: img.wellness,
    gallery: [img.wellness],
    price: 229,
    weight: '250g',
    sku: 'SVH-MMM-250G',
    qty: 100,
    isFeatured: true,
    specifications: [
      { label: 'How to Enjoy', value: 'Soak in warm milk or curd with fresh fruits and raw honey.' },
      { label: 'Storage', value: 'Keep in an airtight jar in a cool pantry.' },
      { label: 'Made for', value: 'Health-conscious families seeking nourishing grain breakfasts.' },
    ],
    variants: makeVariants('MMM', 229, 439),
  },
  {
    name: 'Beetroot Nutrimix',
    slug: 'beetroot-nutrimix',
    type: 'Health & Wellness',
    storefront: 'nutri-hub',
    category: 'health-wellness',
    description: 'Dehydrated farm-fresh beetroot powder blended with sprouted millets, almonds, cashews, cardamom, and palm sugar.',
    image: img.wellness,
    gallery: [img.wellness],
    price: 249,
    weight: '250g',
    sku: 'SVH-BN-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Stir 2 spoons into warm milk for a naturally vibrant pink health drink.' },
      { label: 'Storage', value: 'Keep sealed in a dry container.' },
      { label: 'Made for', value: 'Kids and adults wanting a natural malt drink alternative.' },
    ],
    variants: makeVariants('BN', 249, 479),
  },
  {
    name: 'Healthmix',
    slug: 'healthmix',
    type: 'Health & Wellness',
    storefront: 'nutri-hub',
    category: 'health-wellness',
    description: 'Traditional sathu maavu blend containing sprouted millets, pulses, cereals, nuts, dry ginger, and cardamom.',
    image: img.wellness,
    gallery: [img.wellness],
    price: 219,
    weight: '250g',
    sku: 'SVH-HM-250G',
    qty: 100,
    isFeatured: false,
    specifications: [
      { label: 'How to Enjoy', value: 'Cook into porridge with water/milk and sweeten with jaggery or enjoy savory with buttermilk.' },
      { label: 'Storage', value: 'Store in an airtight container.' },
      { label: 'Made for', value: 'Generations of wholesome morning nourishment.' },
    ],
    variants: makeVariants('HM', 219, 419),
  },
]

// Prefer curated unique heroes so re-seeds do not restore shared placeholders
for (const product of canonicalProducts) {
  const image = resolveProductImage(product.slug)
  product.image = image
  product.gallery = [image]
}

// ─── Main Execution ──────────────────────────────────────────────────────────
async function main() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.7 SEED CANONICAL 37 PRODUCTS & 4 CATEGORIES')
  console.log('====================================================\n')

  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB })
  console.log(`Connected to MongoDB database: ${MONGO_DB}`)

  // 1. Seed Categories
  console.log('\n--- 1. Seeding 4 Canonical Categories ---')
  let categoriesCreated = 0
  let categoriesUpdated = 0

  for (const cat of canonicalCategories) {
    const existing = await Category.findOne({ slug: cat.slug })
    if (existing) {
      await Category.updateOne({ slug: cat.slug }, { $set: cat })
      categoriesUpdated++
      console.log(`[UPDATED] Category: ${cat.name} (${cat.slug})`)
    } else {
      await Category.create(cat)
      categoriesCreated++
      console.log(`[CREATED] Category: ${cat.name} (${cat.slug})`)
    }
  }

  // 2. Seed Canonical Products
  console.log('\n--- 2. Seeding 37 Canonical Products ---')
  let productsCreated = 0
  let productsUpdated = 0
  const canonicalSlugs = new Set(canonicalProducts.map((p) => p.slug))

  for (const prod of canonicalProducts) {
    const existing = await Product.findOne({ slug: prod.slug })
    if (existing) {
      await Product.updateOne({ slug: prod.slug }, { $set: { ...prod, isActive: true } })
      productsUpdated++
      console.log(`[UPDATED] Product: ${prod.name} (${prod.slug})`)
    } else {
      await Product.create({ ...prod, isActive: true })
      productsCreated++
      console.log(`[CREATED] Product: ${prod.name} (${prod.slug})`)
    }
  }

  // 3. Ensure all catalog products remain active
  console.log('\n--- 3. Verifying Catalog Products ---')

  // 4. Summary Verification
  const activeProducts = await Product.countDocuments({ isActive: true })
  const activeCategories = await Category.countDocuments({ active: true })
  const totalProductsInDb = await Product.countDocuments({})

  console.log('\n====================================================')
  console.log('MIGRATION SUMMARY:')
  console.log(`- Categories created/updated: ${categoriesCreated + categoriesUpdated} (Active: ${activeCategories})`)
  console.log(`- Products created/updated: ${productsCreated + productsUpdated}`)
  console.log(`- Total products in DB: ${totalProductsInDb}`)
  console.log(`- FINAL ACTIVE PRODUCT COUNT: ${activeProducts}`)
  console.log('====================================================\n')

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

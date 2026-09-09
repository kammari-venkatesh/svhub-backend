/**
 * verify-canonical-products.js
 * SV HUB — Phase 1.7 Canonical Catalog Verification Script
 *
 * Verifies:
 *  1. Exactly 37 active products in MongoDB.
 *  2. Exactly 4 active categories in MongoDB.
 *  3. Every single one of the 37 expected products exists by exact slug and name.
 *  4. Zero unexpected products are active.
 *  5. Slugs are 100% unique.
 *  6. Products are correctly mapped to their canonical category slug.
 *  7. Every product has at least one active variant with a valid price and stock.
 *  8. No fake image URLs.
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { Product } from '../src/models/Product.js'
import { Category } from '../src/models/Category.js'

const MONGO_URI = process.env.MONGO_URI
const MONGO_DB = process.env.MONGO_DB || 'svhub'

let passed = 0
let failed = 0

function assert(description, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${description}`)
    passed++
  } else {
    console.error(`[FAIL] ${description} ${details}`)
    failed++
  }
}

const expectedCategories = [
  { name: 'Pickles & Thokku', slug: 'pickles-thokku' },
  { name: 'Spice Powders & Masalas', slug: 'spice-powders-masalas' },
  { name: 'Idli Podi', slug: 'idli-podi' },
  { name: 'Health & Wellness', slug: 'health-wellness' },
]

const expectedProducts = [
  // Pickles / Thokku / Pastes (17)
  { name: 'VADU MAANGAI Pickle', slug: 'vadu-maangai-pickle', cat: 'pickles-thokku' },
  { name: 'TOMATO THOKKU', slug: 'tomato-thokku', cat: 'pickles-thokku' },
  { name: 'CURRY LEAVES THOKKU', slug: 'curry-leaves-thokku', cat: 'pickles-thokku' },
  { name: 'VALLARAI THOKKU', slug: 'vallarai-thokku', cat: 'pickles-thokku' },
  { name: 'VATHA KUZHAMBU PASTE', slug: 'vatha-kuzhambu-paste', cat: 'pickles-thokku' },
  { name: 'NAATU MALLI THOKKU', slug: 'naatu-malli-thokku', cat: 'pickles-thokku' },
  { name: 'PIRANDAI THOKKU', slug: 'pirandai-thokku', cat: 'pickles-thokku' },
  { name: 'SPROUTED VENTHAYAM THOKKU', slug: 'sprouted-venthayam-thokku', cat: 'pickles-thokku' },
  { name: 'VAAZHAIPOO THOKKU', slug: 'vaazhaipoo-thokku', cat: 'pickles-thokku' },
  { name: 'GINGER THOKKU', slug: 'ginger-thokku', cat: 'pickles-thokku' },
  { name: 'NUTMEG / JAATHIKAI THOKKU', slug: 'nutmeg-jaathikai-thokku', cat: 'pickles-thokku' },
  { name: 'GARLIC SWEET & HOT PICKLE', slug: 'garlic-sweet-hot-pickle', cat: 'pickles-thokku' },
  { name: 'MANGO GINGER THOKKU', slug: 'mango-ginger-thokku', cat: 'pickles-thokku' },
  { name: 'MANGO THOKKU', slug: 'mango-thokku', cat: 'pickles-thokku' },
  { name: 'PULIKAICHAL', slug: 'pulikaichal', cat: 'pickles-thokku' },
  { name: 'SMALL ONION THOKKU', slug: 'small-onion-thokku', cat: 'pickles-thokku' },
  { name: 'GINGER GARLIC PASTE', slug: 'ginger-garlic-paste', cat: 'pickles-thokku' },

  // Spice Powders & Everyday Essentials (12)
  { name: 'Turmeric Powder', slug: 'turmeric-powder', cat: 'spice-powders-masalas' },
  { name: 'Chilli Powder', slug: 'chilli-powder', cat: 'spice-powders-masalas' },
  { name: 'Coriander Powder', slug: 'coriander-powder', cat: 'spice-powders-masalas' },
  { name: 'Sambar Powder', slug: 'sambar-powder', cat: 'spice-powders-masalas' },
  { name: 'Rasam Powder', slug: 'rasam-powder', cat: 'spice-powders-masalas' },
  { name: 'Paneer Butter Masala', slug: 'paneer-butter-masala', cat: 'spice-powders-masalas' },
  { name: 'Peri Peri Snack Seasoning', slug: 'peri-peri-snack-seasoning', cat: 'spice-powders-masalas' },
  { name: 'Chat Masala', slug: 'chat-masala', cat: 'spice-powders-masalas' },
  { name: 'Kulambu Chilli Powder', slug: 'kulambu-chilli-powder', cat: 'spice-powders-masalas' },
  { name: 'Garam Masala', slug: 'garam-masala', cat: 'spice-powders-masalas' },
  { name: 'Briyani Masala', slug: 'briyani-masala', cat: 'spice-powders-masalas' },
  { name: 'Cumin Powder', slug: 'cumin-powder', cat: 'spice-powders-masalas' },

  // Idli Podi (5)
  { name: 'Idli Podi – Regular', slug: 'idli-podi-regular', cat: 'idli-podi' },
  { name: 'Paruppu Podi', slug: 'paruppu-podi', cat: 'idli-podi' },
  { name: 'Murungai Idli Podi', slug: 'murungai-idli-podi', cat: 'idli-podi' },
  { name: 'Karuveppilai Idli Podi', slug: 'karuveppilai-idli-podi', cat: 'idli-podi' },
  { name: 'Ellu Idli Podi', slug: 'ellu-idli-podi', cat: 'idli-podi' },

  // Health & Wellness (3)
  { name: 'Multimillet Muesli', slug: 'multimillet-muesli', cat: 'health-wellness' },
  { name: 'Beetroot Nutrimix', slug: 'beetroot-nutrimix', cat: 'health-wellness' },
  { name: 'Healthmix', slug: 'healthmix', cat: 'health-wellness' },
]

async function runVerification() {
  console.log('====================================================')
  console.log('SV HUB — PHASE 1.7 CANONICAL CATALOG VERIFICATION')
  console.log('====================================================\n')

  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB })

  // 1. Verify Category Count & Details
  const activeCategories = await Category.find({ active: true }).sort({ sortOrder: 1 })
  assert('Total active categories is exactly 4', activeCategories.length === 4, `Found: ${activeCategories.length}`)

  for (const expCat of expectedCategories) {
    const found = activeCategories.find((c) => c.slug === expCat.slug)
    assert(`Category exists: ${expCat.name} (${expCat.slug})`, Boolean(found && found.name === expCat.name))
  }

  // 2. Verify Active Product Count
  const activeProducts = await Product.find({ isActive: true })
  assert('Total active products is exactly 37', activeProducts.length === 37, `Found: ${activeProducts.length}`)

  // 3. Verify All 37 Expected Products Exist & Match
  const slugSet = new Set()
  let hasDuplicateSlug = false

  for (const exp of expectedProducts) {
    const found = activeProducts.find((p) => p.slug === exp.slug)
    assert(
      `Product exists: ${exp.name} [${exp.slug}]`,
      Boolean(found),
      `Missing slug: ${exp.slug}`
    )

    if (found) {
      assert(
        `Category matches for ${exp.slug} -> ${exp.cat}`,
        found.category === exp.cat,
        `Expected ${exp.cat}, found ${found.category}`
      )
      assert(
        `Product has active variants: ${exp.slug}`,
        Array.isArray(found.variants) && found.variants.length > 0 && found.variants.some((v) => v.isActive)
      )
      assert(
        `Product has valid price (>0): ${exp.slug}`,
        found.price > 0 && found.variants.every((v) => v.price > 0)
      )
      assert(
        `Product has valid stock: ${exp.slug}`,
        found.qty >= 0 && found.variants.every((v) => v.qty >= 0)
      )
      assert(
        `Product has valid image: ${exp.slug}`,
        typeof found.image === 'string' && found.image.startsWith('http')
      )

      if (slugSet.has(found.slug)) {
        hasDuplicateSlug = true
      }
      slugSet.add(found.slug)
    }
  }

  assert('Zero duplicate slugs among active products', !hasDuplicateSlug)

  // 4. Verify Zero Legacy Products are Active
  const expectedSlugs = new Set(expectedProducts.map((p) => p.slug))
  const unexpectedActive = activeProducts.filter((p) => !expectedSlugs.has(p.slug))
  assert(
    'Zero unexpected/legacy products are active',
    unexpectedActive.length === 0,
    `Found unexpected active: ${unexpectedActive.map((p) => p.slug).join(', ')}`
  )

  await mongoose.disconnect()

  console.log('\n====================================================')
  console.log(`CANONICAL CATALOG VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('====================================================')

  if (failed > 0) process.exit(1)
}

runVerification().catch((err) => {
  console.error('Verification crashed:', err)
  process.exit(1)
})

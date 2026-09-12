/**
 * update-product-images.js
 * Sets each product to a unique, relevant professional hero image.
 * Gallery is [hero] only.
 *
 * Run: node scripts/update-product-images.js
 */

import 'dotenv/config'
import dns from 'node:dns'
import mongoose from 'mongoose'
import { Product } from '../src/models/Product.js'
import { productImages } from './product-images.js'

try {
  dns.setServers(['8.8.8.8', '1.1.1.1'])
} catch {
  // ignore
}

const MONGO_URI = process.env.MONGO_URI
const MONGO_DB = process.env.MONGO_DB || 'svhub'

if (!MONGO_URI) {
  console.error('Missing MONGO_URI in environment')
  process.exit(1)
}

const urls = Object.values(productImages)
const unique = new Set(urls)
if (unique.size !== urls.length) {
  console.error('product-images.js contains duplicate URLs')
  process.exit(1)
}

await mongoose.connect(MONGO_URI, { dbName: MONGO_DB })

let updated = 0
let missing = 0

for (const [slug, image] of Object.entries(productImages)) {
  const result = await Product.updateOne(
    { slug },
    { $set: { image, gallery: [image] } },
  )
  if (result.matchedCount === 0) {
    console.warn(`No product for slug: ${slug}`)
    missing += 1
  } else {
    updated += 1
    console.log(`✓ ${slug}`)
  }
}

const all = await Product.find({}, { slug: 1, image: 1 }).lean()
const uncovered = all.filter((p) => !productImages[p.slug])
if (uncovered.length) {
  console.warn(
    `\nProducts without curated images (${uncovered.length}):`,
    uncovered.map((p) => p.slug).join(', '),
  )
}

const imageCounts = new Map()
for (const p of all) {
  imageCounts.set(p.image, (imageCounts.get(p.image) || 0) + 1)
}
const dupes = [...imageCounts.entries()].filter(([, n]) => n > 1)
if (dupes.length) {
  console.warn(`\nDuplicate images still in DB: ${dupes.length} URL(s)`)
}

console.log(`\nUpdated ${updated} products. Missing map hits: ${missing}.`)
await mongoose.disconnect()

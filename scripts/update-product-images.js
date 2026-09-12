/**
 * update-product-images.js
 * Applies scripts/product-images.js to MongoDB Product.image + gallery.
 * Does not change names, prices, categories, descriptions, or variants.
 *
 * Run: node scripts/update-product-images.js
 */

import 'dotenv/config'
import dns from 'node:dns'
import mongoose from 'mongoose'
import { Product } from '../src/models/Product.js'
import {
  PHOTO_REQUIRED_PLACEHOLDER,
  productImages,
  resolveProductImage,
} from './product-images.js'

try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // ignore
}

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI
const MONGO_DB = process.env.MONGO_DB || 'svhub'

if (!MONGO_URI) {
  console.error('Missing MONGO_URI')
  process.exit(1)
}

await mongoose.connect(MONGO_URI, { dbName: MONGO_DB, family: 4 })

const products = await Product.find({}, { slug: 1, name: 1, image: 1 }).lean()
let applied = 0
let missingMap = 0
let placeholders = 0

for (const p of products) {
  const slug = p.slug
  const image = resolveProductImage(slug)
  if (!productImages[slug]) missingMap += 1
  if (image === PHOTO_REQUIRED_PLACEHOLDER) placeholders += 1

  await Product.updateOne({ slug }, { $set: { image, gallery: [image] } })
  applied += 1
  console.log(`✓ ${slug} → ${image}`)
}

console.log('\n---')
console.log(`Products in DB: ${products.length}`)
console.log(`Images applied: ${applied}`)
console.log(`Map size: ${Object.keys(productImages).length}`)
console.log(`Unmapped slugs: ${missingMap}`)
console.log(`Placeholders assigned: ${placeholders}`)

if (placeholders > 0 || missingMap > 0) {
  console.error('FAIL: every catalog product must have a real mapped image')
  await mongoose.disconnect()
  process.exit(1)
}

await mongoose.disconnect()

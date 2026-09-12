/**
 * One-shot: copy all collections from SOURCE MongoDB → DEST MongoDB.
 * Usage:
 *   SOURCE_MONGO_URI=... DEST_MONGO_URI=... node scripts/migrate-to-atlas.js
 */
import dns from 'node:dns'
import mongoose from 'mongoose'

try {
  dns.setServers(['8.8.8.8', '1.1.1.1'])
} catch {
  /* ignore */
}

const DB_NAME = process.env.MONGO_DB || 'svhub'
const SOURCE_URI = process.env.SOURCE_MONGO_URI
const DEST_URI = process.env.DEST_MONGO_URI

if (!SOURCE_URI || !DEST_URI) {
  console.error('Need SOURCE_MONGO_URI and DEST_MONGO_URI')
  process.exit(1)
}

function mask(uri = '') {
  return uri.replace(/\/\/(.*?)@/, '//***:***@')
}

async function copyCollection(sourceDb, destDb, name) {
  const docs = await sourceDb.collection(name).find({}).toArray()
  const destCol = destDb.collection(name)
  await destCol.deleteMany({})
  if (docs.length === 0) {
    console.log(`  ${name}: 0 docs (cleared dest)`)
    return { name, count: 0 }
  }
  await destCol.insertMany(docs, { ordered: false })
  console.log(`  ${name}: ${docs.length} docs`)
  return { name, count: docs.length }
}

async function copyIndexes(sourceDb, destDb, name) {
  const indexes = await sourceDb.collection(name).indexes()
  const toCreate = indexes.filter((idx) => idx.name !== '_id_')
  if (toCreate.length === 0) return

  for (const idx of toCreate) {
    const { key, name: indexName, v, ns, ...options } = idx
    try {
      await destDb.collection(name).createIndex(key, { ...options, name: indexName })
    } catch (err) {
      // Index may already exist with same keys
      if (!String(err.message).includes('already exists')) {
        console.warn(`  index warn ${name}.${indexName}: ${err.message}`)
      }
    }
  }
}

async function main() {
  console.log('SOURCE:', mask(SOURCE_URI), 'db=', DB_NAME)
  console.log('DEST:  ', mask(DEST_URI), 'db=', DB_NAME)

  const source = await mongoose.createConnection(SOURCE_URI, { dbName: DB_NAME }).asPromise()
  const dest = await mongoose.createConnection(DEST_URI, { dbName: DB_NAME }).asPromise()

  const sourceDb = source.db
  const destDb = dest.db

  const collections = (await sourceDb.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort()

  console.log(`\nCollections to migrate: ${collections.length}`)
  const summary = []

  for (const name of collections) {
    const result = await copyCollection(sourceDb, destDb, name)
    await copyIndexes(sourceDb, destDb, name)
    summary.push(result)
  }

  console.log('\n--- Verification (dest counts) ---')
  let total = 0
  for (const { name } of summary) {
    const count = await destDb.collection(name).countDocuments()
    total += count
    console.log(`  ${name}: ${count}`)
  }
  console.log(`TOTAL documents on dest: ${total}`)

  await source.close()
  await dest.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

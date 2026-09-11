import dotenv from 'dotenv'
import mongoose from 'mongoose'

dotenv.config({ path: './.env' })

async function activateAll() {
  const uri = process.env.MONGO_URI
  const dbName = process.env.MONGO_DB || 'svhub'
  console.log('Connecting to DB:', dbName)
  await mongoose.connect(uri, { dbName })

  // 1. Activate all 21 products
  const updateRes = await mongoose.connection.collection('products').updateMany(
    { isActive: false },
    { $set: { isActive: true } }
  )
  console.log('Activated products count:', updateRes.modifiedCount)

  // 2. Add missing categories
  const categoriesToAdd = [
    {
      name: 'Native Rice',
      slug: 'native-rice',
      storefront: 'nutri-hub',
      description: 'Indigenous grains grown with care for everyday pots of rice, kanji and festive meals.',
      active: true,
      sortOrder: 5,
    },
    {
      name: 'Handmade Soaps',
      slug: 'handmade-soaps',
      storefront: 'self-care',
      description: 'Herbal soaps made by hand with traditional ingredients for everyday care.',
      active: true,
      sortOrder: 6,
    },
    {
      name: 'Traditional Sweets',
      slug: 'sweets',
      storefront: 'nutri-hub',
      description: 'Time-honoured sweets made in small batches with native ingredients.',
      active: true,
      sortOrder: 7,
    },
    {
      name: 'Traditional Savouries',
      slug: 'savouries',
      storefront: 'nutri-hub',
      description: 'Crisp, homemade-style snacks for tea-time and everyday sharing.',
      active: true,
      sortOrder: 8,
    },
    {
      name: 'Daily Meals',
      slug: 'daily-meals',
      storefront: 'nutri-hub',
      description: 'Wholesome prepared meals rooted in South Indian kitchens.',
      active: true,
      sortOrder: 9,
    },
  ]

  for (const cat of categoriesToAdd) {
    const existing = await mongoose.connection.collection('categories').findOne({ slug: cat.slug })
    if (!existing) {
      await mongoose.connection.collection('categories').insertOne({
        ...cat,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      console.log('Created category:', cat.name, `(${cat.slug})`)
    } else {
      await mongoose.connection.collection('categories').updateOne({ slug: cat.slug }, { $set: { active: true } })
      console.log('Ensured active category:', cat.name)
    }
  }

  const activeCount = await mongoose.connection.collection('products').countDocuments({ isActive: true })
  console.log('Total active products in database now:', activeCount)

  await mongoose.disconnect()
}

activateAll().catch((err) => {
  console.error('Activation script error:', err)
  process.exit(1)
})

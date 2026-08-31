import 'dotenv/config'
import { app } from './app.js'
import { connectDb } from './db.js'

const port = Number(process.env.PORT) || 5000

try {
  await connectDb()
} catch (error) {
  console.error(`MongoDB connection failed: ${error.message}`)
  process.exit(1)
}

app.listen(port, () => {
  console.log(`SV Hub API running on http://localhost:${port}`)
})

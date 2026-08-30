import cors from 'cors'
import express from 'express'
import { healthRouter } from './routes/health.js'

const app = express()
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

app.use(
  cors({
    origin: clientOrigin,
  }),
)
app.use(express.json())

app.use('/api/health', healthRouter)

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

export { app }

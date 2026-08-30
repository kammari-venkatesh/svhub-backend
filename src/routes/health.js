import { Router } from 'express'

const healthRouter = Router()

healthRouter.get('/', (req, res) => {
  res.json({
    service: 'svhub-backend',
    status: 'ok',
  })
})

export { healthRouter }

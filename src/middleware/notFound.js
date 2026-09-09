export function notFound(req, res) {
  res.status(404).json({
    success: false,
    code: 'not_found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  })
}

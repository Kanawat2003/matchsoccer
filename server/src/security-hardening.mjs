const buckets = new Map()

const limiter = (windowMs, max, label) => (req, res, next) => {
 const ip = req.ip || req.socket.remoteAddress || 'unknown'
 const key = label + ':' + ip
 const now = Date.now()
 const hit = buckets.get(key)
 if (!hit || now - hit.start >= windowMs) {
  buckets.set(key, {start: now, count: 1})
  return next()
 }
 hit.count += 1
 if (hit.count > max) {
  const retry = Math.max(1, Math.ceil((windowMs - (now - hit.start)) / 1000))
  res.setHeader('Retry-After', String(retry))
  return res.status(429).json({error:'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่'})
 }
 next()
}

export const applySecurityHardening = (app) => {
 app.disable('x-powered-by')
 app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('X-Frame-Options','DENY')
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()')
  next()
 })
 app.use('/api/auth/login', limiter(15*60*1000, 10, 'login'))
 app.use('/api/auth/register', limiter(15*60*1000, 5, 'register'))
 app.use('/api/auth/forgot-password', limiter(15*60*1000, 5, 'forgot'))
 app.use('/api/auth/reset-password', limiter(15*60*1000, 8, 'reset'))
 app.use('/api/', limiter(60*1000, 180, 'api'))
}

setInterval(() => {
 const cutoff = Date.now() - 15*60*1000
 for (const [key, value] of buckets) if (value.start < cutoff) buckets.delete(key)
}, 5*60*1000).unref()

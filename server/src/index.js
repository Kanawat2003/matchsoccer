import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import db from './db.js'
import {safeBody, fallbackMessage, isBrokenThai} from './message-safety.mjs'

const app = express()
const PORT = Number(process.env.PORT) || 4001
const HOST = process.env.HOST || '0.0.0.0'
const SECRET = process.env.JWT_SECRET || 'porsball-local-dev-secret'
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production')

app.use(cors({origin:(origin,cb)=>{if(!origin||origin==='https://porsball.onrender.com'||origin==='http://localhost:5173'||origin==='http://127.0.0.1:5173')return cb(null,true);cb(new Error('CORS blocked'))}}))
app.use(express.json({limit:'100kb'}))
app.use((req,res,next)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8')
 const json=res.json.bind(res)
 res.json=(body)=>json(safeBody(body,res.statusCode))
 next()
})

const tokenFor = (u) => jwt.sign({ id:u.id, role:u.role, ver:Number(u.auth_version||0) }, SECRET, { expiresIn:'7d' })
const auth = (req,res,next) => {
 try {
  const token=(req.headers.authorization || '').replace('Bearer ','')
  req.user=jwt.verify(token,SECRET)
  const dbUser=db.prepare('SELECT id,role,auth_version FROM users WHERE id=?').get(req.user.id)
  if(!dbUser) return res.status(401).json({error:'ไม่พบผู้ใช้งาน'})
  if(Number(req.user.ver||0)!==Number(dbUser.auth_version||0)) return res.status(401).json({error:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'})
  req.user=dbUser
  next()
 } catch { res.status(401).json({error:'กรุณาเข้าสู่ระบบ'}) }
}

const notify = (userId,type,title,message) => {
 const titles={booking:'มีการจองสนามใหม่',cancel:'การจองถูกยกเลิก',match_close:'เจ้าของนัดปิดรับคน',join:'มีคนเข้าร่วมนัด',leave:'มีคนออกจากนัด',remove:'คุณถูกนำออกจากนัด'}
 const safeTitle=isBrokenThai(title)?(titles[type]||'มีการแจ้งเตือนใหม่'):title
 const safeMessage=isBrokenThai(message)?({booking:'มีการจองสนามใหม่',cancel:'การจองถูกยกเลิก',match_close:'เจ้าของนัดปิดรับคน',join:'มีคนเข้าร่วมนัด',leave:'มีคนออกจากนัด',remove:'คุณถูกนำออกจากนัด'}[type]||'มีการแจ้งเตือนใหม่'):message
 return db.prepare('INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?)').run(userId,type,safeTitle,safeMessage)
}

const bangkokDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date())
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00+07:00`).getTime()) && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(`${date}T00:00:00+07:00`))===date
const bookingState = (date,start,end) => { const now=new Date(); const from=new Date(`${date}T${start}:00+07:00`); const to=new Date(`${date}T${end}:00+07:00`); return now>=to?'EXPIRED':now>=from?'IN_PROGRESS':'UPCOMING' }

app.get('/api/health', (_,res) => res.json({ok:true, service:'PorsBall API'}))
app.get('/api/venues', (req,res) => {
 const q = `%${req.query.q || ''}%`
 const rows = db.prepare('SELECT * FROM venues WHERE name LIKE ? OR area LIKE ? ORDER BY rating DESC').all(q,q)
 res.json(rows)
})
app.get('/api/venues/:id', (req,res) => {
 const venue = db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if (!venue) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธชเธ™เธฒเธก'})
 res.json(venue)
})
app.get('/api/admin/users', auth, (req,res) => {
 if (req.user.role !== 'admin') return res.status(403).json({error:'เน€เธ‰เธžเธฒเธฐเนเธญเธ"เธกเธดเธ™เน€เธ—เนˆเธฒเธ™เธฑเน‰เธ™'})
 const rows=db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users ORDER BY id DESC').all()
 res.json(rows)
})
app.patch('/api/admin/users/:id/role', auth, (req,res) => {
 if (req.user.role !== 'admin') return res.status(403).json({error:'เน€เธ‰เธžเธฒเธฐเนเธญเธ"เธกเธดเธ™เน€เธ—เนˆเธฒเธ™เธฑเน‰เธ™'})
 const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.params.id)
 if(!user) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธœเธนเน‰เนƒเธŠเน‰'})
 const role=String(req.body.role||'').trim()
 if(!['player','owner','admin'].includes(role)) return res.status(400).json({error:'เธชเธดเธ—เธ˜เธดเนŒเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
 if(user.id===req.user.id && role!=='admin') return res.status(409).json({error:'เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธฅเธ"เธชเธดเธ—เธ˜เธดเนŒเธšเธฑเธเธŠเธตเนเธญเธ"เธกเธดเธ™เธ—เธตเนˆเธเธณเธฅเธฑเธ‡เนƒเธŠเน‰เธ‡เธฒเธ™เน"เธ"เน‰'})
 if(user.role==='owner' && role!=='owner' && db.prepare('SELECT 1 FROM venues WHERE owner_id=? LIMIT 1').get(user.id)) return res.status(409).json({error:'เน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธชเธ™เธฒเธกเธ"เธ™เธ™เธตเน‰เธขเธฑเธ‡เธกเธตเธชเธ™เธฒเธกเธ—เธตเนˆเธ"เธนเนเธฅเธญเธขเธนเนˆ เธเธฃเธธเธ"เธฒเน€เธ›เธฅเธตเนˆเธขเธ™เน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธชเธ™เธฒเธกเธเนˆเธญเธ™เธฅเธ"เธชเธดเธ—เธ˜เธดเนŒ'})
 db.prepare('UPDATE users SET role=? WHERE id=?').run(role,user.id)
 res.json(db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users WHERE id=?').get(user.id))
})

app.get('/api/owner/venues', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เน"เธกเนˆเธกเธตเธชเธดเธ—เธ˜เธดเนŒเธˆเธฑเธ"เธเธฒเธฃเธชเธ™เธฒเธก'})
 const rows = req.user.role === 'admin'
  ? db.prepare('SELECT * FROM venues ORDER BY id DESC').all()
  : db.prepare('SELECT * FROM venues WHERE owner_id=? ORDER BY id DESC').all(req.user.id)
 res.json(rows)
})
app.patch('/api/owner/venues/:id', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เน"เธกเนˆเธกเธตเธชเธดเธ—เธ˜เธดเนŒเธˆเธฑเธ"เธเธฒเธฃเธชเธ™เธฒเธก'})
 const venue = db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if (!venue) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธชเธ™เธฒเธก'})
 if (req.user.role !== 'admin' && venue.owner_id !== req.user.id) return res.status(403).json({error:'เน"เธกเนˆเธกเธตเธชเธดเธ—เธ˜เธดเนŒเนเธเน‰เน"เธ\\\'เธชเธ™เธฒเธกเธ™เธตเน‰'})
 const {name,area,address,pricePerHour,price_per_hour,roof,fieldTypes,field_types} = req.body
 const finalPrice = Number(pricePerHour ?? price_per_hour)
 const finalFields = String(fieldTypes ?? field_types ?? '').trim()
 const finalName = String(name ?? '').trim()
 const finalArea = String(area ?? '').trim()
 const finalAddress = String(address ?? '').trim()
 if (!finalName || !finalArea || !finalAddress || !finalFields || !Number.isFinite(finalPrice) || finalPrice <= 0) return res.status(400).json({error:'เธเธฃเธธเธ"เธฒเธเธฃเธญเธเธ\\\'เน‰เธญเธกเธนเธฅเธชเธ™เธฒเธกเนƒเธซเน‰เธ–เธนเธเธ•เน‰เธญเธ‡'})
 db.prepare('UPDATE venues SET name=?,area=?,address=?,price_per_hour=?,roof=?,field_types=? WHERE id=?').run(finalName,finalArea,finalAddress,finalPrice,roof?1:0,finalFields,req.params.id)
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id))
})
app.post('/api/auth/register', async (req,res) => {
 const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'')
 if (!name || !email || !password) return res.status(400).json({error:'เธเธฃเธธเธ"เธฒเธเธฃเธญเธเธ\\\'เน‰เธญเธกเธนเธฅเนƒเธซเน‰เธ"เธฃเธš'})
 if (name.length>80) return res.status(400).json({error:'เธŠเธทเนˆเธญเธขเธฒเธงเน€เธเธดเธ™เน"เธ›'})
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'เธฃเธนเธ›เนเธšเธšเธญเธตเน€เธกเธฅเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
 if (password.length<8) return res.status(400).json({error:'เธฃเธซเธฑเธชเธœเนˆเธฒเธ™เธ•เน‰เธญเธ‡เธกเธตเธญเธขเนˆเธฒเธ‡เธ™เน‰เธญเธข 8 เธ•เธฑเธงเธญเธฑเธเธฉเธฃ'})
 try {
  const hash = await bcrypt.hash(password,10)
  const info = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,hash)
  const user = db.prepare('SELECT id,name,email,role,points,wins,losses FROM users WHERE id=?').get(info.lastInsertRowid)
  res.status(201).json({token:tokenFor(user),user})
 } catch { res.status(409).json({error:'เธญเธตเน€เธกเธฅเธ™เธตเน‰เธ–เธนเธเนƒเธŠเน‰เธ‡เธฒเธ™เนเธฅเน‰เธง'}) }
})
app.post('/api/auth/login', async (req,res) => {
 const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'')
 if(!email || !password) return res.status(400).json({error:'กรุณากรอกอีเมลและรหัสผ่าน'})
 const user = db.prepare('SELECT * FROM users WHERE email=?').get(email)
 if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'})
 const safe = {id:user.id,name:user.name,email:user.email,role:user.role,points:user.points,wins:user.wins,losses:user.losses,auth_version:user.auth_version}
 res.json({token:tokenFor(safe),user:safe})
})
const hashResetCode = (code) => crypto.createHash('sha256').update(code).digest('hex')
const hashMemberToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const sendResetEmail = async (email, code) => {
 const key=process.env.RESEND_API_KEY, from=process.env.RESEND_FROM
 if(!key || !from) return false
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[email],subject:'PorsBall - รหัสยืนยันการเปลี่ยนรหัสผ่าน',html:'<p>รหัสยืนยัน PorsBall สำหรับเปลี่ยนรหัสผ่านของคุณคือ <strong>'+code+'</strong></p><p>รหัสนี้ใช้ได้ 10 นาที และใช้ได้เพียงครั้งเดียว</p>'})})
 if(!r.ok) throw new Error('ส่งอีเมลไม่สำเร็จ')
 return true
}
app.post('/api/auth/forgot-password', async (req,res) => {
 const email=(req.body.email||'').trim().toLowerCase()
 if(!email) return res.status(400).json({error:'กรุณากรอกอีเมล'})
 const user=db.prepare('SELECT id,email FROM users WHERE email=?').get(email)
 const generic={message:'หากอีเมลนี้มีบัญชี PorsBall ระบบจะส่งรหัสยืนยันให้คุณ'}
 if(!user) return res.json(generic)
 const recent=db.prepare("SELECT created_at FROM password_resets WHERE user_id=? ORDER BY id DESC LIMIT 1").get(user.id)
 if(recent && Date.now()-Date.parse(recent.created_at+'Z')<60000) return res.json(generic)
 const code=String(crypto.randomInt(100000,1000000))
 db.prepare("UPDATE password_resets SET used=1 WHERE user_id=? AND used=0").run(user.id)
 db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at) VALUES(?,?,?)').run(user.id,hashResetCode(code),Date.now()+10*60*1000)
 try { const sent=await sendResetEmail(email,code); if(!sent && process.env.NODE_ENV!=='production') return res.json({...generic,devCode:code}) } catch { if(process.env.NODE_ENV!=='production') return res.status(500).json({...generic,devCode:code,error:'เธชเนˆเธ‡เธญเธตเน€เธกเธฅเน"เธกเนˆเธชเธณเน€เธฃเน‡เธˆ (เน\\\'เธซเธกเธ"เธ—เธ"เธชเธญเธš)'}); return res.json(generic) }
 res.json(generic)
})
app.post('/api/auth/reset-password', async (req,res) => {
 const email=(req.body.email||'').trim().toLowerCase(), code=String(req.body.code||'').trim(), newPassword=req.body.newPassword||''
if(!email||!/^\d{6}$/.test(code)||newPassword.length<8) return res.status(400).json({error:'กรุณากรอกอีเมล รหัสยืนยัน 6 หลัก และรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร'})
 const user=db.prepare('SELECT id FROM users WHERE email=?').get(email)
 if(!user) return res.status(400).json({error:'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ'})
 const row=db.prepare('SELECT * FROM password_resets WHERE user_id=? AND used=0 ORDER BY id DESC LIMIT 1').get(user.id)
 if(!row || row.expires_at<Date.now() || row.attempts>=5) return res.status(400).json({error:'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ'})
 if(hashResetCode(code)!==row.code_hash){ db.prepare('UPDATE password_resets SET attempts=attempts+1 WHERE id=?').run(row.id); return res.status(400).json({error:'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ'}) }
 const hash=await bcrypt.hash(newPassword,10)
 db.prepare('UPDATE users SET password_hash=?, auth_version=auth_version+1 WHERE id=?').run(hash,user.id)
 db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(row.id)
 res.json({ok:true,message:'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว'})
})
app.get('/api/notifications', auth, (req,res) => { const rows=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id); res.json(rows) })
app.post('/api/notifications/:id/read', auth, (req,res) => { db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id); res.json({ok:true}) })
app.post('/api/notifications/read-all', auth, (req,res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ok:true}) })

app.get('/api/me', auth, (req,res) => {
 const user = db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users WHERE id=?').get(req.user.id)
 res.json(user)
})

app.get('/api/venues/:id/slots', (req,res) => {
 const date = String(req.query.date || bangkokDate())
 if(!validDate(date)) return res.status(400).json({error:'วันที่ไม่ถูกต้อง'})
 const booked = new Set(db.prepare('SELECT start_time FROM bookings WHERE venue_id=? AND booking_date=? AND status=?').all(req.params.id,date,'confirmed').map(x=>x.start_time))
 const slots = ['16:00','17:00','18:00','19:00','20:00','21:00','22:00'].map(start => ({start,end:`${String(Number(start.slice(0,2))+1).padStart(2,'0')}:00`,available:!booked.has(start)}))
 res.json({date,slots})
})
app.post('/api/bookings', auth, (req,res) => {
 const {venueId,bookingDate,startTime,endTime,totalPrice} = req.body
 if (!venueId || !bookingDate || !startTime || !endTime) return res.status(400).json({error:'เธ\\\'เน‰เธญเธกเธนเธฅเธเธฒเธฃเธˆเธญเธ‡เน"เธกเนˆเธ"เธฃเธš'})
 if (!validDate(String(bookingDate))) return res.status(400).json({error:'เธงเธฑเธ™เธ—เธตเนˆเธˆเธญเธ‡เน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
 const venue=db.prepare('SELECT id,price_per_hour,owner_id,name FROM venues WHERE id=?').get(venueId)
 if(!venue) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธชเธ™เธฒเธกเธ—เธตเนˆเธ•เน‰เธญเธ‡เธเธฒเธฃเธˆเธญเธ‡'})
 const clientPrice=Number(totalPrice)
 if(!Number.isFinite(clientPrice)||clientPrice<=0||clientPrice!==Number(venue.price_per_hour)) return res.status(400).json({error:'เธฃเธฒเธ"เธฒเธเธฒเธฃเธˆเธญเธ‡เน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡ เธเธฃเธธเธ"เธฒเน€เธฅเธทเธญเธเธชเธ™เธฒเธกเนเธฅเธฐเน€เธงเธฅเธฒเนƒเธซเธกเนˆ'})
 try {
  if(!/^\d{2}:00$/.test(startTime)||!/^\d{2}:00$/.test(endTime)) return res.status(400).json({error:'เธฃเธนเธ›เนเธšเธšเน€เธงเธฅเธฒเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
  const startHour=Number(startTime.slice(0,2)),endHour=Number(endTime.slice(0,2))
  if(startHour<16||startHour>22||endHour!==startHour+1) return res.status(400).json({error:'เธŠเนˆเธงเธ‡เน€เธงเธฅเธฒเธˆเธญเธ‡เน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
  if (startTime >= endTime) return res.status(400).json({error:'เน€เธงเธฅเธฒเน€เธฃเธดเนˆเธกเธ•เน‰เธญเธ‡เธ™เน‰เธญเธขเธเธงเนˆเธฒเน€เธงเธฅเธฒเธชเธดเน‰เธ™เธชเธธเธ"'})
  const startAt=new Date(`${bookingDate}T${startTime}:00+07:00`)
  const endAt=new Date(`${bookingDate}T${endTime}:00+07:00`)
  if(Number.isNaN(startAt.getTime())||Number.isNaN(endAt.getTime())) return res.status(400).json({error:'เธงเธฑเธ™เธซเธฃเธทเธญเน€เธงเธฅเธฒเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
  if(startAt<=new Date() || endAt<=startAt) return res.status(409).json({error:'เน€เธงเธฅเธฒเธˆเธญเธ‡เธ™เธตเน‰เธœเนˆเธฒเธ™เน"เธ›เนเธฅเน‰เธง เธเธฃเธธเธ"เธฒเน€เธฅเธทเธญเธเธงเธฑเธ™เนเธฅเธฐเน€เธงเธฅเธฒเนƒเธซเธกเนˆ'})
  const overlap = db.prepare("SELECT id FROM bookings WHERE venue_id=? AND booking_date=? AND status='confirmed' AND start_time < ? AND end_time > ? LIMIT 1").get(venueId,bookingDate,endTime,startTime)
  if (overlap) return res.status(409).json({error:'เธŠเนˆเธงเธ‡เน€เธงเธฅเธฒเธ™เธตเน‰เธกเธตเธเธฒเธฃเธˆเธญเธ‡เนเธฅเน‰เธง เธเธฃเธธเธ"เธฒเน€เธฅเธทเธญเธเน€เธงเธฅเธฒเธญเธทเนˆเธ™'})
  const cancelled = db.prepare("SELECT * FROM bookings WHERE venue_id=? AND booking_date=? AND start_time=? AND status='cancelled'").get(venueId,bookingDate,startTime)
  if (cancelled) {
   db.prepare('DELETE FROM matches WHERE booking_id=?').run(cancelled.id)
   db.prepare('DELETE FROM split_bills WHERE booking_id=?').run(cancelled.id)
   db.prepare("UPDATE bookings SET user_id=?,end_time=?,total_price=?,status='confirmed',created_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,endTime,venue.price_per_hour,cancelled.id)
   if (venue.owner_id && Number(venue.owner_id)!==req.user.id) {
    const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)
    notify(Number(venue.owner_id),'booking','เธกเธตเธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธกเนƒเธซเธกเนˆ',`${u?.name||'เธœเธนเน‰เน€เธฅเนˆเธ™'} เธเธญเธเธชเธเธฒเธก ${bookingDate} ${startTime}-${endTime}`)
   }
   return res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id=?').get(cancelled.id))
  }
  const insertBooking = db.transaction(() => {
   const overlapNow = db.prepare("SELECT id FROM bookings WHERE venue_id=? AND booking_date=? AND status='confirmed' AND start_time < ? AND end_time > ? LIMIT 1").get(venueId,bookingDate,endTime,startTime)
   if (overlapNow) throw new Error('BOOKING_CONFLICT')
   const result = db.prepare('INSERT INTO bookings(venue_id,user_id,booking_date,start_time,end_time,total_price) VALUES(?,?,?,?,?,?)').run(venueId,req.user.id,bookingDate,startTime,endTime,venue.price_per_hour)
   return result.lastInsertRowid
  })
  const bookingId = insertBooking()
  if (venue.owner_id && Number(venue.owner_id)!==req.user.id) {
   const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)
   notify(Number(venue.owner_id),'booking','เธกเธตเธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธกเนƒเธซเธกเนˆ',`${u?.name||'เธœเธนเน‰เน€เธฅเนˆเธ™'} เธเธญเธเธชเธเธฒเธก ${bookingDate} ${startTime}-${endTime}`)
  }
  res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId))
 } catch { res.status(409).json({error:'เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธชเธฃเน‰เธฒเธ‡เธเธฒเธฃเธˆเธญเธ‡เน"เธ"เน‰ เธเธฃเธธเธ"เธฒเน€เธฅเธทเธญเธเน€เธงเธฅเธฒเธญเธทเนˆเธ™'}) }
})
app.get('/api/bookings/me', auth, (req,res) => res.json(db.prepare("SELECT b.*,v.name venue_name,m.id match_id,m.open_for_join FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN matches m ON m.booking_id=b.id WHERE b.user_id=? AND b.status='confirmed' AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=b.id AND sb.status='closed') ORDER BY b.booking_date DESC,b.start_time DESC").all(req.user.id)))
app.get('/api/owner/bookings', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เน"เธกเนˆเธกเธตเธชเธดเธ—เธ˜เธดเนŒเธˆเธฑเธ"เธเธฒเธฃเธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธก'})
 const rows = req.user.role === 'admin'
  ? db.prepare("SELECT b.*,v.name venue_name,u.name user_name,u.email user_email FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id ORDER BY b.booking_date DESC,b.start_time DESC").all()
  : db.prepare("SELECT b.*,v.name venue_name,u.name user_name,u.email user_email FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id WHERE v.owner_id=? ORDER BY b.booking_date DESC,b.start_time DESC").all(req.user.id)
 const now=Date.now()
 res.json(rows.map(b=>{const start=new Date(b.booking_date+'T'+b.start_time+':00+07:00').getTime();const end=new Date(b.booking_date+'T'+b.end_time+':00+07:00').getTime();const state=String(b.status).toUpperCase()==='CANCELLED'?'CANCELLED':now<start?'UPCOMING':now<end?'IN_PROGRESS':'COMPLETED';return {...b,state}}))
})
app.post('/api/bookings/:id/cancel', auth, (req,res) => { const b=db.prepare("SELECT b.*,v.name venue_name,v.owner_id FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=? AND b.user_id=? AND b.status='confirmed'").get(req.params.id,req.user.id); if(!b)return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธเธฒเธฃเธˆเธญเธ‡เธ—เธตเนˆเธชเธฒเธกเธฒเธฃเธ–เธขเธเน€เธฅเธดเธเน"เธ"เน‰'}); const now=new Date(),start=new Date(`${b.booking_date}T${b.start_time}:00+07:00`),end=new Date(`${b.booking_date}T${b.end_time}:00+07:00`); if(now>=start)return res.status(409).json({error:now>=end?'เน€เธฅเธขเน€เธงเธฅเธฒเธˆเธญเธ‡เนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธขเธเน€เธฅเธดเธเน"เธ"เน‰':'เธชเธ™เธฒเธกเธเธณเธฅเธฑเธ‡เนƒเธŠเน‰เธ‡เธฒเธ™เธญเธขเธนเนˆ เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธขเธเน€เธฅเธดเธเธเธฒเธฃเธˆเธญเธ‡เน"เธ"เน‰'}); db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id); const members=db.prepare('SELECT user_id FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE m.booking_id=? AND mp.user_id<>?').all(b.id,b.user_id); db.prepare('UPDATE matches SET open_for_join=0 WHERE booking_id=?').run(b.id); db.prepare("UPDATE split_bills SET status='closed' WHERE booking_id=? AND status='open'").run(b.id); members.forEach(x=>notify(x.user_id,'cancel','เธ™เธฑเธ"เธ–เธนเธเธขเธเน€เธฅเธดเธ',`เธเธฑเธ”เธเธญเธเธเธธเธ“ ${b.booking_date} ${b.start_time} เธ–เธนเธเธขเธเน€เธฅเธดเธ`)); if(b.owner_id && Number(b.owner_id)!==req.user.id) notify(Number(b.owner_id),'cancel','เธเธฒเธฃเธˆเธญเธ‡เธ–เธนเธเธขเธเน€เธฅเธดเธ',`เธเธฒเธฃเธเธญเธเธชเธเธฒเธก ${b.venue_name} เธงเธฑเธเธ—เธตเน ${b.booking_date} เน€เธงเธฅเธฒ ${b.start_time}-${b.end_time} เธ–เธนเธเธขเธเน€เธฅเธดเธ`); res.json({ok:true}) })
app.get('/api/matches', (req,res) => {
 const rows = db.prepare(`SELECT m.*,v.name venue_name,b.end_time,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.open_for_join=1 AND (b.status='confirmed') AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=m.booking_id AND sb.status='closed') ORDER BY m.match_date,m.start_time`).all()
 const visible = rows.filter(r => bookingState(r.match_date,r.start_time,r.end_time) !== 'EXPIRED')
 res.json(visible.map(r=>({...r,state:bookingState(r.match_date,r.start_time,r.end_time)})))
})
app.post('/api/matches', auth, (req,res) => {
 const {bookingId,title,fee,maxPlayers=10} = req.body
 if (!bookingId || !title || !fee) return res.status(400).json({error:'เธเธฃเธธเธ"เธฒเน€เธฅเธทเธญเธเธเธฒเธฃเธˆเธญเธ‡เนเธฅเธฐเธเธฃเธญเธเธ\\\'เน‰เธญเธกเธนเธฅเนƒเธซเน‰เธ"เธฃเธš'})
 const booking=db.prepare("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'").get(bookingId,req.user.id)
 if (!booking) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธเธฒเธฃเธˆเธญเธ‡เธ\\\'เธญเธ‡เธ"เธธเธ"'})
 const matchState=bookingState(booking.booking_date,booking.start_time,booking.end_time)
 if(matchState!=='UPCOMING') return res.status(409).json({error:matchState==='EXPIRED'?'เธเธฒเธฃเธˆเธญเธ‡เธ™เธตเน‰เน€เธฅเธขเน€เธงเธฅเธฒเนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธชเธฃเน‰เธฒเธ‡เธ™เธฑเธ"เน"เธ"เน‰':'เธเธฒเธฃเธˆเธญเธ‡เธ™เธตเน‰เน€เธฃเธดเนˆเธกเนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธชเธฃเน‰เธฒเธ‡เธ™เธฑเธ"เน"เธ"เน‰'})
 const max=Number(maxPlayers)
 if(!Number.isInteger(max)||max<2||max>30) return res.status(400).json({error:'เธˆเธณเธ™เธงเธ™เธœเธนเน‰เน€เธฅเนˆเธ™เธ•เน‰เธญเธ‡เธญเธขเธนเนˆเธฃเธฐเธซเธงเนˆเธฒเธ‡ 2 เธ–เธถเธ‡ 30 เธ"เธ™'})
 const matchFee=Number(fee)
 if(!Number.isFinite(matchFee)||matchFee<=0) return res.status(400).json({error:'เธ"เนˆเธฒเธฃเนˆเธงเธกเน€เธฅเนˆเธ™เน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
 const existingMatch=db.prepare('SELECT * FROM matches WHERE booking_id=? ORDER BY id DESC LIMIT 1').get(booking.id)
 if(existingMatch) return res.status(409).json({error:'เธเธฒเธฃเธˆเธญเธ‡เธ™เธตเน‰เธกเธตเธ™เธฑเธ"เธญเธขเธนเนˆเนเธฅเน‰เธง เธเธฃเธธเธ"เธฒเธˆเธฑเธ"เธเธฒเธฃเธ™เธฑเธ"เน€เธ"เธดเธกเนเธ—เธ™'})
 const result=db.prepare('INSERT INTO matches(creator_id,venue_id,title,match_date,start_time,fee,max_players,booking_id,open_for_join) VALUES(?,?,?,?,?,?,?,?,1)').run(req.user.id,booking.venue_id,title.trim(),booking.booking_date,booking.start_time,matchFee,max,booking.id)
 db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(result.lastInsertRowid,req.user.id)
 res.status(201).json(db.prepare('SELECT * FROM matches WHERE id=?').get(result.lastInsertRowid))
})
app.post('/api/matches/:id/open', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=? AND m.creator_id=?').get(req.params.id,req.user.id)
 if(!m) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธ™เธฑเธ"เธ\\\'เธญเธ‡เธ"เธธเธ"'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธกเธ–เธนเธเธขเธเน€เธฅเธดเธเนเธฅเน‰เธง'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เธ™เธฑเธ"เธ™เธตเน‰เน€เธฃเธดเนˆเธกเธซเธฃเธทเธญเธซเธกเธ"เน€เธงเธฅเธฒเนเธฅเน‰เธง'})
 const closedBill=db.prepare("SELECT 1 FROM split_bills WHERE booking_id=? AND status='closed' LIMIT 1").get(m.booking_id)
 if(closedBill) return res.status(409).json({error:'เธšเธดเธฅเธ\\\'เธญเธ‡เธเธฒเธฃเธˆเธญเธ‡เธ™เธตเน‰เธ–เธนเธเธ›เธดเธ"เนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เน€เธ›เธดเธ"เธฃเธฑเธšเธ"เธ™เธญเธตเธเธ"เธฃเธฑเน‰เธ‡'})
 db.prepare('UPDATE matches SET open_for_join=1 WHERE id=?').run(m.id)
 res.json({ok:true})
})
app.post('/api/matches/:id/close', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.status booking_status,b.booking_date,b.end_time FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=? AND m.creator_id=?').get(req.params.id,req.user.id)
 if(!m) return res.status(404).json({error:'ไม่พบข้อมูลนัดของคุณ'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'การจองสนามถูกยกเลิกแล้ว'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'นัดนี้เริ่มหรือหมดเวลาแล้ว'})
 db.prepare('UPDATE matches SET open_for_join=0 WHERE id=?').run(m.id)
 const players=db.prepare('SELECT user_id FROM match_players WHERE match_id=? AND user_id<>?').all(m.id,m.creator_id)
 players.forEach(x=>notify(x.user_id,'match_close','เน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธ™เธฑเธ"เธ›เธดเธ"เธฃเธฑเธšเธ"เธ™',`เธเธฑเธ” ${m.title} เธเธดเธ”เธฃเธฑเธเธเธนเนเน€เธฅเนเธเน€เธเธดเนเธกเน€เธ•เธดเธกเนเธฅเนเธง`))
 res.json({ok:true})
})
app.get('/api/matches/me', auth, (req,res) => {
 const rows=db.prepare("SELECT m.*,v.name venue_name,b.end_time,b.status booking_status,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.creator_id=? AND b.status='confirmed' AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=m.booking_id AND sb.status='closed') ORDER BY m.match_date,m.start_time").all(req.user.id)
 res.json(rows.map(r=>({...r,state:bookingState(r.match_date,r.start_time,r.end_time)})))
})
app.post('/api/matches/:id/join', auth, (req,res) => {
 const match = db.prepare("SELECT m.*,b.end_time,b.status booking_status FROM matches m LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.id=?").get(req.params.id)
 if (match && match.booking_status !== 'confirmed') return res.status(409).json({error:'เธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธกเธ–เธนเธเธขเธเน€เธฅเธดเธเธซเธฃเธทเธญเธ›เธดเธ"เนเธฅเน‰เธง'})
 if (!match) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธ™เธฑเธ"เธ™เธตเน‰'})
 const state=bookingState(match.match_date,match.start_time,match.end_time)
 if(state!=='UPCOMING') return res.status(409).json({error:state==='EXPIRED'?'เธ™เธฑเธ"เธ™เธตเน‰เน€เธฅเธขเน€เธงเธฅเธฒเธˆเธญเธ‡เนเธฅเน‰เธง':'เธ™เธฑเธ"เธ™เธตเน‰เน€เธฃเธดเนˆเธกเนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เน€เธ\\\'เน‰เธฒเธฃเนˆเธงเธกเน"เธ"เน‰'})
 if(!match.open_for_join) return res.status(409).json({error:'เธ™เธฑเธ"เธ™เธตเน‰เธ›เธดเธ"เธฃเธฑเธšเธ"เธ™เนเธฅเน‰เธง'})
 const existing = db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND user_id=?').get(match.id,req.user.id)
 if (existing) return res.status(409).json({error:'เธ"เธธเธ"เน€เธ\\\'เน‰เธฒเธฃเนˆเธงเธกเธ™เธฑเธ"เธ™เธตเน‰เนเธฅเน‰เธง'})
 try {
  const joined=db.transaction(()=>{
   const count=db.prepare('SELECT COUNT(*) n FROM match_players WHERE match_id=?').get(match.id).n
   if(count>=match.max_players) return false
   db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(match.id,req.user.id)
   return true
  })()
  if(!joined) return res.status(409).json({error:'เธ™เธฑเธ"เธ™เธตเน‰เน€เธ•เน‡เธกเนเธฅเน‰เธง'})
  if(req.user.id!==match.creator_id){ const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id); notify(match.creator_id,'join','เธกเธตเธ"เธ™เน€เธ\\\'เน‰เธฒเธฃเนˆเธงเธกเธ™เธฑเธ"',`${u?.name||'เธœเธนเน‰เน€เธฅเนˆเธ™'} เน€เธเนเธฒเธฃเนเธงเธกเธเธฑเธ” ${match.title}`) }
 } catch { return res.status(409).json({error:'เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เน€เธ\\\'เน‰เธฒเธฃเนˆเธงเธกเธ™เธฑเธ"เธ™เธตเน‰เน"เธ"เน‰ เธเธฃเธธเธ"เธฒเธฅเธญเธ‡เนƒเธซเธกเนˆเธญเธตเธเธ"เธฃเธฑเน‰เธ‡'}) }
 res.json({ok:true,message:'เข้าร่วมนัดสำเร็จ'})
})

app.get('/api/matches/:id/players', auth, (req,res) => {
 const m=db.prepare('SELECT id,creator_id,max_players,open_for_join FROM matches WHERE id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธ™เธฑเธ"'})
 const players=db.prepare('SELECT u.id,u.name,CASE WHEN u.id=? THEN 1 ELSE 0 END AS owner FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=? ORDER BY owner DESC,u.name').all(m.creator_id,m.id)
 res.json({match:m,players})
})
app.post('/api/matches/:id/leave', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธ™เธฑเธ"'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธกเธ–เธนเธเธขเธเน€เธฅเธดเธเนเธฅเน‰เธง'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เธ™เธฑเธ"เธ™เธตเน‰เน€เธฃเธดเนˆเธกเธซเธฃเธทเธญเธซเธกเธ"เน€เธงเธฅเธฒเนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เน€เธ›เธฅเธตเนˆเธขเธ™เธชเธกเธฒเธŠเธดเธเน"เธ"เน‰'})
 if(m.creator_id===req.user.id) return res.status(409).json({error:'เน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธ™เธฑเธ"เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธญเธญเธเธˆเธฒเธเธ™เธฑเธ"เน"เธ"เน‰ เธเธฃเธธเธ"เธฒเธขเธเน€เธฅเธดเธเธ™เธฑเธ"เนเธ—เธ™'})
 const result=db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?').run(m.id,req.user.id)
 if(!result.changes) return res.status(409).json({error:'เธ"เธธเธ"เธขเธฑเธ‡เน"เธกเนˆเน"เธ"เน‰เน€เธ\\\'เน‰เธฒเธฃเนˆเธงเธกเธ™เธฑเธ"เธ™เธตเน‰'})
 const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id); notify(m.creator_id,'leave','เธกเธตเธ"เธ™เธญเธญเธเธˆเธฒเธเธ™เธฑเธ"',`${u?.name||'เธœเธนเน‰เน€เธฅเนˆเธ™'} เธญเธญเธเธเธฒเธเธเธฑเธ” ${m.title}`)
 res.json({ok:true})
})
app.delete('/api/matches/:id/players/:userId', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธ™เธฑเธ"'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เธเธฒเธฃเธˆเธญเธ‡เธชเธ™เธฒเธกเธ–เธนเธเธขเธเน€เธฅเธดเธเนเธฅเน‰เธง'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เธ™เธฑเธ"เธ™เธตเน‰เน€เธฃเธดเนˆเธกเธซเธฃเธทเธญเธซเธกเธ"เน€เธงเธฅเธฒเนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เน€เธ›เธฅเธตเนˆเธขเธ™เธชเธกเธฒเธŠเธดเธเน"เธ"เน‰'})
 if(m.creator_id!==req.user.id) return res.status(403).json({error:'เน€เธ‰เธžเธฒเธฐเน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธ™เธฑเธ"เน€เธ—เนˆเธฒเธ™เธฑเน‰เธ™'})
 if(Number(req.params.userId)===m.creator_id) return res.status(409).json({error:'เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธฅเธšเน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธ™เธฑเธ"เธญเธญเธเน"เธ"เน‰'})
 const result=db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?').run(m.id,req.params.userId)
 if(!result.changes) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธชเธกเธฒเธŠเธดเธเนƒเธ™เธ™เธฑเธ"'})
 notify(Number(req.params.userId),'remove','เธ–เธนเธเธ™เธณเธญเธญเธเธˆเธฒเธเธ™เธฑเธ"',`เธเธธเธ“เธ–เธนเธเธเธณเธญเธญเธเธเธฒเธเธเธฑเธ” ${m.title}`)
 res.json({ok:true})
})

app.post('/api/split-bills', auth, (req,res) => {
 const {bookingId,shareCount,names=[]} = req.body
 const booking = db.prepare("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'").get(bookingId,req.user.id)
 if (!booking) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธเธฒเธฃเธˆเธญเธ‡เธ—เธตเนˆเธขเธฑเธ‡เนƒเธŠเน‰เธ‡เธฒเธ™เน"เธ"เน‰'})
 const billState=bookingState(booking.booking_date,booking.start_time,booking.end_time)
 if(billState==='EXPIRED') return res.status(409).json({error:'เธเธฒเธฃเธˆเธญเธ‡เธ™เธตเน‰เน€เธฅเธขเน€เธงเธฅเธฒเนเธฅเน‰เธง เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เธชเธฃเน‰เธฒเธ‡เธšเธดเธฅเน"เธ"เน‰'})
 const count=Number(shareCount)
 if (!Number.isInteger(count)||count<2||count>30) return res.status(400).json({error:'เธˆเธณเธ™เธงเธ™เธ"เธ™เธ•เน‰เธญเธ‡เธญเธขเธนเนˆเธฃเธฐเธซเธงเนˆเธฒเธ‡ 2 เธ–เธถเธ‡ 30'})
 const baseShare=Math.floor(booking.total_price/count)
 const remainder=booking.total_price%count
 const share=baseShare
 const existing=db.prepare("SELECT * FROM split_bills WHERE booking_id=? AND owner_user_id=? AND status='open'").get(booking.id,req.user.id)
 if(existing){
  const paidCount=db.prepare('SELECT COUNT(*) n FROM split_bill_members WHERE split_bill_id=? AND paid=1').get(existing.id).n
  if(paidCount>0 && Number(existing.share_count)!==count) return res.status(409).json({error:'เน"เธกเนˆเธชเธฒเธกเธฒเธฃเธ–เน€เธ›เธฅเธตเนˆเธขเธ™เธˆเธณเธ™เธงเธ™เธชเธกเธฒเธŠเธดเธเธซเธฅเธฑเธ‡เธˆเธฒเธเธกเธตเธเธฒเธฃเธŠเธณเธฃเธฐเน€เธ‡เธดเธ™เนเธฅเน‰เธง'})
  db.prepare('UPDATE split_bills SET share_count=?,share_amount=?,total_amount=? WHERE id=?').run(count,share,booking.total_price,existing.id)
  const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  if(members.length>count) db.prepare('DELETE FROM split_bill_members WHERE split_bill_id=? AND id IN (SELECT id FROM split_bill_members WHERE split_bill_id=? ORDER BY id DESC LIMIT ?)').run(existing.id,existing.id,members.length-count)
  const current=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  const add=db.prepare('INSERT INTO split_bill_members(split_bill_id,name) VALUES(?,?)')
  for(let i=current.length;i<count;i++) add.run(existing.id,names[i]||('เน€เธžเธทเนˆเธญเธ™เธ"เธ™เธ—เธตเนˆ '+(i+1)))
  const updated=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  const rename=db.prepare('UPDATE split_bill_members SET name=? WHERE id=? AND paid=0')
  const setAmount=db.prepare('UPDATE split_bill_members SET amount=? WHERE id=?')
  updated.forEach((m,i)=>{if(names[i]) rename.run(names[i],m.id);setAmount.run(baseShare+(i<remainder?1:0),m.id)})
  return res.json({id:existing.id,shareAmount:share,shareCount:count,totalAmount:booking.total_price})
 }
 const result=db.prepare('INSERT INTO split_bills(booking_id,owner_user_id,total_amount,share_count,share_amount) VALUES(?,?,?,?,?)').run(booking.id,req.user.id,booking.total_price,count,share)
 const add=db.prepare('INSERT INTO split_bill_members(split_bill_id,name,amount) VALUES(?,?,?)')
 for(let i=0;i<count;i++) add.run(result.lastInsertRowid,names[i]||('เน€เธžเธทเนˆเธญเธ™เธ"เธ™เธ—เธตเนˆ '+(i+1)),baseShare+(i<remainder?1:0))
 res.status(201).json({id:result.lastInsertRowid,shareAmount:share,shareCount:count,totalAmount:booking.total_price})
})
app.get('/api/split-bills/booking/:bookingId', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE booking_id=? AND owner_user_id=? AND status='open'").get(req.params.bookingId,req.user.id)
 if(!bill) return res.status(404).json({error:'เธขเธฑเธ‡เน"เธกเนˆเธกเธตเธšเธดเธฅเธชเธณเธซเธฃเธฑเธšเธเธฒเธฃเธˆเธญเธ‡เธ™เธตเน‰'})
 const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 res.json({...bill,members})
})
app.post('/api/split-bills/:id/share-links', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธšเธดเธฅเธซเธฃเธทเธญเธšเธดเธฅเธ–เธนเธเธ›เธดเธ"เนเธฅเน‰เธง'})
 const members=db.prepare('SELECT id,name,paid FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 const update=db.prepare('UPDATE split_bill_members SET member_token_hash=? WHERE id=? AND split_bill_id=?')
 const links=members.map(m=>{const token=crypto.randomBytes(24).toString('hex');update.run(hashMemberToken(token),m.id,bill.id);return {memberId:m.id,name:m.name,token}})
 res.json({billId:bill.id,links})
})
app.get('/api/split-bills/share/:token', (req,res) => {
 const token=String(req.params.token||'')
 if(!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({error:'เธฅเธดเธ‡เธเนŒเธšเธดเธฅเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
 const row=db.prepare("SELECT sb.id bill_id,sb.total_amount,sb.status,sbm.id member_id,sbm.name,sbm.amount,sbm.paid,b.booking_date,b.start_time,b.end_time,v.name venue_name FROM split_bill_members sbm JOIN split_bills sb ON sb.id=sbm.split_bill_id JOIN bookings b ON b.id=sb.booking_id JOIN venues v ON v.id=b.venue_id WHERE sbm.member_token_hash=?").get(hashMemberToken(token))
 if(!row || row.status!=='open') return res.status(404).json({error:'เธฅเธดเธ‡เธเนŒเธšเธดเธฅเธ™เธตเน‰เธซเธกเธ"เธญเธฒเธขเธธเธซเธฃเธทเธญเธ›เธดเธ"เนเธฅเน‰เธง'})
 res.json(row)
})
app.post('/api/split-bills/share/:token/pay', (req,res) => {
 const token=String(req.params.token||'')
 if(!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({error:'เธฅเธดเธ‡เธเนŒเธšเธดเธฅเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
 const row=db.prepare("SELECT sb.id bill_id,sbm.id member_id,sbm.paid,sb.status FROM split_bill_members sbm JOIN split_bills sb ON sb.id=sbm.split_bill_id WHERE sbm.member_token_hash=?").get(hashMemberToken(token))
 if(!row || row.status!=='open') return res.status(404).json({error:'เธฅเธดเธ‡เธเนŒเธšเธดเธฅเธ™เธตเน‰เธซเธกเธ"เธญเธฒเธขเธธเธซเธฃเธทเธญเธ›เธดเธ"เนเธฅเน‰เธง'})
 if(row.paid) return res.status(409).json({error:'เธฃเธฒเธขเธเธฒเธฃเธ™เธตเน‰เธŠเธณเธฃเธฐเน€เธ‡เธดเธ™เนเธฅเน‰เธง'})
 db.prepare("UPDATE split_bill_members SET paid=1,paid_at=CURRENT_TIMESTAMP WHERE id=? AND split_bill_id=? AND paid=0").run(row.member_id,row.bill_id)
 res.json({ok:true,message:'เธขเธทเธ™เธขเธฑเธ™เธเธฒเธฃเธŠเธณเธฃเธฐเน€เธ‡เธดเธ™เนเธฅเน‰เธง'})
})
app.get('/api/split-bills/:id', auth, (req,res) => {
 const bill=db.prepare('SELECT * FROM split_bills WHERE id=? AND owner_user_id=?').get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธšเธดเธฅ'})
 const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 res.json({...bill,members})
})
app.post('/api/split-bills/:billId/members/:memberId/pay', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.billId,req.user.id)
 if(!bill) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธšเธดเธฅเธซเธฃเธทเธญเธšเธดเธฅเธ–เธนเธเธ›เธดเธ"เนเธฅเน‰เธง'})
 const member=db.prepare('SELECT id,paid FROM split_bill_members WHERE id=? AND split_bill_id=?').get(req.params.memberId,bill.id)
 if(!member) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธชเธกเธฒเธŠเธดเธเนƒเธ™เธšเธดเธฅ'})
 if(Number(member.paid)===1) return res.status(409).json({error:'เธชเธกเธฒเธŠเธดเธเธ"เธ™เธ™เธตเน‰เธŠเธณเธฃเธฐเน€เธ‡เธดเธ™เนเธฅเน‰เธง'})
 db.prepare("UPDATE split_bill_members SET paid=1,paid_at=CURRENT_TIMESTAMP WHERE id=? AND split_bill_id=? AND paid=0").run(member.id,bill.id)
 res.json({ok:true})
})
app.post('/api/split-bills/:id/close', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธšเธดเธฅเธซเธฃเธทเธญเธšเธดเธฅเธ–เธนเธเธ›เธดเธ"เนเธฅเน‰เธง'})
 const unpaid=db.prepare('SELECT COUNT(*) n FROM split_bill_members WHERE split_bill_id=? AND paid=0').get(bill.id).n
 if(unpaid>0) return res.status(409).json({error:'เธขเธฑเธ‡เธกเธตเธชเธกเธฒเธŠเธดเธเธ—เธตเนˆเธขเธฑเธ‡เน"เธกเนˆเธˆเนˆเธฒเธข '+unpaid+' เธ"เธ™'})
 db.prepare("UPDATE split_bills SET status='closed' WHERE id=?").run(bill.id)
 db.prepare('UPDATE matches SET open_for_join=0 WHERE booking_id=?').run(bill.booking_id)
 res.json({ok:true,message:'ปิดบิลเรียบร้อยแล้ว'})
})

app.patch('/api/admin/venues/:id/owner', auth, (req,res) => {
 if(req.user.role!=='admin') return res.status(403).json({error:'เน€เธ‰เธžเธฒเธฐเนเธญเธ"เธกเธดเธ™เน€เธ—เนˆเธฒเธ™เธฑเน‰เธ™'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if(!venue) return res.status(404).json({error:'เน"เธกเนˆเธžเธšเธชเธ™เธฒเธก'})
 const ownerId=req.body.ownerId==null||req.body.ownerId===''?null:Number(req.body.ownerId)
 if(ownerId!==null){
  if(!Number.isInteger(ownerId)) return res.status(400).json({error:'เน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธชเธ™เธฒเธกเน"เธกเนˆเธ–เธนเธเธ•เน‰เธญเธ‡'})
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND role='owner'").get(ownerId)
  if(!owner) return res.status(400).json({error:'เธœเธนเน‰เนƒเธŠเน‰เธ"เธ™เธ™เธตเน‰เน"เธกเนˆเธกเธตเธชเธดเธ—เธ˜เธดเนŒเน€เธ›เน‡เธ™เน€เธˆเน‰เธฒเธ\\\'เธญเธ‡เธชเธ™เธฒเธก'})
 }
 db.prepare('UPDATE venues SET owner_id=? WHERE id=?').run(ownerId,venue.id)
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(venue.id))
})

app.listen(PORT, HOST, () => console.log('PorsBall API running on '+HOST+':'+PORT))

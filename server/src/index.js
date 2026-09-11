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
app.use(express.json({limit:'1mb'}))
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
  if(!dbUser) return res.status(401).json({error:'เนเธกเนเธเธเธเธนเนเนเธเนเธเธฒเธ'})
  if(Number(req.user.ver||0)!==Number(dbUser.auth_version||0)) return res.status(401).json({error:'เน€เธเธชเธเธฑเธเธซเธกเธ”เธญเธฒเธขเธธ เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธเนเธซเธกเน'})
  req.user=dbUser
  next()
 } catch { res.status(401).json({error:'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ'}) }
}

const notify = (userId,type,title,message) => {
 const titles={booking:'เธกเธตเธเธฒเธฃเธเธญเธเธชเธเธฒเธกเนเธซเธกเน',cancel:'เธเธฒเธฃเธเธญเธเธ–เธนเธเธขเธเน€เธฅเธดเธ',match_close:'เน€เธเนเธฒเธเธญเธเธเธฑเธ”เธเธดเธ”เธฃเธฑเธเธเธ',join:'เธกเธตเธเธเน€เธเนเธฒเธฃเนเธงเธกเธเธฑเธ”',leave:'เธกเธตเธเธเธญเธญเธเธเธฒเธเธเธฑเธ”',remove:'เธเธธเธ“เธ–เธนเธเธเธณเธญเธญเธเธเธฒเธเธเธฑเธ”'}
 const safeTitle=isBrokenThai(title)?(titles[type]||'เธกเธตเธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธเนเธซเธกเน'):title
 const safeMessage=isBrokenThai(message)?({booking:'เธกเธตเธเธฒเธฃเธเธญเธเธชเธเธฒเธกเนเธซเธกเน',cancel:'เธเธฒเธฃเธเธญเธเธ–เธนเธเธขเธเน€เธฅเธดเธ',match_close:'เน€เธเนเธฒเธเธญเธเธเธฑเธ”เธเธดเธ”เธฃเธฑเธเธเธ',join:'เธกเธตเธเธเน€เธเนเธฒเธฃเนเธงเธกเธเธฑเธ”',leave:'เธกเธตเธเธเธญเธญเธเธเธฒเธเธเธฑเธ”',remove:'เธเธธเธ“เธ–เธนเธเธเธณเธญเธญเธเธเธฒเธเธเธฑเธ”'}[type]||'เธกเธตเธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธเนเธซเธกเน'):message
 return db.prepare('INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?)').run(userId,type,safeTitle,safeMessage)
}

const bangkokDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date())
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00+07:00`).getTime()) && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(`${date}T00:00:00+07:00`))===date
const bookingState = (date,start,end) => { const now=new Date(); const from=new Date(`${date}T${start}:00+07:00`); const to=new Date(`${date}T${end}:00+07:00`); return now>=to?'EXPIRED':now>=from?'IN_PROGRESS':'UPCOMING' }

app.get('/api/health', (_,res) => res.json({ok:true, service:'PorsBall API'}))
const publicVenueSelect=`SELECT v.*,COALESCE(f.name,v.name) facility_name,COALESCE(f.address,v.address) facility_address,f.phone facility_phone,f.description facility_description,f.image facility_image,
 CASE WHEN v.facility_id IS NULL THEN 1 ELSE (SELECT COUNT(*) FROM venues vf WHERE vf.facility_id=v.facility_id AND vf.review_status='approved' AND vf.service_status='active') END facility_field_count
 FROM venues v LEFT JOIN facilities f ON f.id=v.facility_id`
app.get('/api/venues', (req,res) => {
 const q = `%${req.query.q || ''}%`
 const rows = db.prepare(`${publicVenueSelect} WHERE v.review_status='approved' AND v.service_status='active' AND (v.name LIKE ? OR v.area LIKE ? OR f.name LIKE ? OR f.address LIKE ?) ORDER BY f.name,v.id`).all(q,q,q,q)
 res.json(rows)
})
app.get('/api/facilities/:id', (req,res) => {
 const facility=db.prepare('SELECT * FROM facilities WHERE id=?').get(req.params.id)
 if(!facility) return res.status(404).json({error:'ไม่พบสถานที่'})
 const fields=db.prepare(`${publicVenueSelect} WHERE v.facility_id=? AND v.review_status='approved' AND v.service_status='active' ORDER BY v.id`).all(req.params.id)
 res.json({...facility,fields})
})
app.get('/api/owner/facilities', auth, (req,res) => {
 if(req.user.role!=='owner'&&req.user.role!=='admin') return res.status(403).json({error:'ไม่มีสิทธิ์จัดการสถานที่'})
 const facilities=db.prepare('SELECT * FROM facilities WHERE owner_id=? ORDER BY id DESC').all(req.user.id)
 res.json(facilities.map(f=>({...f,fields:db.prepare('SELECT * FROM venues WHERE facility_id=? ORDER BY id').all(f.id)})))
})
const imageValue=(value)=>{if(value==null||value==='')return null;const x=String(value);return /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(x)&&x.length<=180000?x:null}
app.post('/api/owner/facilities', auth, (req,res) => {
 if(req.user.role!=='owner') return res.status(403).json({error:'เฉพาะเจ้าของสถานที่เท่านั้น'})
 const name=String(req.body.name||'').trim(),address=String(req.body.address||'').trim(),phone=String(req.body.phone||'').trim(),description=String(req.body.description||'').trim(),image=imageValue(req.body.image)
 if(!name||!address||name.length>120||address.length>300||phone.length>30||description.length>500) return res.status(400).json({error:'กรุณากรอกข้อมูลสถานที่ให้ถูกต้อง'})
 if(req.body.image&&!image) return res.status(400).json({error:'รูปสถานที่ไม่ถูกต้องหรือมีขนาดใหญ่เกินไป'})
 const r=db.prepare('INSERT INTO facilities(owner_id,name,address,phone,description,image) VALUES(?,?,?,?,?,?)').run(req.user.id,name,address,phone,description,image)
 res.status(201).json(db.prepare('SELECT * FROM facilities WHERE id=?').get(r.lastInsertRowid))
})
app.patch('/api/owner/facilities/:id', auth, (req,res) => {
 const f=db.prepare('SELECT * FROM facilities WHERE id=? AND owner_id=?').get(req.params.id,req.user.id)
 if(!f) return res.status(404).json({error:'ไม่พบสถานที่ของคุณ'})
 const name=String(req.body.name??f.name).trim(),address=String(req.body.address??f.address).trim(),phone=String(req.body.phone??f.phone).trim(),description=String(req.body.description??f.description).trim(),image=req.body.image===undefined?f.image:imageValue(req.body.image)
 if(!name||!address||name.length>120||address.length>300||phone.length>30||description.length>500) return res.status(400).json({error:'กรุณากรอกข้อมูลสถานที่ให้ถูกต้อง'})
 if(req.body.image!==undefined&&req.body.image!==null&&!image) return res.status(400).json({error:'รูปสถานที่ไม่ถูกต้องหรือมีขนาดใหญ่เกินไป'})
 db.prepare('UPDATE facilities SET name=?,address=?,phone=?,description=?,image=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name,address,phone,description,image,f.id)
 res.json(db.prepare('SELECT * FROM facilities WHERE id=?').get(f.id))
})
app.post('/api/owner/facilities/:id/fields', auth, (req,res) => {
 const f=db.prepare('SELECT * FROM facilities WHERE id=? AND owner_id=?').get(req.params.id,req.user.id)
 if(!f) return res.status(404).json({error:'ไม่พบสถานที่ของคุณ'})
 const name=String(req.body.name||'').trim(),area=String(req.body.area||f.name).trim(),address=String(req.body.address||f.address).trim(),price=Number(req.body.price_per_hour),fieldTypes=String(req.body.field_types||'5v5').trim(),roof=req.body.roof?1:0,image=imageValue(req.body.image)
 if(!name||!area||!address||!fieldTypes||!Number.isFinite(price)||price<=0) return res.status(400).json({error:'กรุณากรอกข้อมูลสนามให้ครบ'})
 if(req.body.image&&!image) return res.status(400).json({error:'รูปสนามไม่ถูกต้องหรือมีขนาดใหญ่เกินไป'})
 const r=db.prepare("INSERT INTO venues(name,area,address,rating,price_per_hour,roof,field_types,owner_id,facility_id,image,service_status,review_status,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending_review',CURRENT_TIMESTAMP)").run(name,area,address,0,price,roof,fieldTypes,req.user.id,f.id,image,'active')
 res.status(201).json(db.prepare(`${publicVenueSelect} WHERE v.id=?`).get(r.lastInsertRowId))
})
app.get('/api/venues/:id', (req,res) => {
 const venue = db.prepare(`${publicVenueSelect} WHERE v.id=? AND v.review_status='approved' AND v.service_status='active'`).get(req.params.id)
 if (!venue) return res.status(404).json({error:'ไม่พบสนาม'})
 res.json(venue)
})
app.get('/api/admin/users', auth, (req,res) => {
 if (req.user.role !== 'admin') return res.status(403).json({error:'เน€เธเธเธฒเธฐเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธเน€เธ—เนเธฒเธเธฑเนเธ'})
 const rows=db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users ORDER BY id DESC').all()
 res.json(rows)
})
app.patch('/api/admin/users/:id/role', auth, (req,res) => {
 if (req.user.role !== 'admin') return res.status(403).json({error:'เน€เธเธเธฒเธฐเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธเน€เธ—เนเธฒเธเธฑเนเธ'})
 const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.params.id)
 if(!user) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const role=String(req.body.role||'').trim()
 if(!['player','owner','admin'].includes(role)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(user.id===req.user.id && role!=='admin') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(user.role==='owner' && role!=='owner' && db.prepare('SELECT 1 FROM venues WHERE owner_id=? LIMIT 1').get(user.id)) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 db.prepare('UPDATE users SET role=?,auth_version=auth_version+1 WHERE id=?').run(role,user.id)
 res.json(db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users WHERE id=?').get(user.id))
})

app.get('/api/owner/venues', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const rows = req.user.role === 'admin'
  ? db.prepare(`${publicVenueSelect} ORDER BY v.id DESC`).all()
  : db.prepare(`${publicVenueSelect} WHERE v.owner_id=? ORDER BY v.id DESC`).all(req.user.id)
 res.json(rows)
})
app.patch('/api/owner/venues/:id', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const venue = db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if (!venue) return res.status(404).json({error:'เนเธกเนเธเธเธชเธเธฒเธก'})
 if (req.user.role !== 'admin' && venue.owner_id !== req.user.id) return res.status(403).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const {name,area,address,pricePerHour,price_per_hour,roof,fieldTypes,field_types,image,serviceStatus} = req.body
 const finalPrice = Number(pricePerHour ?? price_per_hour)
 const finalFields = String(fieldTypes ?? field_types ?? '').trim()
 const finalName = String(name ?? '').trim()
 const finalArea = String(area ?? '').trim()
 const finalAddress = String(address ?? '').trim()
 const finalImage=image===undefined?venue.image:imageValue(image)
 const finalServiceStatus=String(serviceStatus ?? venue.service_status ?? 'active')
 if (!finalName || !finalArea || !finalAddress || !finalFields || !Number.isFinite(finalPrice) || finalPrice <= 0) return res.status(400).json({error:'กรุณากรอกข้อมูลสนามให้ครบ'})
 if(!['active','maintenance','inactive'].includes(finalServiceStatus)) return res.status(400).json({error:'สถานะสนามไม่ถูกต้อง'})
 if(image!==undefined&&image!==null&&!finalImage) return res.status(400).json({error:'รูปสนามไม่ถูกต้องหรือมีขนาดใหญ่เกินไป'})
 const needsReview=req.user.role==='owner' && ['changes_requested','rejected','draft'].includes(String(venue.review_status));
 const nextStatus=needsReview?'pending_review':venue.review_status;
 db.prepare('UPDATE venues SET name=?,area=?,address=?,price_per_hour=?,roof=?,field_types=?,image=?,service_status=?,review_status=?,review_note=?,submitted_at=CASE WHEN ?=\'pending_review\' THEN CURRENT_TIMESTAMP ELSE submitted_at END WHERE id=?').run(finalName,finalArea,finalAddress,finalPrice,roof?1:0,finalFields,finalImage,finalServiceStatus,nextStatus,needsReview?'':venue.review_note,nextStatus,req.params.id);
 if(needsReview) db.prepare('INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)').run(venue.id,req.user.id,'resubmitted','Owner updated requested changes and resubmitted')
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id))
})
app.post('/api/auth/register', async (req,res) => {
 const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||''), phone=String(req.body.phone||'').trim(), address=String(req.body.address||'').trim()
 if (!name || !email || !password || !phone || !address) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเนเธญเธกเธนเธฅเนเธซเนเธเธฃเธ'})
 if (name.length>80) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if (password.length<8) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if (phone.length<8 || phone.length>20) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเน€เธเธญเธฃเนเนเธ—เธฃเนเธซเนเธ–เธนเธเธ•เนเธญเธ'})
 if (address.length>300) return res.status(400).json({error:'เธ—เธตเนเธญเธขเธนเนเธขเธฒเธงเน€เธเธดเธเนเธ'})
 try {
  const hash = await bcrypt.hash(password,10)
  const info = db.prepare('INSERT INTO users(name,email,password_hash,phone,address) VALUES(?,?,?,?,?)').run(name,email,hash,phone,address)
  const user = db.prepare('SELECT id,name,email,role,points,wins,losses,phone,address,avatar FROM users WHERE id=?').get(info.lastInsertRowid)
  res.status(201).json({token:tokenFor(user),user})
 } catch { res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'}) }
})
app.post('/api/auth/login', async (req,res) => {
 const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'')
 if(!email || !password) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธญเธตเน€เธกเธฅเนเธฅเธฐเธฃเธซเธฑเธชเธเนเธฒเธ'})
 const user = db.prepare('SELECT * FROM users WHERE email=?').get(email)
 if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'เธญเธตเน€เธกเธฅเธซเธฃเธทเธญเธฃเธซเธฑเธชเธเนเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ'})
 const safe = {id:user.id,name:user.name,email:user.email,role:user.role,points:user.points,wins:user.wins,losses:user.losses,phone:user.phone||null,address:user.address||null,avatar:user.avatar||null,auth_version:user.auth_version}
 res.json({token:tokenFor(safe),user:safe})
})
const hashResetCode = (code) => crypto.createHash('sha256').update(code).digest('hex')
const hashMemberToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const sendResetEmail = async (email, code) => {
 const key=process.env.RESEND_API_KEY, from=process.env.RESEND_FROM
 if(!key || !from) return false
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[email],subject:'PorsBall - เธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธชเธเนเธฒเธ',html:'<p>เธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธ PorsBall เธชเธณเธซเธฃเธฑเธเน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธชเธเนเธฒเธเธเธญเธเธเธธเธ“เธเธทเธญ <strong>'+code+'</strong></p><p>เธฃเธซเธฑเธชเธเธตเนเนเธเนเนเธ”เน 10 เธเธฒเธ—เธต เนเธฅเธฐเนเธเนเนเธ”เนเน€เธเธตเธขเธเธเธฃเธฑเนเธเน€เธ”เธตเธขเธง</p>'})})
 if(!r.ok) throw new Error('เธชเนเธเธญเธตเน€เธกเธฅเนเธกเนเธชเธณเน€เธฃเนเธ')
 return true
}
app.post('/api/auth/forgot-password', async (req,res) => {
 const email=(req.body.email||'').trim().toLowerCase()
 if(!email) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธญเธตเน€เธกเธฅ'})
 const user=db.prepare('SELECT id,email FROM users WHERE email=?').get(email)
 const generic={message:'เธซเธฒเธเธญเธตเน€เธกเธฅเธเธตเนเธกเธตเธเธฑเธเธเธต PorsBall เธฃเธฐเธเธเธเธฐเธชเนเธเธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธเนเธซเนเธเธธเธ“'}
 if(!user) return res.json(generic)
 const recent=db.prepare("SELECT created_at FROM password_resets WHERE user_id=? ORDER BY id DESC LIMIT 1").get(user.id)
 if(recent && Date.now()-Date.parse(recent.created_at+'Z')<60000) return res.json(generic)
 const code=String(crypto.randomInt(100000,1000000))
 db.prepare("UPDATE password_resets SET used=1 WHERE user_id=? AND used=0").run(user.id)
 db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at) VALUES(?,?,?)').run(user.id,hashResetCode(code),Date.now()+10*60*1000)
 try { const sent=await sendResetEmail(email,code); if(!sent && process.env.NODE_ENV!=='production') return res.json({...generic,devCode:code}) } catch { if(process.env.NODE_ENV!=='production') return res.status(500).json({...generic,devCode:code,error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'}); return res.json(generic) }
 res.json(generic)
})
app.post('/api/auth/reset-password', async (req,res) => {
 const email=(req.body.email||'').trim().toLowerCase(), code=String(req.body.code||'').trim(), newPassword=req.body.newPassword||''
if(!email||!/^\d{6}$/.test(code)||newPassword.length<8) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธญเธตเน€เธกเธฅ เธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธ 6 เธซเธฅเธฑเธ เนเธฅเธฐเธฃเธซเธฑเธชเธเนเธฒเธเนเธซเธกเนเธญเธขเนเธฒเธเธเนเธญเธข 8 เธ•เธฑเธงเธญเธฑเธเธฉเธฃ'})
 const user=db.prepare('SELECT id FROM users WHERE email=?').get(email)
 if(!user) return res.status(400).json({error:'เธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธเนเธกเนเธ–เธนเธเธ•เนเธญเธเธซเธฃเธทเธญเธซเธกเธ”เธญเธฒเธขเธธ'})
 const row=db.prepare('SELECT * FROM password_resets WHERE user_id=? AND used=0 ORDER BY id DESC LIMIT 1').get(user.id)
 if(!row || row.expires_at<Date.now() || row.attempts>=5) return res.status(400).json({error:'เธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธเนเธกเนเธ–เธนเธเธ•เนเธญเธเธซเธฃเธทเธญเธซเธกเธ”เธญเธฒเธขเธธ'})
 if(hashResetCode(code)!==row.code_hash){ db.prepare('UPDATE password_resets SET attempts=attempts+1 WHERE id=?').run(row.id); return res.status(400).json({error:'เธฃเธซเธฑเธชเธขเธทเธเธขเธฑเธเนเธกเนเธ–เธนเธเธ•เนเธญเธเธซเธฃเธทเธญเธซเธกเธ”เธญเธฒเธขเธธ'}) }
 const hash=await bcrypt.hash(newPassword,10)
 db.prepare('UPDATE users SET password_hash=?, auth_version=auth_version+1 WHERE id=?').run(hash,user.id)
 db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(row.id)
 res.json({ok:true,message:'เน€เธเธฅเธตเนเธขเธเธฃเธซเธฑเธชเธเนเธฒเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง'})
})
app.get('/api/notifications', auth, (req,res) => { const rows=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id); res.json(rows) })
app.post('/api/notifications/:id/read', auth, (req,res) => { db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id); res.json({ok:true}) })
app.post('/api/notifications/read-all', auth, (req,res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ok:true}) })

app.get('/api/me', auth, (req,res) => {
 const user = db.prepare('SELECT id,name,email,role,points,wins,losses,phone,address,avatar,created_at FROM users WHERE id=?').get(req.user.id)
 res.json(user)
})
app.patch('/api/me', auth, (req,res) => {
 const name=String(req.body.name||'').trim(), phone=String(req.body.phone||'').trim(), address=String(req.body.address||'').trim()
 const avatar=req.body.avatar==null||req.body.avatar===''?null:String(req.body.avatar)
 if(!name||name.length>80)return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเธทเนเธญเนเธซเนเธ–เธนเธเธ•เนเธญเธ'})
 if(phone.length<8||phone.length>20)return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเน€เธเธญเธฃเนเนเธ—เธฃเนเธซเนเธ–เธนเธเธ•เนเธญเธ'})
 if(!address||address.length>300)return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธ—เธตเนเธญเธขเธนเนเนเธซเนเธ–เธนเธเธ•เนเธญเธ'})
 if(avatar && (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(avatar)||avatar.length>180000)) return res.status(400).json({error:'เธฃเธนเธเนเธเธฃเนเธเธฅเนเนเธกเนเธ–เธนเธเธ•เนเธญเธเธซเธฃเธทเธญเธกเธตเธเธเธฒเธ”เนเธซเธเนเน€เธเธดเธเนเธ'})
 db.prepare('UPDATE users SET name=?,phone=?,address=?,avatar=? WHERE id=?').run(name,phone,address,avatar,req.user.id)
 res.json(db.prepare('SELECT id,name,email,role,points,wins,losses,phone,address,avatar FROM users WHERE id=?').get(req.user.id))
})

app.get('/api/venues/:id/slots', (req,res) => {
 const date = String(req.query.date || bangkokDate())
 if(!validDate(date)) return res.status(400).json({error:'เธงเธฑเธเธ—เธตเนเนเธกเนเธ–เธนเธเธ•เนเธญเธ'})
 const venue=db.prepare("SELECT service_status,review_status FROM venues WHERE id=?").get(req.params.id)
 if(!venue||venue.review_status!=='approved') return res.status(404).json({error:'ไม่พบสนาม'})
 if(venue.service_status!=='active') return res.json({date,slots:[]})
 const booked = new Set(db.prepare('SELECT start_time FROM bookings WHERE venue_id=? AND booking_date=? AND status=?').all(req.params.id,date,'confirmed').map(x=>x.start_time))
 const slots = ['16:00','17:00','18:00','19:00','20:00','21:00','22:00'].map(start => ({start,end:`${String(Number(start.slice(0,2))+1).padStart(2,'0')}:00`,available:!booked.has(start)}))
 res.json({date,slots})
})
app.post('/api/bookings', auth, (req,res) => {
 const {venueId,bookingDate,startTime,endTime,totalPrice} = req.body
 if (!venueId || !bookingDate || !startTime || !endTime) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if (!validDate(String(bookingDate))) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const venue=db.prepare("SELECT id,price_per_hour,owner_id,name,review_status,service_status FROM venues WHERE id=?").get(venueId)
 if(!venue) return res.status(404).json({error:'ไม่พบสนาม'})
 if(venue.review_status!=='approved'||venue.service_status!=='active') return res.status(409).json({error:'สนามนี้ยังไม่พร้อมให้บริการ'})
 const clientPrice=Number(totalPrice)
 if(!Number.isFinite(clientPrice)||clientPrice<=0||clientPrice!==Number(venue.price_per_hour)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 try {
  if(!/^\d{2}:00$/.test(startTime)||!/^\d{2}:00$/.test(endTime)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  const startHour=Number(startTime.slice(0,2)),endHour=Number(endTime.slice(0,2))
  if(startHour<16||startHour>22||endHour!==startHour+1) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  if (startTime >= endTime) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  const startAt=new Date(`${bookingDate}T${startTime}:00+07:00`)
  const endAt=new Date(`${bookingDate}T${endTime}:00+07:00`)
  if(Number.isNaN(startAt.getTime())||Number.isNaN(endAt.getTime())) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  if(startAt<=new Date() || endAt<=startAt) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  const overlap = db.prepare("SELECT id FROM bookings WHERE venue_id=? AND booking_date=? AND status='confirmed' AND start_time < ? AND end_time > ? LIMIT 1").get(venueId,bookingDate,endTime,startTime)
  if (overlap) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  const cancelled = db.prepare("SELECT * FROM bookings WHERE venue_id=? AND booking_date=? AND start_time=? AND status='cancelled'").get(venueId,bookingDate,startTime)
  if (cancelled) {
   db.prepare('DELETE FROM matches WHERE booking_id=?').run(cancelled.id)
   db.prepare('DELETE FROM split_bills WHERE booking_id=?').run(cancelled.id)
   db.prepare("UPDATE bookings SET user_id=?,end_time=?,total_price=?,status='confirmed',created_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,endTime,venue.price_per_hour,cancelled.id)
   if (venue.owner_id && Number(venue.owner_id)!==req.user.id) {
    const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)
    notify(Number(venue.owner_id),'booking','เน€เธเธเน€เธเธ•เน€เธยเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธโ€กเน€เธเธเน€เธโขเน€เธเธ’เน€เธเธเน€เธฦ’เน€เธเธเน€เธเธเน€เธห',`${u?.name||'เน€เธล“เน€เธเธเน€เธโ€ฐเน€เธโฌเน€เธเธ…เน€เธหเน€เธโข'} เน€เธยเน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธเธ’เน€เธเธ ${bookingDate} ${startTime}-${endTime}`)
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
   notify(Number(venue.owner_id),'booking','เน€เธเธเน€เธเธ•เน€เธยเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธโ€กเน€เธเธเน€เธโขเน€เธเธ’เน€เธเธเน€เธฦ’เน€เธเธเน€เธเธเน€เธห',`${u?.name||'เน€เธล“เน€เธเธเน€เธโ€ฐเน€เธโฌเน€เธเธ…เน€เธหเน€เธโข'} เน€เธยเน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธเธ’เน€เธเธ ${bookingDate} ${startTime}-${endTime}`)
  }
  res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId))
 } catch { res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'}) }
})
app.get('/api/bookings/me', auth, (req,res) => res.json(db.prepare("SELECT b.*,v.name venue_name,m.id match_id,m.open_for_join FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN matches m ON m.booking_id=b.id WHERE b.user_id=? AND b.status='confirmed' AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=b.id AND sb.status='closed') ORDER BY b.booking_date DESC,b.start_time DESC").all(req.user.id)))
app.get('/api/owner/bookings', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const rows = req.user.role === 'admin'
  ? db.prepare("SELECT b.*,v.name venue_name,u.name user_name,u.email user_email FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id ORDER BY b.booking_date DESC,b.start_time DESC").all()
  : db.prepare("SELECT b.*,v.name venue_name,u.name user_name,u.email user_email FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id WHERE v.owner_id=? ORDER BY b.booking_date DESC,b.start_time DESC").all(req.user.id)
 const now=Date.now()
 res.json(rows.map(b=>{const start=new Date(b.booking_date+'T'+b.start_time+':00+07:00').getTime();const end=new Date(b.booking_date+'T'+b.end_time+':00+07:00').getTime();const state=String(b.status).toUpperCase()==='CANCELLED'?'CANCELLED':now<start?'UPCOMING':now<end?'IN_PROGRESS':'COMPLETED';return {...b,state}}))
})
app.post('/api/bookings/:id/cancel', auth, (req,res) => { const b=db.prepare("SELECT b.*,v.name venue_name,v.owner_id FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=? AND b.user_id=? AND b.status='confirmed'").get(req.params.id,req.user.id); if(!b)return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'}); const now=new Date(),start=new Date(`${b.booking_date}T${b.start_time}:00+07:00`),end=new Date(`${b.booking_date}T${b.end_time}:00+07:00`); if(now>=start)return res.status(409).json({error:now>=end?'เน€เธโฌเน€เธเธ…เน€เธเธเน€เธโฌเน€เธเธเน€เธเธ…เน€เธเธ’เน€เธหเน€เธเธเน€เธโ€กเน€เธยเน€เธเธ…เน€เธโ€ฐเน€เธเธ เน€เธ"เน€เธเธเน€เธหเน€เธเธเน€เธเธ’เน€เธเธเน€เธเธ’เน€เธเธเน€เธโ€“เน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธเธ”เน€เธยเน€เธ"เน€เธ"เน€เธโ€ฐ':'เน€เธเธเน€เธโขเน€เธเธ’เน€เธเธเน€เธยเน€เธเธ“เน€เธเธ…เน€เธเธ‘เน€เธโ€กเน€เธฦ’เน€เธล เน€เธโ€ฐเน€เธโ€กเน€เธเธ’เน€เธโขเน€เธเธเน€เธเธเน€เธเธเน€เธห เน€เธ"เน€เธเธเน€เธหเน€เธเธเน€เธเธ’เน€เธเธเน€เธเธ’เน€เธเธเน€เธโ€“เน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธเธ”เน€เธยเน€เธยเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธโ€กเน€เธ"เน€เธ"เน€เธโ€ฐ'}); db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id); const members=db.prepare('SELECT user_id FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE m.booking_id=? AND mp.user_id<>?').all(b.id,b.user_id); db.prepare('UPDATE matches SET open_for_join=0 WHERE booking_id=?').run(b.id); db.prepare("UPDATE split_bills SET status='closed' WHERE booking_id=? AND status='open'").run(b.id); members.forEach(x=>notify(x.user_id,'cancel','เน€เธโขเน€เธเธ‘เน€เธ"เน€เธโ€“เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธเธ”เน€เธย',`เน€เธยเน€เธเธ‘เน€เธโ€เน€เธยเน€เธเธเน€เธยเน€เธยเน€เธเธเน€เธโ€ ${b.booking_date} ${b.start_time} เน€เธโ€“เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธเธ”เน€เธย`)); if(b.owner_id && Number(b.owner_id)!==req.user.id) notify(Number(b.owner_id),'cancel','เน€เธยเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธโ€กเน€เธโ€“เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธเธ”เน€เธย',`เน€เธยเน€เธเธ’เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธเธ’เน€เธเธ ${b.venue_name} เน€เธเธเน€เธเธ‘เน€เธยเน€เธโ€”เน€เธเธ•เน€เธย ${b.booking_date} เน€เธโฌเน€เธเธเน€เธเธ…เน€เธเธ’ ${b.start_time}-${b.end_time} เน€เธโ€“เน€เธเธเน€เธยเน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธเธ”เน€เธย`); res.json({ok:true}) })
app.get('/api/matches', (req,res) => {
 const rows = db.prepare(`SELECT m.*,v.name venue_name,b.end_time,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.open_for_join=1 AND (b.status='confirmed') AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=m.booking_id AND sb.status='closed') ORDER BY m.match_date,m.start_time`).all()
 const visible = rows.filter(r => bookingState(r.match_date,r.start_time,r.end_time) !== 'EXPIRED')
 res.json(visible.map(r=>({...r,state:bookingState(r.match_date,r.start_time,r.end_time)})))
})
app.post('/api/matches', auth, (req,res) => {
 const {bookingId,title,fee,maxPlayers=10} = req.body
 if (!bookingId || !title || !fee) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const booking=db.prepare("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'").get(bookingId,req.user.id)
 if (!booking) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const matchState=bookingState(booking.booking_date,booking.start_time,booking.end_time)
 if(matchState!=='UPCOMING') return res.status(409).json({error:matchState==='EXPIRED'?'เน€เธยเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธโ€กเน€เธโขเน€เธเธ•เน€เธโ€ฐเน€เธโฌเน€เธเธ…เน€เธเธเน€เธโฌเน€เธเธเน€เธเธ…เน€เธเธ’เน€เธยเน€เธเธ…เน€เธโ€ฐเน€เธเธ เน€เธ"เน€เธเธเน€เธหเน€เธเธเน€เธเธ’เน€เธเธเน€เธเธ’เน€เธเธเน€เธโ€“เน€เธเธเน€เธเธเน€เธโ€ฐเน€เธเธ’เน€เธโ€กเน€เธโขเน€เธเธ‘เน€เธ"เน€เธ"เน€เธ"เน€เธโ€ฐ':'เน€เธยเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธโ€กเน€เธโขเน€เธเธ•เน€เธโ€ฐเน€เธโฌเน€เธเธเน€เธเธ”เน€เธหเน€เธเธเน€เธยเน€เธเธ…เน€เธโ€ฐเน€เธเธ เน€เธ"เน€เธเธเน€เธหเน€เธเธเน€เธเธ’เน€เธเธเน€เธเธ’เน€เธเธเน€เธโ€“เน€เธเธเน€เธเธเน€เธโ€ฐเน€เธเธ’เน€เธโ€กเน€เธโขเน€เธเธ‘เน€เธ"เน€เธ"เน€เธ"เน€เธโ€ฐ'})
 const max=Number(maxPlayers)
 if(!Number.isInteger(max)||max<2||max>30) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const matchFee=Number(fee)
 if(!Number.isFinite(matchFee)||matchFee<=0) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const existingMatch=db.prepare('SELECT * FROM matches WHERE booking_id=? ORDER BY id DESC LIMIT 1').get(booking.id)
 if(existingMatch) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const result=db.prepare('INSERT INTO matches(creator_id,venue_id,title,match_date,start_time,fee,max_players,booking_id,open_for_join) VALUES(?,?,?,?,?,?,?,?,1)').run(req.user.id,booking.venue_id,title.trim(),booking.booking_date,booking.start_time,matchFee,max,booking.id)
 db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(result.lastInsertRowid,req.user.id)
 res.status(201).json(db.prepare('SELECT * FROM matches WHERE id=?').get(result.lastInsertRowid))
})
app.post('/api/matches/:id/open', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=? AND m.creator_id=?').get(req.params.id,req.user.id)
 if(!m) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const closedBill=db.prepare("SELECT 1 FROM split_bills WHERE booking_id=? AND status='closed' LIMIT 1").get(m.booking_id)
 if(closedBill) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 db.prepare('UPDATE matches SET open_for_join=1 WHERE id=?').run(m.id)
 res.json({ok:true})
})
app.post('/api/matches/:id/close', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.status booking_status,b.booking_date,b.end_time FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=? AND m.creator_id=?').get(req.params.id,req.user.id)
 if(!m) return res.status(404).json({error:'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธฑเธ”เธเธญเธเธเธธเธ“'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เธเธฒเธฃเธเธญเธเธชเธเธฒเธกเธ–เธนเธเธขเธเน€เธฅเธดเธเนเธฅเนเธง'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เธเธฑเธ”เธเธตเนเน€เธฃเธดเนเธกเธซเธฃเธทเธญเธซเธกเธ”เน€เธงเธฅเธฒเนเธฅเนเธง'})
 db.prepare('UPDATE matches SET open_for_join=0 WHERE id=?').run(m.id)
 const players=db.prepare('SELECT user_id FROM match_players WHERE match_id=? AND user_id<>?').all(m.id,m.creator_id)
 players.forEach(x=>notify(x.user_id,'match_close','เน€เธโฌเน€เธหเน€เธโ€ฐเน€เธเธ’เน€เธ\\\'เน€เธเธเน€เธโ€กเน€เธโขเน€เธเธ‘เน€เธ"เน€เธโ€บเน€เธเธ”เน€เธ"เน€เธเธเน€เธเธ‘เน€เธลกเน€เธ"เน€เธโข',`เน€เธยเน€เธเธ‘เน€เธโ€ ${m.title} เน€เธยเน€เธเธ”เน€เธโ€เน€เธเธเน€เธเธ‘เน€เธยเน€เธยเน€เธเธเน€เธยเน€เธโฌเน€เธเธ…เน€เธยเน€เธยเน€เธโฌเน€เธยเน€เธเธ”เน€เธยเน€เธเธเน€เธโฌเน€เธโ€ขเน€เธเธ”เน€เธเธเน€เธยเน€เธเธ…เน€เธยเน€เธเธ`))
 res.json({ok:true})
})
app.get('/api/matches/me', auth, (req,res) => {
 const rows=db.prepare("SELECT m.*,v.name venue_name,b.end_time,b.status booking_status,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.creator_id=? AND b.status='confirmed' AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=m.booking_id AND sb.status='closed') ORDER BY m.match_date,m.start_time").all(req.user.id)
 res.json(rows.map(r=>({...r,state:bookingState(r.match_date,r.start_time,r.end_time)})))
})
app.post('/api/matches/:id/join', auth, (req,res) => {
 const match = db.prepare("SELECT m.*,b.end_time,b.status booking_status FROM matches m LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.id=?").get(req.params.id)
 if (match && match.booking_status !== 'confirmed') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if (!match) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const state=bookingState(match.match_date,match.start_time,match.end_time)
 if(state!=='UPCOMING') return res.status(409).json({error:state==='EXPIRED'?'เน€เธโขเน€เธเธ‘เน€เธ"เน€เธโขเน€เธเธ•เน€เธโ€ฐเน€เธโฌเน€เธเธ…เน€เธเธเน€เธโฌเน€เธเธเน€เธเธ…เน€เธเธ’เน€เธหเน€เธเธเน€เธโ€กเน€เธยเน€เธเธ…เน€เธโ€ฐเน€เธเธ':'เน€เธโขเน€เธเธ‘เน€เธ"เน€เธโขเน€เธเธ•เน€เธโ€ฐเน€เธโฌเน€เธเธเน€เธเธ”เน€เธหเน€เธเธเน€เธยเน€เธเธ…เน€เธโ€ฐเน€เธเธ เน€เธ"เน€เธเธเน€เธหเน€เธเธเน€เธเธ’เน€เธเธเน€เธเธ’เน€เธเธเน€เธโ€“เน€เธโฌเน€เธ\\\'เน€เธโ€ฐเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธเธเน€เธ"เน€เธ"เน€เธโ€ฐ'})
 if(!match.open_for_join) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const existing = db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND user_id=?').get(match.id,req.user.id)
 if (existing) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 try {
  const joined=db.transaction(()=>{
   const count=db.prepare('SELECT COUNT(*) n FROM match_players WHERE match_id=?').get(match.id).n
   if(count>=match.max_players) return false
   db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(match.id,req.user.id)
   return true
  })()
  if(!joined) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  if(req.user.id!==match.creator_id){ const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id); notify(match.creator_id,'join','เน€เธเธเน€เธเธ•เน€เธ"เน€เธโขเน€เธโฌเน€เธ\\\'เน€เธโ€ฐเน€เธเธ’เน€เธเธเน€เธหเน€เธเธเน€เธเธเน€เธโขเน€เธเธ‘เน€เธ"',`${u?.name||'เน€เธล“เน€เธเธเน€เธโ€ฐเน€เธโฌเน€เธเธ…เน€เธหเน€เธโข'} เน€เธโฌเน€เธยเน€เธยเน€เธเธ’เน€เธเธเน€เธยเน€เธเธเน€เธเธเน€เธยเน€เธเธ‘เน€เธโ€ ${match.title}`) }
 } catch { return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'}) }
 res.json({ok:true,message:'เน€เธเนเธฒเธฃเนเธงเธกเธเธฑเธ”เธชเธณเน€เธฃเนเธ'})
})

app.get('/api/matches/:id/players', auth, (req,res) => {
 const m=db.prepare('SELECT id,creator_id,max_players,open_for_join FROM matches WHERE id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const players=db.prepare('SELECT u.id,u.name,CASE WHEN u.id=? THEN 1 ELSE 0 END AS owner FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=? ORDER BY owner DESC,u.name').all(m.creator_id,m.id)
 res.json({match:m,players})
})
app.post('/api/matches/:id/leave', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(m.creator_id===req.user.id) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const result=db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?').run(m.id,req.user.id)
 if(!result.changes) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id); notify(m.creator_id,'leave','เน€เธเธเน€เธเธ•เน€เธ"เน€เธโขเน€เธเธเน€เธเธเน€เธยเน€เธหเน€เธเธ’เน€เธยเน€เธโขเน€เธเธ‘เน€เธ"',`${u?.name||'เน€เธล“เน€เธเธเน€เธโ€ฐเน€เธโฌเน€เธเธ…เน€เธหเน€เธโข'} เน€เธเธเน€เธเธเน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธ‘เน€เธโ€ ${m.title}`)
 res.json({ok:true})
})
app.delete('/api/matches/:id/players/:userId', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(m.creator_id!==req.user.id) return res.status(403).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(Number(req.params.userId)===m.creator_id) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const result=db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?').run(m.id,req.params.userId)
 if(!result.changes) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 notify(Number(req.params.userId),'remove','เน€เธโ€“เน€เธเธเน€เธยเน€เธโขเน€เธเธ“เน€เธเธเน€เธเธเน€เธยเน€เธหเน€เธเธ’เน€เธยเน€เธโขเน€เธเธ‘เน€เธ"',`เน€เธยเน€เธเธเน€เธโ€เน€เธโ€“เน€เธเธเน€เธยเน€เธยเน€เธเธ“เน€เธเธเน€เธเธเน€เธยเน€เธยเน€เธเธ’เน€เธยเน€เธยเน€เธเธ‘เน€เธโ€ ${m.title}`)
 res.json({ok:true})
})

app.post('/api/split-bills', auth, (req,res) => {
 const {bookingId,shareCount,names=[]} = req.body
 const booking = db.prepare("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'").get(bookingId,req.user.id)
 if (!booking) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const billState=bookingState(booking.booking_date,booking.start_time,booking.end_time)
 if(billState==='EXPIRED') return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const count=Number(shareCount)
 if (!Number.isInteger(count)||count<2||count>30) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const baseShare=Math.floor(booking.total_price/count)
 const remainder=booking.total_price%count
 const share=baseShare
 const existing=db.prepare("SELECT * FROM split_bills WHERE booking_id=? AND owner_user_id=? AND status='open'").get(booking.id,req.user.id)
 if(existing){
  const paidCount=db.prepare('SELECT COUNT(*) n FROM split_bill_members WHERE split_bill_id=? AND paid=1').get(existing.id).n
  if(paidCount>0 && Number(existing.share_count)!==count) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  db.prepare('UPDATE split_bills SET share_count=?,share_amount=?,total_amount=? WHERE id=?').run(count,share,booking.total_price,existing.id)
  const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  if(members.length>count) db.prepare('DELETE FROM split_bill_members WHERE split_bill_id=? AND id IN (SELECT id FROM split_bill_members WHERE split_bill_id=? ORDER BY id DESC LIMIT ?)').run(existing.id,existing.id,members.length-count)
  const current=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  const add=db.prepare('INSERT INTO split_bill_members(split_bill_id,name) VALUES(?,?)')
  for(let i=current.length;i<count;i++) add.run(existing.id,names[i]||('เน€เธโฌเน€เธลพเน€เธเธ—เน€เธหเน€เธเธเน€เธโขเน€เธ"เน€เธโขเน€เธโ€”เน€เธเธ•เน€เธห '+(i+1)))
  const updated=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  const rename=db.prepare('UPDATE split_bill_members SET name=? WHERE id=? AND paid=0')
  const setAmount=db.prepare('UPDATE split_bill_members SET amount=? WHERE id=?')
  updated.forEach((m,i)=>{if(names[i]) rename.run(names[i],m.id);setAmount.run(baseShare+(i<remainder?1:0),m.id)})
  return res.json({id:existing.id,shareAmount:share,shareCount:count,totalAmount:booking.total_price})
 }
 const result=db.prepare('INSERT INTO split_bills(booking_id,owner_user_id,total_amount,share_count,share_amount) VALUES(?,?,?,?,?)').run(booking.id,req.user.id,booking.total_price,count,share)
 const add=db.prepare('INSERT INTO split_bill_members(split_bill_id,name,amount) VALUES(?,?,?)')
 for(let i=0;i<count;i++) add.run(result.lastInsertRowid,names[i]||('เน€เธโฌเน€เธลพเน€เธเธ—เน€เธหเน€เธเธเน€เธโขเน€เธ"เน€เธโขเน€เธโ€”เน€เธเธ•เน€เธห '+(i+1)),baseShare+(i<remainder?1:0))
 res.status(201).json({id:result.lastInsertRowid,shareAmount:share,shareCount:count,totalAmount:booking.total_price})
})
app.get('/api/split-bills/booking/:bookingId', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE booking_id=? AND owner_user_id=? AND status='open'").get(req.params.bookingId,req.user.id)
 if(!bill) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 res.json({...bill,members})
})
app.post('/api/split-bills/:id/share-links', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const members=db.prepare('SELECT id,name,paid FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 const update=db.prepare('UPDATE split_bill_members SET member_token_hash=? WHERE id=? AND split_bill_id=?')
 const links=members.map(m=>{const token=crypto.randomBytes(24).toString('hex');update.run(hashMemberToken(token),m.id,bill.id);return {memberId:m.id,name:m.name,token}})
 res.json({billId:bill.id,links})
})
app.get('/api/split-bills/share/:token', (req,res) => {
 const token=String(req.params.token||'')
 if(!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const row=db.prepare("SELECT sb.id bill_id,sb.total_amount,sb.status,sbm.id member_id,sbm.name,sbm.amount,sbm.paid,b.booking_date,b.start_time,b.end_time,v.name venue_name FROM split_bill_members sbm JOIN split_bills sb ON sb.id=sbm.split_bill_id JOIN bookings b ON b.id=sb.booking_id JOIN venues v ON v.id=b.venue_id WHERE sbm.member_token_hash=?").get(hashMemberToken(token))
 if(!row || row.status!=='open') return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 res.json(row)
})
app.post('/api/split-bills/share/:token/pay', (req,res) => {
 const token=String(req.params.token||'')
 if(!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const row=db.prepare("SELECT sb.id bill_id,sbm.id member_id,sbm.paid,sb.status FROM split_bill_members sbm JOIN split_bills sb ON sb.id=sbm.split_bill_id WHERE sbm.member_token_hash=?").get(hashMemberToken(token))
 if(!row || row.status!=='open') return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(row.paid) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 db.prepare("UPDATE split_bill_members SET paid=1,paid_at=CURRENT_TIMESTAMP WHERE id=? AND split_bill_id=? AND paid=0").run(row.member_id,row.bill_id)
 res.json({ok:true,message:'เน€เธเธเน€เธเธ—เน€เธโขเน€เธเธเน€เธเธ‘เน€เธโขเน€เธยเน€เธเธ’เน€เธเธเน€เธล เน€เธเธ“เน€เธเธเน€เธเธเน€เธโฌเน€เธโ€กเน€เธเธ”เน€เธโขเน€เธยเน€เธเธ…เน€เธโ€ฐเน€เธเธ'})
})
app.get('/api/split-bills/:id', auth, (req,res) => {
 const bill=db.prepare('SELECT * FROM split_bills WHERE id=? AND owner_user_id=?').get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 res.json({...bill,members})
})
app.post('/api/split-bills/:billId/members/:memberId/pay', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.billId,req.user.id)
 if(!bill) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const member=db.prepare('SELECT id,paid FROM split_bill_members WHERE id=? AND split_bill_id=?').get(req.params.memberId,bill.id)
 if(!member) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 if(Number(member.paid)===1) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 db.prepare("UPDATE split_bill_members SET paid=1,paid_at=CURRENT_TIMESTAMP WHERE id=? AND split_bill_id=? AND paid=0").run(member.id,bill.id)
 res.json({ok:true})
})
app.post('/api/split-bills/:id/close', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const unpaid=db.prepare('SELECT COUNT(*) n FROM split_bill_members WHERE split_bill_id=? AND paid=0').get(bill.id).n
 if(unpaid>0) return res.status(409).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'+unpaid+' เน€เธ"เน€เธโข'})
 db.prepare("UPDATE split_bills SET status='closed' WHERE id=?").run(bill.id)
 db.prepare('UPDATE matches SET open_for_join=0 WHERE booking_id=?').run(bill.booking_id)
 res.json({ok:true,message:'เธเธดเธ”เธเธดเธฅเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง'})
})

app.patch('/api/admin/venues/:id/owner', auth, (req,res) => {
 if(req.user.role!=='admin') return res.status(403).json({error:'เน€เธเธเธฒเธฐเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธเน€เธ—เนเธฒเธเธฑเนเธ'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if(!venue) return res.status(404).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 const ownerId=req.body.ownerId==null||req.body.ownerId===''?null:Number(req.body.ownerId)
 if(ownerId!==null){
  if(!Number.isInteger(ownerId)) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND role='owner'").get(ownerId)
  if(!owner) return res.status(400).json({error:'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”'})
 }
 db.prepare('UPDATE venues SET owner_id=? WHERE id=?').run(ownerId,venue.id)
 if(ownerId!==null && !venue.facility_id){
  const f=db.prepare('INSERT INTO facilities(owner_id,name,address) VALUES(?,?,?)').run(ownerId,venue.name,venue.address)
  db.prepare('UPDATE venues SET facility_id=? WHERE id=?').run(Number(f.lastInsertRowid),venue.id)
 }
 res.json(db.prepare(`${publicVenueSelect} WHERE v.id=?`).get(venue.id))
})

app.listen(PORT, HOST, () => console.log('PorsBall API running on '+HOST+':'+PORT))

// Venue onboarding + admin review workflow
const venueInput=(body)=>({name:String(body.name||'').trim(),area:String(body.area||'').trim(),address:String(body.address||'').trim(),price:Number(body.price_per_hour ?? body.pricePerHour),roof:body.roof?1:0,fieldTypes:String(body.field_types ?? body.fieldTypes ?? '').trim()})
app.get('/api/owner/venue-requests', auth, (req,res)=>{
 if(req.user.role!=='owner'&&req.user.role!=='admin') return res.status(403).json({error:'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธเธฑเธ”เธเธฒเธฃเธเธณเธเธญเธชเธเธฒเธก'})
 const rows=req.user.role==='admin'?db.prepare('SELECT * FROM venues WHERE review_status<>? ORDER BY submitted_at DESC,id DESC').all('approved'):db.prepare("SELECT * FROM venues WHERE owner_id=? AND review_status<>'approved' ORDER BY id DESC").all(req.user.id)
 res.json(rows)
})
app.post('/api/owner/venues', auth, (req,res)=>{
 if(req.user.role!=='owner') return res.status(403).json({error:'เธเธฑเธเธเธตเธเธตเนเธขเธฑเธเนเธกเนเนเธ”เนเธฃเธฑเธเธชเธดเธ—เธเธดเนเน€เธเนเธฒเธเธญเธเธชเธเธฒเธก'})
 const v=venueInput(req.body)
 if(!v.name||!v.area||!v.address||!v.fieldTypes||!Number.isFinite(v.price)||v.price<=0) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเนเธญเธกเธนเธฅเธชเธเธฒเธก เธเธทเนเธญ เธเธทเนเธเธ—เธตเน เธ—เธตเนเธญเธขเธนเน เธฃเธฒเธเธฒ เนเธฅเธฐเธเธฃเธฐเน€เธ เธ—เธชเธเธฒเธกเนเธซเนเธเธฃเธ'})
 if(v.name.length>120||v.area.length>120||v.address.length>300||v.fieldTypes.length>100) return res.status(400).json({error:'เธเนเธญเธกเธนเธฅเธชเธเธฒเธกเธขเธฒเธงเน€เธเธดเธเธเธณเธซเธเธ”'})
 const result=db.prepare("INSERT INTO venues(name,area,address,rating,price_per_hour,roof,field_types,owner_id,review_status,review_note,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(v.name,v.area,v.address,0,v.price,v.roof,v.fieldTypes,req.user.id,'pending_review','')
 const id=Number(result.lastInsertRowid)
 db.prepare("INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)").run(id,req.user.id,'submitted','เธชเนเธเธชเธเธฒเธกเนเธซเธกเนเนเธซเน PorsBall เธ•เธฃเธงเธเธชเธญเธ')
 const admins=db.prepare("SELECT id FROM users WHERE role='admin'").all();admins.forEach(a=>notify(a.id,'venue_review','เธกเธตเธชเธเธฒเธกเนเธซเธกเนเธฃเธญเธ•เธฃเธงเธเธชเธญเธ',`${req.user.name} เธชเนเธเธชเธเธฒเธก ${v.name} เนเธซเนเธ•เธฃเธงเธเธชเธญเธ`))
 res.status(201).json(db.prepare('SELECT * FROM venues WHERE id=?').get(id))
})
app.patch('/api/owner/venues/:id/submit', auth, (req,res)=>{
 if(req.user.role!=='owner') return res.status(403).json({error:'เนเธกเนเธกเธตเธชเธดเธ—เธเธดเนเธชเนเธเธเธณเธเธญเธชเธเธฒเธก'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=? AND owner_id=?').get(req.params.id,req.user.id)
 if(!venue) return res.status(404).json({error:'เนเธกเนเธเธเธชเธเธฒเธกเธเธญเธเธเธธเธ“'})
 if(!['draft','changes_requested','rejected'].includes(String(venue.review_status))) return res.status(409).json({error:'เธชเธเธฒเธกเธเธตเนเธขเธฑเธเนเธกเนเธญเธขเธนเนเนเธเธชเธ–เธฒเธเธฐเธ—เธตเนเธชเนเธเธ•เธฃเธงเธเธชเธญเธเนเธ”เน'})
 db.prepare("UPDATE venues SET review_status='pending_review',review_note='',submitted_at=CURRENT_TIMESTAMP WHERE id=?").run(venue.id)
 db.prepare("INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)").run(venue.id,req.user.id,'resubmitted','เธชเนเธเธเนเธญเธกเธนเธฅเธชเธเธฒเธกเนเธซเนเธ•เธฃเธงเธเธชเธญเธเธญเธตเธเธเธฃเธฑเนเธ')
 db.prepare("SELECT id FROM users WHERE role='admin'").all().forEach(a=>notify(a.id,'venue_review','เธกเธตเธชเธเธฒเธกเธฃเธญเธ•เธฃเธงเธเธชเธญเธ',`${req.user.name} เธชเนเธเธชเธเธฒเธก ${venue.name} เนเธซเนเธ•เธฃเธงเธเธชเธญเธเธญเธตเธเธเธฃเธฑเนเธ`))
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(venue.id))
})
app.get('/api/admin/venue-requests', auth, (req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'เน€เธเธเธฒเธฐเนเธญเธ”เธกเธดเธเน€เธ—เนเธฒเธเธฑเนเธ'})
 const rows=db.prepare("SELECT v.*,u.name owner_name,u.email owner_email FROM venues v JOIN users u ON u.id=v.owner_id WHERE v.review_status<>'approved' ORDER BY CASE v.review_status WHEN 'pending_review' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END,v.submitted_at DESC,v.id DESC").all()
 res.json(rows)
})
app.get('/api/admin/venues/:id/review-history', auth, (req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'เน€เธเธเธฒเธฐเนเธญเธ”เธกเธดเธเน€เธ—เนเธฒเธเธฑเนเธ'})
 const rows=db.prepare("SELECT vr.*,u.name actor_name FROM venue_reviews vr JOIN users u ON u.id=vr.actor_user_id WHERE vr.venue_id=? ORDER BY vr.id DESC").all(req.params.id)
 res.json(rows)
})
app.patch('/api/admin/venues/:id/review', auth, (req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'เน€เธเธเธฒเธฐเนเธญเธ”เธกเธดเธเน€เธ—เนเธฒเธเธฑเนเธ'})
 const action=String(req.body.action||'').trim();const note=String(req.body.note||'').trim()
 if(!['approve','request_changes','reject'].includes(action)) return res.status(400).json({error:'เธชเธ–เธฒเธเธฐเธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ'})
 if(action!=='approve'&&!note) return res.status(400).json({error:'เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเน€เธซเธ•เธธเธเธฅเธเนเธญเธเธชเนเธเธเนเธญเธเธงเธฒเธกเนเธซเนเน€เธเนเธฒเธเธญเธเธชเธเธฒเธก'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if(!venue) return res.status(404).json({error:'เนเธกเนเธเธเธชเธเธฒเธก'})
 const map={approve:'approved',request_changes:'changes_requested',reject:'rejected'};const status=map[action]
 db.prepare('UPDATE venues SET review_status=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?').run(status,note,req.user.id,venue.id)
 db.prepare('INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)').run(venue.id,req.user.id,action,note)
 const title=action==='approve'?'เธชเธเธฒเธกเนเธ”เนเธฃเธฑเธเธเธฒเธฃเธญเธเธธเธกเธฑเธ•เธด':action==='request_changes'?'เธเธฃเธธเธ“เธฒเนเธเนเนเธเธเนเธญเธกเธนเธฅเธชเธเธฒเธก':'เธเธณเธเธญเน€เธเธดเนเธกเธชเธเธฒเธกเนเธกเนเธเนเธฒเธเธเธฒเธฃเธญเธเธธเธกเธฑเธ•เธด'
 const msg=note?`${venue.name}: ${note}`:`${venue.name} เธเธฃเนเธญเธกเน€เธเธดเธ”เนเธซเนเธฅเธนเธเธเนเธฒเธเธญเธเนเธฅเนเธง`
 if(venue.owner_id) notify(Number(venue.owner_id),'venue_review',title,msg)
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(venue.id))
})

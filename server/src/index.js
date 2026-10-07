import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import db from './db.js'
import {safeBody, fallbackMessage, isBrokenThai} from './message-safety.mjs'
import {applySecurityHardening} from './security-hardening.mjs'

const app = express()
const PORT = Number(process.env.PORT) || 4001
const HOST = process.env.HOST || '0.0.0.0'
const SECRET = process.env.JWT_SECRET || 'porsball-local-dev-secret'
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production')
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://porsball.onrender.com'

app.use(cors({origin:(origin,cb)=>{if(!origin||origin===CLIENT_ORIGIN||origin==='http://localhost:5173'||origin==='http://127.0.0.1:5173')return cb(null,true);cb(new Error('CORS blocked'))}}))
app.use(express.json({limit:'1mb'}))
applySecurityHardening(app)
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

const sendMatchReminders = () => {
 const now=Date.now()
 const rows=db.prepare("SELECT m.id,m.title,m.match_date,m.start_time,m.end_time FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.open_for_join=1 AND b.status='confirmed'").all()
 for(const m of rows){
  const start=new Date(m.match_date+'T'+m.start_time+':00+07:00').getTime()
  for(const hours of [24,2]){
   const due=start-hours*60*60*1000
   if(now<due || now>due+15*60*1000) continue
   const players=db.prepare('SELECT user_id FROM match_players WHERE match_id=?').all(m.id)
   for(const p of players){
    try{
     const r=db.prepare('INSERT OR IGNORE INTO match_reminders(match_id,user_id,hours_before) VALUES(?,?,?)').run(m.id,p.user_id,hours)
     if(r.changes) notify(p.user_id,'match_reminder','ใกล้ถึงเวลานัด','นัด '+m.title+' เริ่มใน '+hours+' ชั่วโมง วันที่ '+m.match_date+' เวลา '+m.start_time)
    }catch{}
   }
  }
 }
}
const reminderTimer=setInterval(sendMatchReminders,5*60*1000)
reminderTimer.unref()
const notify = (userId,type,title,message) => {
 const titles={booking:'มีการจองสนามใหม่',cancel:'การจองถูกยกเลิก',match_close:'เจ้าของนัดปิดรับคน',join:'มีคนเข้าร่วมนัด',leave:'มีคนออกจากนัด',remove:'คุณถูกนำออกจากนัด',match_reminder:'ใกล้ถึงเวลานัด',team_invite:'คำเชิญเกี่ยวกับทีม'}
 const messages={booking:'มีการจองสนามใหม่',cancel:'การจองสนามถูกยกเลิก',match_close:'เจ้าของนัดปิดรับสมาชิกแล้ว',join:'มีผู้เล่นเข้าร่วมการนัดหมาย',leave:'มีผู้เล่นออกจากการนัดหมาย',remove:'คุณถูกนำออกจากการนัดหมาย',match_reminder:'ใกล้ถึงเวลาการนัดหมาย',team_invite:'มีการอัปเดตคำเชิญทีมของคุณ'}
 const safeTitle=isBrokenThai(title)?(titles[type]||'มีการแจ้งเตือนใหม่'):title
 const safeMessage=isBrokenThai(message)?(messages[type]||'มีการแจ้งเตือนใหม่'):message
 return db.prepare('INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?)').run(userId,type,safeTitle,safeMessage)
}

const awardPoints = (userId, points, eventKey, description) => { const r=db.prepare('INSERT OR IGNORE INTO point_events(user_id,event_key,points,description) VALUES(?,?,?,?)').run(userId,eventKey,points,description); if(r.changes) db.prepare('UPDATE users SET points=points+? WHERE id=?').run(points,userId); return r.changes===1 }
const pointTier = (points) => points>=500?'Platinum':points>=250?'Gold':points>=100?'Silver':'Bronze'
sendMatchReminders()
const audit = (actorUserId, action, entityType, entityId=null, metadata={}) => { try { db.prepare('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,metadata) VALUES(?,?,?,?,?)').run(actorUserId||null,String(action),String(entityType),entityId==null?null:Number(entityId),JSON.stringify(metadata||{})) } catch {} }
const bangkokDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date())
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00+07:00`).getTime()) && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(`${date}T00:00:00+07:00`))===date
const bookingState = (date,start,end) => { const now=new Date(); const from=new Date(`${date}T${start}:00+07:00`); const to=new Date(`${date}T${end}:00+07:00`); return now>=to?'EXPIRED':now>=from?'IN_PROGRESS':'UPCOMING' }
const calcAge = (birthDate) => { const b=new Date(`${birthDate}T00:00:00+07:00`), now=new Date(); let age=now.getUTCFullYear()-b.getUTCFullYear(); const nowMonth=now.getUTCMonth(), birthMonth=b.getUTCMonth(); if(nowMonth<birthMonth || (nowMonth===birthMonth && now.getUTCDate()<b.getUTCDate())) age--; return age>=0?age:null }

app.get('/api/health', (_,res) => res.json({ok:true, service:'MatchSoccer API'}))
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
 res.status(201).json(db.prepare(`${publicVenueSelect} WHERE v.id=?`).get(r.lastInsertRowid))
})
app.get('/api/venues/:id', (req,res) => {
 const venue = db.prepare(`${publicVenueSelect} WHERE v.id=? AND v.review_status='approved' AND v.service_status='active'`).get(req.params.id)
 if (!venue) return res.status(404).json({error:'ไม่พบสนาม'})
 res.json(venue)
})
app.get('/api/admin/audit-logs', auth, (req,res) => { if(req.user.role!=='admin') return res.status(403).json({error:'เฉพาะผู้ดูแลระบบเท่านั้น'}); const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)); const rows=db.prepare('SELECT al.*,u.name actor_name,u.email actor_email FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id ORDER BY al.id DESC LIMIT ?').all(limit); res.json(rows) })
app.get('/api/admin/users', auth, (req,res) => {
 if (req.user.role !== 'admin') return res.status(403).json({error:'เฉพาะผู้ดูแลระบบเท่านั้น'})
 const rows=db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users ORDER BY id DESC').all()
 res.json(rows)
})
app.patch('/api/admin/users/:id/role', auth, (req,res) => {
 if (req.user.role !== 'admin') return res.status(403).json({error:'เฉพาะผู้ดูแลระบบเท่านั้น'})
 const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.params.id)
 if(!user) return res.status(404).json({error:'ไม่พบผู้ใช้'})
 const role=String(req.body.role||'').trim()
 if(!['player','owner','admin'].includes(role)) return res.status(400).json({error:'บทบาทไม่ถูกต้อง'})
 if(user.id===req.user.id && role!=='admin') return res.status(409).json({error:'ไม่สามารถลดสิทธิ์บัญชีแอดมินที่กำลังใช้งานได้'})
 if(user.role==='owner' && role!=='owner' && db.prepare('SELECT 1 FROM venues WHERE owner_id=? LIMIT 1').get(user.id)) return res.status(409).json({error:'ไม่สามารถเปลี่ยนบทบาทได้ขณะยังมีสนามที่ผูกกับเจ้าของนี้'})
 db.prepare('UPDATE users SET role=?,auth_version=auth_version+1 WHERE id=?').run(role,user.id)
 res.json(db.prepare('SELECT id,name,email,role,points,wins,losses,created_at FROM users WHERE id=?').get(user.id))
})

app.get('/api/owner/venues', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'คุณไม่มีสิทธิ์ดำเนินการนี้'})
 const rows = req.user.role === 'admin'
  ? db.prepare(`${publicVenueSelect} ORDER BY v.id DESC`).all()
  : db.prepare(`${publicVenueSelect} WHERE v.owner_id=? ORDER BY v.id DESC`).all(req.user.id)
 res.json(rows)
})
app.patch('/api/owner/venues/:id', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'คุณไม่มีสิทธิ์ดำเนินการนี้'})
 const venue = db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if (!venue) return res.status(404).json({error:'ไม่พบสนาม'})
 if (req.user.role !== 'admin' && venue.owner_id !== req.user.id) return res.status(403).json({error:'คุณไม่มีสิทธิ์ดำเนินการนี้'})
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
 const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||''), phone=String(req.body.phone||'').trim(), address=String(req.body.address||'').trim(), birthDate=String(req.body.birthDate||'').trim()
 if (!name || !email || !password || !phone || !address || !birthDate) return res.status(400).json({error:'กรุณากรอกข้อมูลให้ครบ'})
 if(!validDate(birthDate)||birthDate>bangkokDate()||calcAge(birthDate)===null) return res.status(400).json({error:'วันเกิดไม่ถูกต้อง'})
 if (name.length>80) return res.status(400).json({error:'ชื่อยาวเกินไป'})
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'รูปแบบอีเมลไม่ถูกต้อง'})
 if (password.length<8) return res.status(400).json({error:'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'})
 if (phone.length<8 || phone.length>20) return res.status(400).json({error:'กรุณากรอกเบอร์โทรให้ถูกต้อง'})
 if (address.length>300) return res.status(400).json({error:'ที่อยู่ยาวเกินไป'})
 try {
  const hash = await bcrypt.hash(password,10)
  const info = db.prepare('INSERT INTO users(name,email,password_hash,phone,address,birth_date) VALUES(?,?,?,?,?,?)').run(name,email,hash,phone,address,birthDate)
  const userRow = db.prepare('SELECT id,name,email,role,points,wins,losses,phone,address,avatar,birth_date,position,skill_level FROM users WHERE id=?').get(info.lastInsertRowid)
  audit(Number(info.lastInsertRowid),'REGISTER_SUCCESS','auth',Number(info.lastInsertRowid))
  const user = {...userRow,age:userRow.birth_date?calcAge(userRow.birth_date):null}
  res.status(201).json({token:tokenFor(user),user})
 } catch (e) {
  const duplicate=String(e?.message||'').includes('UNIQUE')
  if(duplicate) return res.status(409).json({error:'อีเมลนี้มีบัญชีอยู่แล้ว'})
  console.error('REGISTER_ERROR',e)
  return res.status(500).json({error:'ไม่สามารถสมัครสมาชิกได้ กรุณาลองใหม่อีกครั้ง'})
 }
})
app.post('/api/auth/login', async (req,res) => {
 const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'')
 if(!email || !password) return res.status(400).json({error:'กรุณากรอกอีเมลและรหัสผ่าน'})
 const user = db.prepare('SELECT * FROM users WHERE email=?').get(email)
 if (!user || !(await bcrypt.compare(password,user.password_hash))) { audit(null,'LOGIN_FAILED','auth'); return res.status(401).json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'}) }
 const safe = {id:user.id,name:user.name,email:user.email,role:user.role,points:user.points,wins:user.wins,losses:user.losses,phone:user.phone||null,address:user.address||null,avatar:user.avatar||null,birth_date:user.birth_date||null,age:user.birth_date?calcAge(user.birth_date):null,position:user.position||'',skill_level:user.skill_level||'beginner',auth_version:user.auth_version}
 audit(user.id,'LOGIN_SUCCESS','auth',user.id)
 res.json({token:tokenFor(safe),user:safe})
})
const hashResetCode = (code) => crypto.createHash('sha256').update(code).digest('hex')
const hashMemberToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const sendResetEmail = async (email, code) => {
 const key=process.env.RESEND_API_KEY, from=process.env.RESEND_FROM
 if(!key || !from) return false
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[email],subject:'MatchSoccer - รหัสยืนยันการเปลี่ยนรหัสผ่าน',html:'<p>รหัสยืนยัน MatchSoccer สำหรับเปลี่ยนรหัสผ่านของคุณคือ <strong>'+code+'</strong></p><p>รหัสนี้ใช้ได้ 10 นาที และใช้ได้เพียงครั้งเดียว</p>'})})
 if(!r.ok) throw new Error('ส่งอีเมลไม่สำเร็จ')
 return true
}
app.post('/api/auth/forgot-password', async (req,res) => {
 const email=(req.body.email||'').trim().toLowerCase()
 if(!email) return res.status(400).json({error:'กรุณากรอกอีเมล'})
 const user=db.prepare('SELECT id,email FROM users WHERE email=?').get(email)
 const generic={message:'หากอีเมลนี้มีบัญชี MatchSoccer ระบบจะส่งรหัสยืนยันให้คุณ'}
 if(!user) return res.json(generic)
 const recent=db.prepare("SELECT created_at FROM password_resets WHERE user_id=? ORDER BY id DESC LIMIT 1").get(user.id)
 if(recent && Date.now()-Date.parse(recent.created_at+'Z')<60000) return res.json(generic)
 const code=String(crypto.randomInt(100000,1000000))
 db.prepare("UPDATE password_resets SET used=1 WHERE user_id=? AND used=0").run(user.id)
 db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at) VALUES(?,?,?)').run(user.id,hashResetCode(code),Date.now()+10*60*1000)
 try { const sent=await sendResetEmail(email,code); if(!sent && process.env.NODE_ENV!=='production') return res.json({...generic,devCode:code}) } catch { if(process.env.NODE_ENV!=='production') return res.status(500).json({...generic,devCode:code,error:'เกิดข้อผิดพลาด'}); return res.json(generic) }
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
 audit(user.id,'PASSWORD_RESET','auth',user.id)
 db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(row.id)
 res.json({ok:true,message:'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว'})
})
app.get('/api/users/search', auth, (req,res) => { const q=String(req.query.q||'').trim(); if(q.length<2)return res.json([]); const rows=db.prepare("SELECT id,name,position,skill_level,birth_date,points FROM users WHERE id<>? AND name LIKE ? ORDER BY name LIMIT 20").all(req.user.id,'%'+q+'%'); res.json(rows.map(u=>({...u,age:u.birth_date?calcAge(u.birth_date):null}))) })
app.get('/api/friends', auth, (req,res) => { const friends=db.prepare("SELECT u.id,u.name,u.position,u.skill_level,u.birth_date,u.points FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? ORDER BY u.name").all(req.user.id); const incoming=db.prepare("SELECT fr.id,u.id user_id,u.name,u.position,u.skill_level,u.birth_date FROM friend_requests fr JOIN users u ON u.id=fr.sender_id WHERE fr.receiver_id=? AND fr.status='pending' ORDER BY fr.id DESC").all(req.user.id); res.json({friends:friends.map(u=>({...u,age:u.birth_date?calcAge(u.birth_date):null})),incoming:incoming.map(u=>({...u,age:u.birth_date?calcAge(u.birth_date):null}))}) })
app.post('/api/friends/request', auth, (req,res) => { const target=Number(req.body.userId); if(!Number.isInteger(target)||target===req.user.id)return res.status(400).json({error:'ผู้ใช้ไม่ถูกต้อง'}); if(!db.prepare('SELECT id FROM users WHERE id=?').get(target))return res.status(404).json({error:'ไม่พบผู้ใช้'}); if(db.prepare('SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?').get(req.user.id,target))return res.status(409).json({error:'เป็นเพื่อนกันอยู่แล้ว'}); try{db.prepare("INSERT INTO friend_requests(sender_id,receiver_id) VALUES(?,?)").run(req.user.id,target);notify(target,'join','คำขอเป็นเพื่อนใหม่',req.user.name+' ส่งคำขอเป็นเพื่อนให้คุณ');res.status(201).json({status:'pending'})}catch{const reverse=db.prepare("SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending'").get(target,req.user.id);if(reverse){db.prepare("UPDATE friend_requests SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(reverse.id);db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?),(?,?)').run(req.user.id,target,target,req.user.id);return res.json({status:'accepted'})}res.status(409).json({error:'มีคำขอเป็นเพื่อนอยู่แล้ว'})} })
app.post('/api/friends/requests/:id', auth, (req,res) => { const action=String(req.body.action||'');const row=db.prepare("SELECT * FROM friend_requests WHERE id=? AND receiver_id=? AND status='pending'").get(req.params.id,req.user.id);if(!row)return res.status(404).json({error:'ไม่พบคำขอ'});if(!['accept','reject'].includes(action))return res.status(400).json({error:'คำสั่งไม่ถูกต้อง'});db.prepare('UPDATE friend_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(action==='accept'?'accepted':'rejected',row.id);if(action==='accept')db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?),(?,?)').run(req.user.id,row.sender_id,row.sender_id,req.user.id);res.json({ok:true}) })
app.delete('/api/friends/:id', auth, (req,res) => { const id=Number(req.params.id);db.prepare('DELETE FROM friendships WHERE user_id=? AND friend_id=?').run(req.user.id,id);db.prepare('DELETE FROM friendships WHERE user_id=? AND friend_id=?').run(id,req.user.id);res.json({ok:true}) })
app.get('/api/teams', auth, (req,res) => { const rows=db.prepare("SELECT t.id,t.name,t.owner_id,COUNT(tm.user_id) member_count FROM teams t JOIN team_members tm ON tm.team_id=t.id WHERE EXISTS(SELECT 1 FROM team_members x WHERE x.team_id=t.id AND x.user_id=?) GROUP BY t.id ORDER BY t.id DESC").all(req.user.id);res.json(rows) })
app.post('/api/teams', auth, (req,res) => { const name=String(req.body.name||'').trim();if(name.length<2||name.length>50)return res.status(400).json({error:'ชื่อทีมต้องมี 2–50 ตัวอักษร'});const tx=db.transaction(()=>{const r=db.prepare('INSERT INTO teams(owner_id,name) VALUES(?,?)').run(req.user.id,name);db.prepare('INSERT INTO team_members(team_id,user_id) VALUES(?,?)').run(r.lastInsertRowid,req.user.id);return r.lastInsertRowid});const id=tx();res.status(201).json(db.prepare('SELECT t.id,t.name,t.owner_id,1 member_count FROM teams t WHERE t.id=?').get(id)) })
app.post('/api/teams/:id/invitations', auth, (req,res) => { const teamId=Number(req.params.id),userId=Number(req.body.userId);const team=db.prepare('SELECT id,name,owner_id FROM teams WHERE id=? AND owner_id=?').get(teamId,req.user.id);if(!team)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'});if(!Number.isInteger(userId)||!db.prepare('SELECT id FROM users WHERE id=?').get(userId)||userId===req.user.id)return res.status(400).json({error:'ผู้ใช้ไม่ถูกต้อง'});if(db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(teamId,userId))return res.status(409).json({error:'ผู้ใช้นี้อยู่ในทีมแล้ว'});try{const r=db.prepare("INSERT INTO team_invitations(team_id,inviter_id,user_id) VALUES(?,?,?)").run(teamId,req.user.id,userId);notify(userId,'team_invite','คำเชิญเข้าทีม',req.user.name+' เชิญคุณเข้าทีม '+team.name);audit(req.user.id,'team.invite','team_invitation',r.lastInsertRowid,{team_id:teamId,user_id:userId});res.status(201).json({ok:true,id:Number(r.lastInsertRowid),status:'pending'})}catch{const existing=db.prepare("SELECT id,status FROM team_invitations WHERE team_id=? AND user_id=?").get(teamId,userId);if(existing?.status==='rejected'||existing?.status==='cancelled'){db.prepare("UPDATE team_invitations SET inviter_id=?,status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,existing.id);notify(userId,'team_invite','คำเชิญเข้าทีม',req.user.name+' เชิญคุณเข้าทีม '+team.name);return res.status(201).json({ok:true,id:existing.id,status:'pending'})}res.status(409).json({error:'มีคำเชิญทีมนี้อยู่แล้ว'})} })
app.get('/api/teams/:id/invitations', auth, (req,res) => { const teamId=Number(req.params.id);const team=db.prepare('SELECT id FROM teams WHERE id=? AND owner_id=?').get(teamId,req.user.id);if(!team)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'});const rows=db.prepare("SELECT ti.id,ti.team_id,ti.user_id,ti.status,ti.created_at,u.name,u.position,u.skill_level,u.birth_date,u.points FROM team_invitations ti JOIN users u ON u.id=ti.user_id WHERE ti.team_id=? AND ti.status='pending' ORDER BY ti.id DESC").all(teamId);res.json(rows.map(u=>({...u,age:u.birth_date?calcAge(u.birth_date):null}))) })
app.delete('/api/teams/:id/invitations/:invitationId', auth, (req,res) => { const teamId=Number(req.params.id),invitationId=Number(req.params.invitationId);const team=db.prepare('SELECT id FROM teams WHERE id=? AND owner_id=?').get(teamId,req.user.id);if(!team)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'});const inv=db.prepare("SELECT id,user_id FROM team_invitations WHERE id=? AND team_id=? AND status='pending'").get(invitationId,teamId);if(!inv)return res.status(404).json({error:'ไม่พบคำเชิญที่รอการตอบรับ'});db.prepare("UPDATE team_invitations SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(inv.id);audit(req.user.id,'team.invite_cancel','team_invitation',inv.id,{team_id:teamId,user_id:inv.user_id});res.json({ok:true,status:'cancelled'}) })
app.get('/api/me/team-invitations', auth, (req,res) => { const rows=db.prepare("SELECT ti.id,ti.team_id,ti.inviter_id,ti.status,ti.created_at,t.name team_name,u.name inviter_name,(SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=ti.team_id) member_count FROM team_invitations ti JOIN teams t ON t.id=ti.team_id JOIN users u ON u.id=ti.inviter_id WHERE ti.user_id=? AND ti.status='pending' ORDER BY ti.id DESC").all(req.user.id);res.json(rows) })
app.post('/api/me/team-invitations/:id', auth, (req,res) => { const action=String(req.body.action||'');if(!['accept','reject'].includes(action))return res.status(400).json({error:'คำสั่งไม่ถูกต้อง'});const inv=db.prepare("SELECT ti.*,t.name team_name,t.owner_id FROM team_invitations ti JOIN teams t ON t.id=ti.team_id WHERE ti.id=? AND ti.user_id=? AND ti.status='pending'").get(req.params.id,req.user.id);if(!inv)return res.status(404).json({error:'ไม่พบคำเชิญทีม'});if(action==='reject'){db.prepare("UPDATE team_invitations SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(inv.id);notify(inv.owner_id,'team_invite','ปฏิเสธคำเชิญเข้าทีม',req.user.name+' ปฏิเสธคำเชิญเข้าทีม '+inv.team_name);return res.json({ok:true,status:'rejected'})}const joined=db.transaction(()=>{const already=db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(inv.team_id,req.user.id);if(!already)db.prepare('INSERT INTO team_members(team_id,user_id) VALUES(?,?)').run(inv.team_id,req.user.id);db.prepare("UPDATE team_invitations SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(inv.id);return true})();audit(req.user.id,'team.invite_accept','team_invitation',inv.id,{team_id:inv.team_id});notify(inv.owner_id,'team_invite','ตอบรับคำเชิญเข้าทีม',req.user.name+' ตอบรับคำเชิญเข้าทีม '+inv.team_name);res.json({ok:true,status:'accepted',team_id:inv.team_id}) })
app.post('/api/teams/:id/members', auth, (req,res) => { const teamId=Number(req.params.id),userId=Number(req.body.userId);const team=db.prepare('SELECT * FROM teams WHERE id=? AND owner_id=?').get(teamId,req.user.id);if(!team)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'});if(!Number.isInteger(userId)||!db.prepare('SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?').get(req.user.id,userId))return res.status(400).json({error:'เพิ่มได้เฉพาะเพื่อนของคุณ'});try{db.prepare('INSERT INTO team_members(team_id,user_id) VALUES(?,?)').run(teamId,userId);notify(userId,'join','ถูกเพิ่มเข้าทีม',req.user.name+' เพิ่มคุณเข้าทีม '+team.name);res.status(201).json({ok:true})}catch{res.status(409).json({error:'ผู้ใช้นี้อยู่ในทีมแล้ว'})} })
app.delete('/api/teams/:id/members/:userId', auth, (req,res) => { const teamId=Number(req.params.id),userId=Number(req.params.userId);const team=db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);if(!team)return res.status(404).json({error:'ไม่พบทีม'});if(userId===team.owner_id)return res.status(409).json({error:'เจ้าของทีมไม่สามารถถูกนำออกได้'});if(req.user.id!==team.owner_id&&req.user.id!==userId)return res.status(403).json({error:'ไม่มีสิทธิ์'});db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(teamId,userId);db.prepare("UPDATE team_match_invites SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE team_id=? AND user_id=? AND status='pending'").run(teamId,userId);res.json({ok:true}) })
app.get('/api/teams/:id', auth, (req,res) => {
 const id=Number(req.params.id)
 if(!Number.isInteger(id)) return res.status(400).json({error:'ไม่พบทีม'})
 const team=db.prepare('SELECT id,name,owner_id FROM teams WHERE id=?').get(id)
 if(!team) return res.status(404).json({error:'ไม่พบทีม'})
 const memberAccess=db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(id,req.user.id)
 if(!memberAccess) return res.status(403).json({error:'คุณไม่ได้อยู่ในทีมนี้'})
 const members=db.prepare("SELECT u.id,u.name,u.position,u.skill_level,u.birth_date,u.points,CAST((julianday('now')-julianday(u.birth_date))/365.2425 AS INTEGER) age FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=? ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END,u.name").all(id,team.owner_id)
 res.json({...team,members})
})
app.patch('/api/teams/:id', auth, (req,res) => {
 const id=Number(req.params.id), name=String(req.body.name||'').trim()
 const team=db.prepare('SELECT * FROM teams WHERE id=?').get(id)
 if(!team)return res.status(404).json({error:'ไม่พบทีม'})
 if(team.owner_id!==req.user.id)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'})
 if(name.length<2||name.length>50)return res.status(400).json({error:'ชื่อทีมต้องมี 2–50 ตัวอักษร'})
 db.prepare('UPDATE teams SET name=? WHERE id=?').run(name,id)
 res.json(db.prepare('SELECT id,name,owner_id,(SELECT COUNT(*) FROM team_members WHERE team_id=teams.id) member_count FROM teams WHERE id=?').get(id))
})
app.delete('/api/teams/:id', auth, (req,res) => {
 const id=Number(req.params.id),team=db.prepare('SELECT * FROM teams WHERE id=?').get(id)
 if(!team)return res.status(404).json({error:'ไม่พบทีม'})
 if(team.owner_id!==req.user.id)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'})
 const matches=db.prepare('SELECT COUNT(*) n FROM matches WHERE team_id=?').get(id).n
 if(matches)return res.status(409).json({error:'ทีมนี้มีแมตช์อยู่ จึงยังลบไม่ได้'})
 db.prepare('DELETE FROM teams WHERE id=?').run(id)
 res.json({ok:true})
})
app.get('/api/teams/:id/stats', auth, (req,res) => {
 const id=Number(req.params.id)
 if(!Number.isInteger(id)||!db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(id,req.user.id)) return res.status(403).json({error:'คุณไม่ได้อยู่ในทีมนี้'})
 const team=db.prepare('SELECT id,name,owner_id FROM teams WHERE id=?').get(id)
 if(!team)return res.status(404).json({error:'ไม่พบทีม'})
 const memberCount=Number(db.prepare('SELECT COUNT(*) n FROM team_members WHERE team_id=?').get(id).n||0)
 const matches=db.prepare("SELECT m.id,m.title,m.match_date,m.start_time,m.end_time,m.max_players,v.name venue_name,b.status booking_status,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.team_id=? ORDER BY m.match_date DESC,m.start_time DESC").all(id)
 const history=matches.map(m=>({...m,state:bookingState(m.match_date,m.start_time,m.end_time)}))
 const upcoming=history.filter(m=>m.state==='UPCOMING').length,inProgress=history.filter(m=>m.state==='IN_PROGRESS').length,completed=history.filter(m=>m.state==='EXPIRED').length
 const attendance=db.prepare("SELECT COUNT(*) n FROM match_attendance ma JOIN matches m ON m.id=ma.match_id WHERE m.team_id=? AND ma.status='attended'").get(id).n||0
 const attendanceTotal=db.prepare("SELECT COUNT(*) n FROM match_attendance ma JOIN matches m ON m.id=ma.match_id WHERE m.team_id=? AND ma.status IN ('attended','no_show')").get(id).n||0
 const members=db.prepare("SELECT u.id,u.name,u.position,u.skill_level,u.points,COALESCE(ur.reliability_score,100) reliability_score,COUNT(DISTINCT ma.match_id) matches_joined,SUM(CASE WHEN ma.status='attended' THEN 1 ELSE 0 END) attended,SUM(CASE WHEN ma.status='no_show' THEN 1 ELSE 0 END) no_show,(SELECT COUNT(*) FROM team_match_invites ti WHERE ti.team_id=? AND ti.user_id=u.id AND ti.status='pending') invite_pending,(SELECT COUNT(*) FROM team_match_invites ti WHERE ti.team_id=? AND ti.user_id=u.id AND ti.status='accepted') invite_accepted,(SELECT COUNT(*) FROM team_match_invites ti WHERE ti.team_id=? AND ti.user_id=u.id AND ti.status='rejected') invite_rejected FROM team_members tm JOIN users u ON u.id=tm.user_id LEFT JOIN user_reliability ur ON ur.user_id=u.id LEFT JOIN match_attendance ma ON ma.user_id=u.id AND ma.match_id IN (SELECT id FROM matches WHERE team_id=?) WHERE tm.team_id=? GROUP BY u.id ORDER BY attended DESC,u.name").all(id,id,id,id,id)
 const points=Number(db.prepare('SELECT COALESCE(SUM(u.points),0) n FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=?').get(id).n||0)
 res.json({team,member_count:memberCount,total_matches:history.length,upcoming_matches:upcoming,completed_matches:completed,in_progress_matches:inProgress,attendance_count:Number(attendance),attendance_total:Number(attendanceTotal),attendance_rate:attendanceTotal?Math.round(Number(attendance)*100/Number(attendanceTotal)):0,total_points:points,members,history:history.slice(0,20)})
})
app.get('/api/teams/:id/match-center', auth, (req,res) => {
 const id=Number(req.params.id)
 if(!Number.isInteger(id)||!db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(id,req.user.id)) return res.status(403).json({error:'คุณไม่ได้อยู่ในทีมนี้'})
 const team=db.prepare('SELECT id,name,owner_id FROM teams WHERE id=?').get(id)
 if(!team)return res.status(404).json({error:'ไม่พบทีม'})
 const rows=db.prepare("SELECT m.id,m.title,m.match_date,m.start_time,m.end_time,m.max_players,m.open_for_join,v.name venue_name,b.status booking_status,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players,(SELECT COUNT(*) FROM team_match_invites i WHERE i.match_id=m.id AND i.status='pending') pending_invites,(SELECT COUNT(*) FROM team_match_invites i WHERE i.match_id=m.id AND i.status='accepted') accepted_invites,(SELECT COUNT(*) FROM team_match_invites i WHERE i.match_id=m.id AND i.status='rejected') rejected_invites FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.team_id=? ORDER BY m.match_date,m.start_time").all(id)
 const matches=rows.map(m=>{const invites=db.prepare("SELECT i.id,i.user_id,i.status,i.created_at,u.name FROM team_match_invites i JOIN users u ON u.id=i.user_id WHERE i.match_id=? ORDER BY CASE i.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,u.name").all(m.id);return {...m,state:bookingState(m.match_date,m.start_time,m.end_time),spots_left:Math.max(0,Number(m.max_players)-Number(m.players)),invites}})
 const active=matches.filter(m=>m.state!=='EXPIRED'&&m.booking_status==='confirmed')
 const completed=matches.filter(m=>m.state==='EXPIRED').slice(0,20).map(m=>{syncAttendance(m.id);const a=db.prepare("SELECT SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended,SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show,SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,COUNT(*) total FROM match_attendance WHERE match_id=?").get(m.id);return {...m,attendance:{attended:Number(a.attended||0),no_show:Number(a.no_show||0),cancelled:Number(a.cancelled||0),total:Number(a.total||0)}}})
 res.json({team,summary:{total:matches.length,upcoming:matches.filter(m=>m.state==='UPCOMING').length,in_progress:matches.filter(m=>m.state==='IN_PROGRESS').length,pending_invites:matches.reduce((n,m)=>n+Number(m.pending_invites||0),0),accepted_invites:matches.reduce((n,m)=>n+Number(m.accepted_invites||0),0)},next_match:active[0]||null,matches:active.slice(0,20),completed_matches:completed})
})
app.post('/api/teams/:id/matches/:matchId/invites/:userId/remind', auth, (req,res) => {
 const teamId=Number(req.params.id),matchId=Number(req.params.matchId),userId=Number(req.params.userId)
 const team=db.prepare('SELECT id,name,owner_id FROM teams WHERE id=?').get(teamId)
 if(!team)return res.status(404).json({error:'ไม่พบทีม'})
 if(team.owner_id!==req.user.id)return res.status(403).json({error:'เฉพาะเจ้าของทีมเท่านั้น'})
 const inv=db.prepare("SELECT i.*,m.title,m.match_date,m.start_time,m.end_time,b.status booking_status FROM team_match_invites i JOIN matches m ON m.id=i.match_id JOIN bookings b ON b.id=m.booking_id WHERE i.match_id=? AND i.team_id=? AND i.user_id=? AND i.status='pending'").get(matchId,teamId,userId)
 if(!inv)return res.status(404).json({error:'ไม่พบคำเชิญที่รอการตอบรับ'})
 if(inv.booking_status!=='confirmed'||bookingState(inv.match_date,inv.start_time,inv.end_time)!=='UPCOMING')return res.status(409).json({error:'แมตช์นี้ไม่อยู่ในสถานะที่ส่งเตือนได้'})
 const u=db.prepare('SELECT name FROM users WHERE id=?').get(userId)
 notify(userId,'match_invite','แจ้งเตือนคำเชิญทีม',team.name+' เตือนคุณให้ตอบรับคำเชิญแมตช์ '+inv.title)
 audit(req.user.id,'team.match_invite_remind','team_match_invite',inv.id,{match_id:matchId,user_id:userId})
 res.json({ok:true,user_id:userId,name:u?.name||'',status:inv.status})
})
app.get('/api/me/team-invites', auth, (req,res) => { const rows=db.prepare("SELECT i.id,i.match_id,i.team_id,i.status,i.created_at,m.title,m.match_date,m.start_time,m.end_time,v.name venue_name,t.name team_name FROM team_match_invites i JOIN matches m ON m.id=i.match_id JOIN venues v ON v.id=m.venue_id JOIN teams t ON t.id=i.team_id WHERE i.user_id=? AND i.status='pending' ORDER BY i.id DESC").all(req.user.id);res.json(rows) })
app.post('/api/me/team-invites/:id', auth, (req,res) => { const action=String(req.body.action||'');if(!['accept','reject'].includes(action))return res.status(400).json({error:'คำสั่งไม่ถูกต้อง'});const inv=db.prepare("SELECT i.*,m.open_for_join,m.max_players,m.match_date,m.start_time,m.end_time,b.status booking_status FROM team_match_invites i JOIN matches m ON m.id=i.match_id JOIN bookings b ON b.id=m.booking_id WHERE i.id=? AND i.user_id=? AND i.status='pending'").get(req.params.id,req.user.id);if(!inv)return res.status(404).json({error:'ไม่พบคำเชิญ'});if(action==='reject'){db.prepare("UPDATE team_match_invites SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(inv.id);return res.json({ok:true,status:'rejected'})}if(!db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(inv.team_id,req.user.id))return res.status(409).json({error:'คุณไม่ได้เป็นสมาชิกทีมนี้แล้ว'});if(inv.booking_status!=='confirmed'||!inv.open_for_join||bookingState(inv.match_date,inv.start_time,inv.end_time)!=='UPCOMING')return res.status(409).json({error:'นัดนี้ไม่พร้อมรับสมาชิกแล้ว'});const joined=db.transaction(()=>{const exists=db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND user_id=?').get(inv.match_id,req.user.id);if(exists)return true;const count=db.prepare('SELECT COUNT(*) n FROM match_players WHERE match_id=?').get(inv.match_id).n;if(count>=inv.max_players)return false;db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(inv.match_id,req.user.id);db.prepare("INSERT OR IGNORE INTO match_attendance(match_id,user_id,status) VALUES(?,?,'pending')").run(inv.match_id,req.user.id);return true})();if(!joined)return res.status(409).json({error:'นัดเต็มแล้ว'});db.prepare("UPDATE team_match_invites SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(inv.id);res.json({ok:true,status:'accepted'}) })
app.get('/api/notifications', auth, (req,res) => { const rows=db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id); res.json(rows) })
app.post('/api/notifications/:id/read', auth, (req,res) => { db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user.id); res.json({ok:true}) })
app.post('/api/notifications/read-all', auth, (req,res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ok:true}) })

app.get('/api/me', auth, (req,res) => {
 const user = db.prepare('SELECT id,name,email,role,points,wins,losses,phone,address,avatar,birth_date,position,skill_level,created_at FROM users WHERE id=?').get(req.user.id)
 res.json({...user,age:user.birth_date?calcAge(user.birth_date):null})
})
app.patch('/api/me', auth, (req,res) => {
 const name=String(req.body.name||'').trim(), phone=String(req.body.phone||'').trim(), address=String(req.body.address||'').trim(), birthDate=req.body.birthDate===undefined?null:String(req.body.birthDate||'').trim()
 const position=String(req.body.position??'').trim(), skillLevel=String(req.body.skillLevel??'beginner').trim()
 const avatar=req.body.avatar==null||req.body.avatar===''?null:String(req.body.avatar)
 if(!name||name.length>80)return res.status(400).json({error:'กรุณากรอกชื่อให้ถูกต้อง'})
 if(!validDate(birthDate)||birthDate>bangkokDate()||calcAge(birthDate)===null||calcAge(birthDate)<13)return res.status(400).json({error:'วันเกิดไม่ถูกต้องหรืออายุต่ำกว่า 13 ปี'})
 if(phone.length<8||phone.length>20)return res.status(400).json({error:'กรุณากรอกเบอร์โทรให้ถูกต้อง'})
 if(!address||address.length>300)return res.status(400).json({error:'กรุณากรอกที่อยู่ให้ถูกต้อง'})
 if(position.length>30)return res.status(400).json({error:'ตำแหน่งที่เล่นยาวเกินไป'})
 if(!['beginner','casual','intermediate','advanced'].includes(skillLevel))return res.status(400).json({error:'ระดับการเล่นไม่ถูกต้อง'})
 if(req.body.birthDate!==undefined && (!birthDate||!validDate(birthDate)||birthDate>bangkokDate()||calcAge(birthDate)===null))return res.status(400).json({error:'วันเกิดไม่ถูกต้อง'})
 if(req.body.birthDate!==undefined && calcAge(birthDate)<13)return res.status(400).json({error:'ผู้ใช้งานต้องมีอายุอย่างน้อย 13 ปี'})
 if(avatar && (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(avatar)||avatar.length>180000)) return res.status(400).json({error:'รูปโปรไฟล์ไม่ถูกต้องหรือมีขนาดใหญ่เกินไป'})
 if(req.body.birthDate!==undefined) db.prepare('UPDATE users SET name=?,phone=?,address=?,avatar=?,birth_date=?,position=?,skill_level=? WHERE id=?').run(name,phone,address,avatar,birthDate,position,skillLevel,req.user.id)
 else db.prepare('UPDATE users SET name=?,phone=?,address=?,birth_date=?,avatar=?,position=?,skill_level=? WHERE id=?').run(name,phone,address,birthDate,avatar,position,skillLevel,req.user.id)
 const user=db.prepare('SELECT id,name,email,role,points,wins,losses,phone,address,avatar,birth_date,position,skill_level FROM users WHERE id=?').get(req.user.id)
 res.json({...user,age:user.birth_date?calcAge(user.birth_date):null})
})

app.get('/api/venues/:id/slots', (req,res) => {
 const date = String(req.query.date || bangkokDate())
 if(!validDate(date)) return res.status(400).json({error:'วันที่ไม่ถูกต้อง'})
 const venue=db.prepare("SELECT service_status,review_status FROM venues WHERE id=?").get(req.params.id)
 if(!venue||venue.review_status!=='approved') return res.status(404).json({error:'ไม่พบสนาม'})
 if(venue.service_status!=='active') return res.json({date,slots:[]})
 const booked = new Set(db.prepare('SELECT start_time FROM bookings WHERE venue_id=? AND booking_date=? AND status=?').all(req.params.id,date,'confirmed').map(x=>x.start_time))
 const slots = ['16:00','17:00','18:00','19:00','20:00','21:00','22:00'].map(start => ({start,end:`${String(Number(start.slice(0,2))+1).padStart(2,'0')}:00`,available:!booked.has(start)}))
 res.json({date,slots})
})
app.post('/api/bookings', auth, (req,res) => {
 const {venueId,bookingDate,startTime,endTime,totalPrice} = req.body
 if (!venueId || !bookingDate || !startTime || !endTime) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 if (!validDate(String(bookingDate))) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const venue=db.prepare("SELECT id,price_per_hour,owner_id,name,review_status,service_status FROM venues WHERE id=?").get(venueId)
 if(!venue) return res.status(404).json({error:'ไม่พบสนาม'})
 if(venue.review_status!=='approved'||venue.service_status!=='active') return res.status(409).json({error:'สนามนี้ยังไม่พร้อมให้บริการ'})
 const clientPrice=Number(totalPrice)
 if(!Number.isFinite(clientPrice)||clientPrice<=0||clientPrice!==Number(venue.price_per_hour)) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 try {
  if(!/^\d{2}:00$/.test(startTime)||!/^\d{2}:00$/.test(endTime)) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
  const startHour=Number(startTime.slice(0,2)),endHour=Number(endTime.slice(0,2))
  if(startHour<16||startHour>22||endHour!==startHour+1) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
  if (startTime >= endTime) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
  const startAt=new Date(`${bookingDate}T${startTime}:00+07:00`)
  const endAt=new Date(`${bookingDate}T${endTime}:00+07:00`)
  if(Number.isNaN(startAt.getTime())||Number.isNaN(endAt.getTime())) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
  if(startAt<=new Date() || endAt<=startAt) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
  const overlap = db.prepare("SELECT id FROM bookings WHERE venue_id=? AND booking_date=? AND status='confirmed' AND start_time < ? AND end_time > ? LIMIT 1").get(venueId,bookingDate,endTime,startTime)
  if (overlap) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
  const reusable = db.prepare("SELECT * FROM bookings WHERE venue_id=? AND booking_date=? AND start_time=? AND status<>'confirmed'").get(venueId,bookingDate,startTime)
  if (reusable) {
   db.prepare('DELETE FROM matches WHERE booking_id=?').run(reusable.id)
   db.prepare('DELETE FROM split_bills WHERE booking_id=?').run(reusable.id)
   db.prepare("UPDATE bookings SET user_id=?,end_time=?,total_price=?,status='confirmed',created_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,endTime,venue.price_per_hour,reusable.id)
   if (venue.owner_id && Number(venue.owner_id)!==req.user.id) {
    const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)
    notify(Number(venue.owner_id),'booking','มีการจองสนามใหม่',`${u?.name||'ผู้ใช้งาน'} จองสนาม ${venue.name} วันที่ ${bookingDate} เวลา ${startTime}-${endTime}`)
   }
   audit(req.user.id,'booking.reclaim','booking',reusable.id,{venue_id:Number(venueId),booking_date:bookingDate,start_time:startTime,end_time:endTime})
   return res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id=?').get(reusable.id))
  }
  const insertBooking = db.transaction(() => {
   const overlapNow = db.prepare("SELECT id FROM bookings WHERE venue_id=? AND booking_date=? AND status='confirmed' AND start_time < ? AND end_time > ? LIMIT 1").get(venueId,bookingDate,endTime,startTime)
   if (overlapNow) throw new Error('BOOKING_CONFLICT')
   const result = db.prepare('INSERT INTO bookings(venue_id,user_id,booking_date,start_time,end_time,total_price) VALUES(?,?,?,?,?,?)').run(venueId,req.user.id,bookingDate,startTime,endTime,venue.price_per_hour)
   return result.lastInsertRowid
  })
  const bookingId = insertBooking()
  audit(req.user.id,'booking.create','booking',bookingId,{venue_id:Number(venueId),booking_date:bookingDate,start_time:startTime,end_time:endTime})
  if (venue.owner_id && Number(venue.owner_id)!==req.user.id) {
   const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)
   notify(Number(venue.owner_id),'booking','มีการจองสนามใหม่',`${u?.name||'ผู้ใช้งาน'} จองสนาม ${venue.name} วันที่ ${bookingDate} เวลา ${startTime}-${endTime}`)
  }
  res.status(201).json(db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId))
 } catch { res.status(409).json({error:'เกิดข้อผิดพลาด'}) }
})
app.get('/api/bookings/me', auth, (req,res) => res.json(db.prepare("SELECT b.*,v.name venue_name,m.id match_id,m.open_for_join FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN matches m ON m.booking_id=b.id WHERE b.user_id=? AND b.status='confirmed' AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=b.id AND sb.status='closed') ORDER BY b.booking_date DESC,b.start_time DESC").all(req.user.id)))
app.get('/api/owner/bookings', auth, (req,res) => {
 if (req.user.role !== 'owner' && req.user.role !== 'admin') return res.status(403).json({error:'เกิดข้อผิดพลาด'})
 const rows = req.user.role === 'admin'
  ? db.prepare("SELECT b.*,v.name venue_name,u.name user_name,u.email user_email FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id ORDER BY b.booking_date DESC,b.start_time DESC").all()
  : db.prepare("SELECT b.*,v.name venue_name,u.name user_name,u.email user_email FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id WHERE v.owner_id=? ORDER BY b.booking_date DESC,b.start_time DESC").all(req.user.id)
 const now=Date.now()
 res.json(rows.map(b=>{const start=new Date(b.booking_date+'T'+b.start_time+':00+07:00').getTime();const end=new Date(b.booking_date+'T'+b.end_time+':00+07:00').getTime();const state=String(b.status).toUpperCase()==='CANCELLED'?'CANCELLED':now<start?'UPCOMING':now<end?'IN_PROGRESS':'COMPLETED';return {...b,state}}))
})
app.post('/api/bookings/:id/cancel', auth, (req,res) => {
 const b=db.prepare("SELECT b.*,v.name venue_name,v.owner_id FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=? AND b.user_id=? AND b.status='confirmed'").get(req.params.id,req.user.id)
 if(!b)return res.status(404).json({error:'ไม่พบข้อมูลการจอง'})
 const now=new Date(),start=new Date(`${b.booking_date}T${b.start_time}:00+07:00`),end=new Date(`${b.booking_date}T${b.end_time}:00+07:00`)
 if(now>=start)return res.status(409).json({error:now>=end?'การจองนี้หมดเวลาแล้ว ไม่สามารถยกเลิกได้':'สนามกำลังใช้งานอยู่ ไม่สามารถยกเลิกการจองได้'})
 db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id)
 audit(req.user.id,'booking.cancel','booking',b.id,{venue_id:b.venue_id,booking_date:b.booking_date,start_time:b.start_time})
 const members=db.prepare('SELECT user_id FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE m.booking_id=? AND mp.user_id<>?').all(b.id,b.user_id)
 db.prepare('UPDATE matches SET open_for_join=0 WHERE booking_id=?').run(b.id)
 db.prepare("UPDATE split_bills SET status='closed' WHERE booking_id=? AND status='open'").run(b.id)
 members.forEach(x=>notify(x.user_id,'cancel','การจองถูกยกเลิก',`นัดของคุณ ${b.booking_date} ${b.start_time} ถูกยกเลิก`))
 if(b.owner_id && Number(b.owner_id)!==req.user.id) notify(Number(b.owner_id),'cancel','การจองถูกยกเลิก',`การจองสนาม ${b.venue_name} วันที่ ${b.booking_date} เวลา ${b.start_time}-${b.end_time} ถูกยกเลิก`)
 res.json({ok:true})
})

app.get('/api/matches', (req,res) => {
 const rows = db.prepare(`SELECT m.*,v.name venue_name,b.end_time,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.birth_date IS NOT NULL AND (CAST(strftime('%Y',date('now','+7 hours')) AS INTEGER)-CAST(strftime('%Y',u.birth_date) AS INTEGER)-(strftime('%m-%d',date('now','+7 hours'))<strftime('%m-%d',u.birth_date))) BETWEEN 13 AND 15) age_13_15,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.birth_date IS NOT NULL AND (CAST(strftime('%Y',date('now','+7 hours')) AS INTEGER)-CAST(strftime('%Y',u.birth_date) AS INTEGER)-(strftime('%m-%d',date('now','+7 hours'))<strftime('%m-%d',u.birth_date))) BETWEEN 16 AND 18) age_16_18,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.birth_date IS NOT NULL AND (CAST(strftime('%Y',date('now','+7 hours')) AS INTEGER)-CAST(strftime('%Y',u.birth_date) AS INTEGER)-(strftime('%m-%d',date('now','+7 hours'))<strftime('%m-%d',u.birth_date))) BETWEEN 19 AND 25) age_19_25,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.birth_date IS NOT NULL AND (CAST(strftime('%Y',date('now','+7 hours')) AS INTEGER)-CAST(strftime('%Y',u.birth_date) AS INTEGER)-(strftime('%m-%d',date('now','+7 hours'))<strftime('%m-%d',u.birth_date))) >= 26) age_26_plus,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.skill_level='beginner') skill_beginner,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.skill_level='casual') skill_casual,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.skill_level='intermediate') skill_intermediate,(SELECT COUNT(*) FROM match_players mp JOIN users u ON u.id=mp.user_id WHERE mp.match_id=m.id AND u.skill_level='advanced') skill_advanced FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.open_for_join=1 AND (b.status='confirmed') AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=m.booking_id AND sb.status='closed') ORDER BY m.match_date,m.start_time`).all()
 const visible = rows.filter(r => bookingState(r.match_date,r.start_time,r.end_time) !== 'EXPIRED')
 res.json(visible.map(r=>({...r,state:bookingState(r.match_date,r.start_time,r.end_time)})))
})
app.post('/api/matches', auth, (req,res) => {
 const {bookingId,title,fee,maxPlayers=10,teamId=null} = req.body
 if (!bookingId || !title || !fee) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const booking=db.prepare("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'").get(bookingId,req.user.id)
 if (!booking) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const matchState=bookingState(booking.booking_date,booking.start_time,booking.end_time)
 if(matchState!=='UPCOMING') return res.status(409).json({error:matchState==='EXPIRED'?'การจองนี้หมดเวลาแล้ว ไม่สามารถสร้างนัดได้':'การจองนี้เริ่มแล้ว ไม่สามารถสร้างนัดได้'})
 const max=Number(maxPlayers)
 if(!Number.isInteger(max)||max<2||max>30) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const matchFee=Number(fee)
 if(!Number.isFinite(matchFee)||matchFee<=0) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const existingMatch=db.prepare('SELECT * FROM matches WHERE booking_id=? ORDER BY id DESC LIMIT 1').get(booking.id)
 if(existingMatch) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if(teamId!==null){const team=db.prepare('SELECT id FROM teams WHERE id=? AND owner_id=?').get(Number(teamId),req.user.id);if(!team)return res.status(403).json({error:'คุณไม่มีสิทธิ์ใช้ทีมนี้'})}
 const result=db.prepare('INSERT INTO matches(creator_id,venue_id,title,match_date,start_time,end_time,fee,max_players,booking_id,open_for_join,team_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(req.user.id,booking.venue_id,title.trim(),booking.booking_date,booking.start_time,booking.end_time,matchFee,max,booking.id,1,teamId===null?null:Number(teamId))
 db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(result.lastInsertRowid,req.user.id); audit(req.user.id,'match.create','match',Number(result.lastInsertRowid),{booking_id:Number(booking.id),max_players:max})
 if(teamId!==null){const members=db.prepare('SELECT user_id FROM team_members WHERE team_id=? AND user_id<>?').all(Number(teamId),req.user.id);const inv=db.prepare('INSERT OR IGNORE INTO team_match_invites(match_id,team_id,user_id) VALUES(?,?,?)');members.forEach(x=>{inv.run(result.lastInsertRowid,Number(teamId),x.user_id);notify(x.user_id,'match_invite','คำเชิญเข้าร่วมนัด','คุณได้รับคำเชิญจากทีมให้เข้าร่วมนัด '+title.trim())})}
 res.status(201).json(db.prepare('SELECT * FROM matches WHERE id=?').get(result.lastInsertRowid))
})
app.post('/api/matches/:id/open', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=? AND m.creator_id=?').get(req.params.id,req.user.id)
 if(!m) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 const closedBill=db.prepare("SELECT 1 FROM split_bills WHERE booking_id=? AND status='closed' LIMIT 1").get(m.booking_id)
 if(closedBill) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 db.prepare('UPDATE matches SET open_for_join=1 WHERE id=?').run(m.id)
 res.json({ok:true})
})
app.post('/api/matches/:id/close', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.status booking_status,b.booking_date,b.end_time FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=? AND m.creator_id=?').get(req.params.id,req.user.id)
 if(!m) return res.status(404).json({error:'ไม่พบข้อมูลนัดของคุณ'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'การจองสนามถูกยกเลิกแล้ว'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'นัดนี้เริ่มหรือหมดเวลาแล้ว'})
 db.prepare('UPDATE matches SET open_for_join=0 WHERE id=?').run(m.id); audit(req.user.id,'match.close','match',m.id,{booking_id:m.booking_id})
 const players=db.prepare('SELECT user_id FROM match_players WHERE match_id=? AND user_id<>?').all(m.id,m.creator_id)
 players.forEach(x=>notify(x.user_id,'match_close','ปิดรับสมาชิกแล้ว','นัด '+m.title+' ปิดรับสมาชิกแล้ว'))
 res.json({ok:true})
})
app.get('/api/matches/me', auth, (req,res) => {
 const rows=db.prepare("SELECT m.*,v.name venue_name,b.end_time,b.status booking_status,(SELECT COUNT(*) FROM match_players mp WHERE mp.match_id=m.id) players FROM matches m JOIN venues v ON v.id=m.venue_id LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.creator_id=? AND b.status='confirmed' AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=m.booking_id AND sb.status='closed') ORDER BY m.match_date,m.start_time").all(req.user.id)
 res.json(rows.map(r=>({...r,state:bookingState(r.match_date,r.start_time,r.end_time)})))
})
app.post('/api/matches/:id/join', auth, (req,res) => {
 const match = db.prepare("SELECT m.*,b.end_time,b.status booking_status FROM matches m LEFT JOIN bookings b ON b.id=m.booking_id WHERE m.id=?").get(req.params.id)
 if (match && match.booking_status !== 'confirmed') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if (!match) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const state=bookingState(match.match_date,match.start_time,match.end_time)
 if(state!=='UPCOMING') return res.status(409).json({error:state==='EXPIRED'?'นัดนี้หมดเวลาแล้ว':'นัดนี้เริ่มแล้ว ไม่สามารถเข้าร่วมได้'})
 if(!match.open_for_join) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 const existing = db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND user_id=?').get(match.id,req.user.id)
 if (existing) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 try {
  const joined=db.transaction(()=>{
   const count=db.prepare('SELECT COUNT(*) n FROM match_players WHERE match_id=?').get(match.id).n
   if(count>=match.max_players) return false
   db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(match.id,req.user.id)
   db.prepare("INSERT OR IGNORE INTO match_attendance(match_id,user_id,status) VALUES(?,?,'pending')").run(match.id,req.user.id)
   return true
  })()
  if(!joined) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
  if(req.user.id!==match.creator_id){ const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id); notify(match.creator_id,'join','มีสมาชิกเข้าร่วมนัด',(u?.name||'ผู้ใช้งาน')+' เข้าร่วมนัด '+match.title) }
 } catch { return res.status(409).json({error:'เกิดข้อผิดพลาด'}) }
 res.json({ok:true,message:'เข้าร่วมนัดสำเร็จ'})
})

const syncAttendance = (matchId) => {
 const m=db.prepare('SELECT match_date,start_time,end_time FROM matches WHERE id=?').get(matchId)
 if(!m) return
 const members=db.prepare('SELECT user_id FROM match_players WHERE match_id=?').all(matchId)
 const insert=db.prepare("INSERT OR IGNORE INTO match_attendance(match_id,user_id,status) VALUES(?,?,'pending')")
 members.forEach(x=>insert.run(matchId,x.user_id))
 if(bookingState(m.match_date,m.start_time,m.end_time)==='EXPIRED'){
  db.prepare("UPDATE match_attendance SET status='no_show',updated_at=CURRENT_TIMESTAMP WHERE match_id=? AND status='pending'").run(matchId)
 }
}
const syncReliability = (userId) => {
 const pendingMatches=db.prepare("SELECT match_id FROM match_attendance WHERE user_id=? AND status='pending'").all(userId)
 pendingMatches.forEach(x=>syncAttendance(x.match_id))
 const row=db.prepare("SELECT SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended_count,SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled_count,SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show_count FROM match_attendance WHERE user_id=?").get(userId)
 const attended=Number(row.attended_count||0),cancelled=Number(row.cancelled_count||0),noShow=Number(row.no_show_count||0)
 const score=Math.max(0,Math.min(100,100-(cancelled*5)-(noShow*20)))
 db.prepare("INSERT INTO user_reliability(user_id,attended_count,cancelled_count,no_show_count,reliability_score) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET attended_count=excluded.attended_count,cancelled_count=excluded.cancelled_count,no_show_count=excluded.no_show_count,reliability_score=excluded.reliability_score,updated_at=CURRENT_TIMESTAMP").run(userId,attended,cancelled,noShow,score)
 return {attended_count:attended,cancelled_count:cancelled,no_show_count:noShow,reliability_score:score}
}
const getReliability = (userId) => {
 const current=syncReliability(userId)
 const trust=current.reliability_score>=90?'ยอดเยี่ยม':current.reliability_score>=70?'ดี':current.reliability_score>=50?'ควรระวัง':'ความน่าเชื่อถือต่ำ'
 return {...current,trust_level:trust}
}
app.get('/api/matches/:id/players', auth, (req,res) => {
 const m=db.prepare('SELECT id,creator_id,max_players,open_for_join FROM matches WHERE id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 syncAttendance(m.id); const players=db.prepare("SELECT u.id,u.name,u.birth_date,u.position,u.skill_level,ur.reliability_score,CASE WHEN u.birth_date IS NOT NULL THEN (CAST(strftime('%Y',date('now','+7 hours')) AS INTEGER)-CAST(strftime('%Y',u.birth_date) AS INTEGER)-(strftime('%m-%d',date('now','+7 hours'))<strftime('%m-%d',u.birth_date))) ELSE NULL END AS age,ma.status attendance_status,CASE WHEN u.id=? THEN 1 ELSE 0 END AS owner FROM match_players mp JOIN users u ON u.id=mp.user_id LEFT JOIN match_attendance ma ON ma.match_id=mp.match_id AND ma.user_id=mp.user_id LEFT JOIN user_reliability ur ON ur.user_id=u.id WHERE mp.match_id=? ORDER BY owner DESC,u.name").all(m.creator_id,m.id)
 res.json({match:m,players})
})
app.post('/api/matches/:id/leave', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if(m.creator_id===req.user.id) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 db.prepare("UPDATE match_attendance SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE match_id=? AND user_id=?").run(m.id,req.user.id)
 const result=db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?').run(m.id,req.user.id)
 if(!result.changes) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 audit(req.user.id,'match.leave','match',m.id,{user_id:req.user.id})
 const u=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id); notify(m.creator_id,'leave','สมาชิกออกจากนัด',(u?.name||'ผู้ใช้งาน')+' ออกจากนัด '+m.title)
 res.json({ok:true})
})
app.delete('/api/matches/:id/players/:userId', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.booking_date,b.end_time,b.status booking_status FROM matches m JOIN bookings b ON b.id=m.booking_id WHERE m.id=?').get(req.params.id)
 if(!m) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 if(m.booking_status!=='confirmed') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='UPCOMING') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 if(m.creator_id!==req.user.id) return res.status(403).json({error:'เกิดข้อผิดพลาด'})
 if(Number(req.params.userId)===m.creator_id) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 db.prepare("UPDATE match_attendance SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE match_id=? AND user_id=?").run(m.id,req.params.userId)
 const result=db.prepare('DELETE FROM match_players WHERE match_id=? AND user_id=?').run(m.id,req.params.userId)
 if(!result.changes) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 notify(Number(req.params.userId),'remove','คุณถูกนำออกจากนัด','คุณถูกนำออกจากนัด '+m.title)
 res.json({ok:true})
})

app.get('/api/me/stats', auth, (req,res) => {
 const r=getReliability(req.user.id)
 const joined=Number(db.prepare('SELECT COUNT(*) n FROM match_attendance WHERE user_id=?').get(req.user.id).n||0)
 const attended=Number(db.prepare("SELECT COUNT(*) n FROM match_attendance WHERE user_id=? AND status='attended'").get(req.user.id).n||0)
 const upcoming=Number(db.prepare("SELECT COUNT(*) n FROM match_players mp JOIN matches m ON m.id=mp.match_id JOIN bookings b ON b.id=m.booking_id WHERE mp.user_id=? AND b.status='confirmed' AND (m.match_date || ' ' || m.start_time) >= (strftime('%Y-%m-%d %H:%M','now','+7 hours'))").get(req.user.id).n||0)
 const pointRows=db.prepare('SELECT points,description,created_at FROM point_events WHERE user_id=? ORDER BY created_at DESC LIMIT 10').all(req.user.id)
 const history=db.prepare("SELECT m.id,m.title,m.match_date,m.start_time,m.end_time,v.name venue_name,r.team_a_score,r.opponent_name,r.team_b_score,CASE WHEN r.team_a_score>r.team_b_score THEN 'win' WHEN r.team_a_score<r.team_b_score THEN 'loss' ELSE 'draw' END outcome,ma.status attendance_status FROM matches m JOIN venues v ON v.id=m.venue_id JOIN match_players mp ON mp.match_id=m.id AND mp.user_id=? LEFT JOIN match_results r ON r.match_id=m.id LEFT JOIN match_attendance ma ON ma.match_id=m.id AND ma.user_id=? WHERE (m.match_date || ' ' || m.start_time) < (strftime('%Y-%m-%d %H:%M','now','+7 hours')) ORDER BY m.match_date DESC,m.start_time DESC LIMIT 10").all(req.user.id,req.user.id)
 const user=db.prepare('SELECT points,wins,losses FROM users WHERE id=?').get(req.user.id)
 res.json({matches_joined:joined,matches_attended:attended,upcoming_matches:upcoming,points:Number(user?.points||0),tier:pointTier(Number(user?.points||0)),wins:Number(user?.wins||0),losses:Number(user?.losses||0),recent_points:pointRows,history,reliability:r})
})
app.get('/api/me/reliability', auth, (req,res) => res.json(getReliability(req.user.id)))
app.get('/api/matches/:id/reliability', auth, (req,res) => {
 const m=db.prepare('SELECT id,creator_id,match_date,start_time,end_time FROM matches WHERE id=?').get(req.params.id)
 if(!m)return res.status(404).json({error:'ไม่พบข้อมูลนัด'})
 syncAttendance(m.id)
 const ids=db.prepare('SELECT DISTINCT user_id FROM match_players WHERE match_id=? UNION SELECT DISTINCT user_id FROM match_attendance WHERE match_id=?').all(m.id,m.id)
 ids.forEach(x=>syncReliability(x.user_id))
 const rows=db.prepare("SELECT ma.user_id,u.name,ma.status attendance_status,ur.attended_count,ur.cancelled_count,ur.no_show_count,ur.reliability_score FROM match_attendance ma JOIN users u ON u.id=ma.user_id LEFT JOIN user_reliability ur ON ur.user_id=ma.user_id WHERE ma.match_id=? ORDER BY ma.user_id").all(m.id)
 res.json({match:m,players:rows})
})
app.post('/api/matches/:id/check-in/:userId', auth, (req,res) => {
 const m=db.prepare('SELECT id,creator_id,match_date,start_time,end_time FROM matches WHERE id=?').get(req.params.id)
 if(!m)return res.status(404).json({error:'ไม่พบข้อมูลนัด'})
 if(m.creator_id!==req.user.id && Number(req.params.userId)!==req.user.id)return res.status(403).json({error:'คุณไม่มีสิทธิ์เช็กชื่อสมาชิกคนนี้'})
 const player=db.prepare('SELECT 1 FROM match_players WHERE match_id=? AND user_id=?').get(m.id,req.params.userId)
 if(!player)return res.status(404).json({error:'ไม่พบสมาชิกในนัด'})
 const start=new Date(m.match_date+'T'+m.start_time+':00+07:00')
 const end=new Date(m.match_date+'T'+m.end_time+':00+07:00')
 const now=new Date(),openAt=new Date(start.getTime()-2*60*60*1000),closeAt=new Date(end.getTime()+30*60*1000)
 if(now<openAt||now>closeAt)return res.status(409).json({error:'ยังไม่ถึงช่วงเวลาสำหรับเช็กชื่อ'})
 syncAttendance(m.id)
 const attendanceRow=db.prepare('SELECT status FROM match_attendance WHERE match_id=? AND user_id=?').get(m.id,req.params.userId)
 const wasAttended=attendanceRow?.status==='attended'
 db.prepare("UPDATE match_attendance SET status='attended',checked_in_at=COALESCE(checked_in_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE match_id=? AND user_id=?").run(m.id,req.params.userId)
 audit(req.user.id,'match.check_in','match',m.id,{user_id:Number(req.params.userId)})
 syncReliability(Number(req.params.userId))
 if(!wasAttended) awardPoints(Number(req.params.userId),10,'match_attended:'+m.id,'เข้าร่วมแมตช์สำเร็จ')
 const summary=db.prepare("SELECT SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended,SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show,SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,COUNT(*) total FROM match_attendance WHERE match_id=?").get(m.id)
 res.json({ok:true,summary:{attended:Number(summary.attended||0),no_show:Number(summary.no_show||0),cancelled:Number(summary.cancelled||0),total:Number(summary.total||0)}})
})
app.get('/api/matches/:id/result', auth, (req,res) => { const m=db.prepare('SELECT m.id,m.creator_id,m.team_id,m.match_date,m.start_time,m.end_time,t.name team_name,r.id result_id,r.team_a_score,r.opponent_name,r.team_b_score,r.submitted_by,r.created_at,r.updated_at FROM matches m LEFT JOIN teams t ON t.id=m.team_id LEFT JOIN match_results r ON r.match_id=m.id WHERE m.id=?').get(req.params.id);if(!m)return res.status(404).json({error:'ไม่พบข้อมูลนัด'});if(m.team_id&& !db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(m.team_id,req.user.id))return res.status(403).json({error:'คุณไม่ได้อยู่ในทีมนี้'});res.json(m.result_id?{...m,result:{id:m.result_id,team_a_score:m.team_a_score,opponent_name:m.opponent_name,team_b_score:m.team_b_score,submitted_by:m.submitted_by,created_at:m.created_at,updated_at:m.updated_at}}:{...m,result:null}) })
app.post('/api/matches/:id/result', auth, (req,res) => {
 const m=db.prepare('SELECT m.*,b.status booking_status,t.name team_name FROM matches m JOIN bookings b ON b.id=m.booking_id LEFT JOIN teams t ON t.id=m.team_id WHERE m.id=?').get(req.params.id)
 if(!m)return res.status(404).json({error:'ไม่พบข้อมูลนัด'})
 if(m.creator_id!==req.user.id)return res.status(403).json({error:'เฉพาะเจ้าของนัดเท่านั้นที่บันทึกผลได้'})
 if(!m.team_id)return res.status(409).json({error:'แมตช์นี้ยังไม่ได้ผูกกับทีม'})
 if(m.booking_status!=='confirmed'||bookingState(m.match_date,m.start_time,m.end_time)!=='EXPIRED')return res.status(409).json({error:'ต้องรอให้การแข่งขันจบก่อนจึงบันทึกผลได้'})
 const teamAScore=Number(req.body.teamAScore),teamBScore=Number(req.body.teamBScore),opponentName=String(req.body.opponentName||'').trim()
 if(!Number.isInteger(teamAScore)||teamAScore<0||teamAScore>99||!Number.isInteger(teamBScore)||teamBScore<0||teamBScore>99||!opponentName||opponentName.length>80)return res.status(400).json({error:'กรุณากรอกชื่อคู่แข่งและสกอร์ให้ถูกต้อง'})
 const existing=db.prepare('SELECT * FROM match_results WHERE match_id=?').get(m.id)
 if(existing)return res.status(409).json({error:'บันทึกผลการแข่งขันนี้แล้ว'})
 syncAttendance(m.id)
 const attendedCount=Number(db.prepare("SELECT COUNT(*) n FROM match_attendance WHERE match_id=? AND status='attended'").get(m.id).n||0)
 if(attendedCount<1)return res.status(409).json({error:'ต้องมีผู้เล่นที่เช็กชื่อว่าเข้าร่วมการแข่งขันอย่างน้อย 1 คน'})
 const members=db.prepare("SELECT tm.user_id FROM team_members tm JOIN match_players mp ON mp.user_id=tm.user_id AND mp.match_id=? JOIN match_attendance ma ON ma.user_id=tm.user_id AND ma.match_id=mp.match_id AND ma.status='attended' WHERE tm.team_id=?").all(m.id,m.team_id)
 const outcome=teamAScore>teamBScore?'win':teamAScore<teamBScore?'loss':'draw'
 const points=outcome==='win'?20:outcome==='draw'?10:5
 const result=db.transaction(()=>{
  const r=db.prepare('INSERT INTO match_results(match_id,team_a_score,opponent_name,team_b_score,submitted_by) VALUES(?,?,?,?,?)').run(m.id,teamAScore,opponentName,teamBScore,req.user.id)
  for(const member of members){db.prepare(`UPDATE users SET ${outcome==='win'?'wins=wins+1':outcome==='loss'?'losses=losses+1':'wins=wins'} WHERE id=?`).run(member.user_id);awardPoints(member.user_id,points,'match_result:'+m.id+':'+outcome,'ผลการแข่งขัน '+m.title+' '+teamAScore+'-'+teamBScore)}
  audit(req.user.id,'match.result','match_result',Number(r.lastInsertRowid),{match_id:m.id,team_id:m.team_id,team_a_score:teamAScore,team_b_score:teamBScore,opponent_name:opponentName,outcome})
  return r.lastInsertRowid
 })()
 const saved=db.prepare('SELECT * FROM match_results WHERE id=?').get(result)
 res.status(201).json({ok:true,outcome,points_per_player:points,result:saved})
})
app.post('/api/matches/:id/finalize-attendance', auth, (req,res) => {
 const m=db.prepare('SELECT id,creator_id,match_date,start_time,end_time FROM matches WHERE id=?').get(req.params.id)
 if(!m)return res.status(404).json({error:'ไม่พบข้อมูลนัด'})
 if(m.creator_id!==req.user.id)return res.status(403).json({error:'เฉพาะเจ้าของนัดเท่านั้นที่ปิดผลนัดได้'})
 if(bookingState(m.match_date,m.start_time,m.end_time)!=='EXPIRED')return res.status(409).json({error:'นัดยังไม่จบ'})
 syncAttendance(m.id)
 const ids=db.prepare('SELECT user_id FROM match_attendance WHERE match_id=?').all(m.id)
 ids.forEach(x=>syncReliability(x.user_id))
 const summary=db.prepare("SELECT SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended,SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show,SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,COUNT(*) total FROM match_attendance WHERE match_id=?").get(m.id)
 res.json({ok:true,summary:{attended:Number(summary.attended||0),no_show:Number(summary.no_show||0),cancelled:Number(summary.cancelled||0),total:Number(summary.total||0)}})
})
app.post('/api/split-bills', auth, (req,res) => {
 const {bookingId,shareCount,names=[]} = req.body
 const booking = db.prepare("SELECT * FROM bookings WHERE id=? AND user_id=? AND status='confirmed'").get(bookingId,req.user.id)
 if (!booking) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const billState=bookingState(booking.booking_date,booking.start_time,booking.end_time)
 if(billState==='EXPIRED') return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 const count=Number(shareCount)
 if (!Number.isInteger(count)||count<2||count>30) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const baseShare=Math.floor(booking.total_price/count)
 const remainder=booking.total_price%count
 const share=baseShare
 const existing=db.prepare("SELECT * FROM split_bills WHERE booking_id=? AND owner_user_id=? AND status='open'").get(booking.id,req.user.id)
 if(existing){
  const paidCount=db.prepare('SELECT COUNT(*) n FROM split_bill_members WHERE split_bill_id=? AND paid=1').get(existing.id).n
  if(paidCount>0 && Number(existing.share_count)!==count) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
  db.prepare('UPDATE split_bills SET share_count=?,share_amount=?,total_amount=? WHERE id=?').run(count,share,booking.total_price,existing.id)
  const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  if(members.length>count) db.prepare('DELETE FROM split_bill_members WHERE split_bill_id=? AND id IN (SELECT id FROM split_bill_members WHERE split_bill_id=? ORDER BY id DESC LIMIT ?)').run(existing.id,existing.id,members.length-count)
  const current=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  const add=db.prepare('INSERT INTO split_bill_members(split_bill_id,name) VALUES(?,?)')
  for(let i=current.length;i<count;i++) add.run(existing.id,names[i]||('ผู้เล่น '+(i+1)))
  const updated=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(existing.id)
  const rename=db.prepare('UPDATE split_bill_members SET name=? WHERE id=? AND paid=0')
  const setAmount=db.prepare('UPDATE split_bill_members SET amount=? WHERE id=?')
  updated.forEach((m,i)=>{if(names[i]) rename.run(names[i],m.id);setAmount.run(baseShare+(i<remainder?1:0),m.id)})
  return res.json({id:existing.id,shareAmount:share,shareCount:count,totalAmount:booking.total_price})
 }
 const result=db.prepare('INSERT INTO split_bills(booking_id,owner_user_id,total_amount,share_count,share_amount) VALUES(?,?,?,?,?)').run(booking.id,req.user.id,booking.total_price,count,share)
 audit(req.user.id,'split_bill.create','split_bill',Number(result.lastInsertRowid),{booking_id:Number(booking.id),share_count:count,total_amount:booking.total_price})
 const add=db.prepare('INSERT INTO split_bill_members(split_bill_id,name,amount) VALUES(?,?,?)')
 for(let i=0;i<count;i++) add.run(result.lastInsertRowid,names[i]||('ผู้เล่น '+(i+1)),baseShare+(i<remainder?1:0))
 res.status(201).json({id:result.lastInsertRowid,shareAmount:share,shareCount:count,totalAmount:booking.total_price})
})
app.get('/api/split-bills/booking/:bookingId', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE booking_id=? AND owner_user_id=? AND status='open'").get(req.params.bookingId,req.user.id)
 if(!bill) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 res.json({...bill,members})
})
app.post('/api/split-bills/:id/share-links', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const members=db.prepare('SELECT id,name,paid FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 const update=db.prepare('UPDATE split_bill_members SET member_token_hash=? WHERE id=? AND split_bill_id=?')
 const links=members.map(m=>{const token=crypto.randomBytes(24).toString('hex');update.run(hashMemberToken(token),m.id,bill.id);return {memberId:m.id,name:m.name,token}})
 res.json({billId:bill.id,links})
})
app.get('/api/split-bills/share/:token', (req,res) => {
 const token=String(req.params.token||'')
 if(!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const row=db.prepare("SELECT sb.id bill_id,sb.total_amount,sb.status,sbm.id member_id,sbm.name,sbm.amount,sbm.paid,b.booking_date,b.start_time,b.end_time,v.name venue_name FROM split_bill_members sbm JOIN split_bills sb ON sb.id=sbm.split_bill_id JOIN bookings b ON b.id=sb.booking_id JOIN venues v ON v.id=b.venue_id WHERE sbm.member_token_hash=?").get(hashMemberToken(token))
 if(!row || row.status!=='open') return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 res.json(row)
})
app.post('/api/split-bills/share/:token/pay', (req,res) => {
 const token=String(req.params.token||'')
 if(!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 const row=db.prepare("SELECT sb.id bill_id,sbm.id member_id,sbm.paid,sb.status FROM split_bill_members sbm JOIN split_bills sb ON sb.id=sbm.split_bill_id WHERE sbm.member_token_hash=?").get(hashMemberToken(token))
 if(!row || row.status!=='open') return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 if(row.paid) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 db.prepare("UPDATE split_bill_members SET paid=1,paid_at=CURRENT_TIMESTAMP WHERE id=? AND split_bill_id=? AND paid=0").run(row.member_id,row.bill_id); audit(null,'split_bill.pay','split_bill',row.bill_id,{member_id:row.member_id})
 res.json({ok:true,message:'ชำระเงินเรียบร้อยแล้ว'})
})
app.get('/api/split-bills/:id', auth, (req,res) => {
 const bill=db.prepare('SELECT * FROM split_bills WHERE id=? AND owner_user_id=?').get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const members=db.prepare('SELECT * FROM split_bill_members WHERE split_bill_id=? ORDER BY id').all(bill.id)
 res.json({...bill,members})
})
app.post('/api/split-bills/:billId/members/:memberId/pay', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.billId,req.user.id)
 if(!bill) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const member=db.prepare('SELECT id,paid FROM split_bill_members WHERE id=? AND split_bill_id=?').get(req.params.memberId,bill.id)
 if(!member) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 if(Number(member.paid)===1) return res.status(409).json({error:'เกิดข้อผิดพลาด'})
 db.prepare("UPDATE split_bill_members SET paid=1,paid_at=CURRENT_TIMESTAMP WHERE id=? AND split_bill_id=? AND paid=0").run(member.id,bill.id)
 res.json({ok:true})
})
app.post('/api/split-bills/:id/close', auth, (req,res) => {
 const bill=db.prepare("SELECT * FROM split_bills WHERE id=? AND owner_user_id=? AND status='open'").get(req.params.id,req.user.id)
 if(!bill) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const unpaid=db.prepare('SELECT COUNT(*) n FROM split_bill_members WHERE split_bill_id=? AND paid=0').get(bill.id).n
 if(unpaid>0) return res.status(409).json({error:'ยังมีสมาชิกค้างชำระ '+unpaid+' คน'})
 db.prepare("UPDATE split_bills SET status='closed' WHERE id=?").run(bill.id); audit(req.user.id,'split_bill.close','split_bill',bill.id,{booking_id:bill.booking_id})
 db.prepare('UPDATE matches SET open_for_join=0 WHERE booking_id=?').run(bill.booking_id)
 db.prepare("UPDATE bookings SET status='closed' WHERE id=? AND status='confirmed'").run(bill.booking_id)
 res.json({ok:true,message:'ปิดบิลเรียบร้อยแล้ว'})
})

app.patch('/api/admin/venues/:id/owner', auth, (req,res) => {
 if(req.user.role!=='admin') return res.status(403).json({error:'เฉพาะผู้ดูแลระบบเท่านั้น'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if(!venue) return res.status(404).json({error:'เกิดข้อผิดพลาด'})
 const ownerId=req.body.ownerId==null||req.body.ownerId===''?null:Number(req.body.ownerId)
 if(ownerId!==null){
  if(!Number.isInteger(ownerId)) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND role='owner'").get(ownerId)
  if(!owner) return res.status(400).json({error:'เกิดข้อผิดพลาด'})
 }
 db.prepare('UPDATE venues SET owner_id=? WHERE id=?').run(ownerId,venue.id)
 if(ownerId!==null && !venue.facility_id){
  const f=db.prepare('INSERT INTO facilities(owner_id,name,address) VALUES(?,?,?)').run(ownerId,venue.name,venue.address)
  db.prepare('UPDATE venues SET facility_id=? WHERE id=?').run(Number(f.lastInsertRowid),venue.id)
 }
 res.json(db.prepare(`${publicVenueSelect} WHERE v.id=?`).get(venue.id))
})

app.listen(PORT, HOST, () => console.log('MatchSoccer API running on '+HOST+':'+PORT))

// Venue onboarding + admin review workflow
const venueInput=(body)=>({name:String(body.name||'').trim(),area:String(body.area||'').trim(),address:String(body.address||'').trim(),price:Number(body.price_per_hour ?? body.pricePerHour),roof:body.roof?1:0,fieldTypes:String(body.field_types ?? body.fieldTypes ?? '').trim()})
app.get('/api/owner/venue-requests', auth, (req,res)=>{
 if(req.user.role!=='owner'&&req.user.role!=='admin') return res.status(403).json({error:'ไม่มีสิทธิ์จัดการคำขอสนาม'})
 const rows=req.user.role==='admin'?db.prepare('SELECT * FROM venues WHERE review_status<>? ORDER BY submitted_at DESC,id DESC').all('approved'):db.prepare("SELECT * FROM venues WHERE owner_id=? AND review_status<>'approved' ORDER BY id DESC").all(req.user.id)
 res.json(rows)
})
app.post('/api/owner/venues', auth, (req,res)=>{
 if(req.user.role!=='owner') return res.status(403).json({error:'บัญชีนี้ยังไม่ได้รับสิทธิ์เจ้าของสนาม'})
 const v=venueInput(req.body)
 if(!v.name||!v.area||!v.address||!v.fieldTypes||!Number.isFinite(v.price)||v.price<=0) return res.status(400).json({error:'กรุณากรอกข้อมูลสนาม ชื่อ พื้นที่ ที่อยู่ ราคา และประเภทสนามให้ครบ'})
 if(v.name.length>120||v.area.length>120||v.address.length>300||v.fieldTypes.length>100) return res.status(400).json({error:'ข้อมูลสนามยาวเกินกำหนด'})
 const result=db.prepare("INSERT INTO venues(name,area,address,rating,price_per_hour,roof,field_types,owner_id,review_status,review_note,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").run(v.name,v.area,v.address,0,v.price,v.roof,v.fieldTypes,req.user.id,'pending_review','')
 const id=Number(result.lastInsertRowid)
 db.prepare("INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)").run(id,req.user.id,'submitted','ส่งสนามใหม่ให้ MatchSoccer ตรวจสอบ')
 const admins=db.prepare("SELECT id FROM users WHERE role='admin'").all();admins.forEach(a=>notify(a.id,'venue_review','มีสนามใหม่รอตรวจสอบ',`${req.user.name} ส่งสนาม ${v.name} ให้ตรวจสอบ`))
 res.status(201).json(db.prepare('SELECT * FROM venues WHERE id=?').get(id))
})
app.patch('/api/owner/venues/:id/submit', auth, (req,res)=>{
 if(req.user.role!=='owner') return res.status(403).json({error:'ไม่มีสิทธิ์ส่งคำขอสนาม'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=? AND owner_id=?').get(req.params.id,req.user.id)
 if(!venue) return res.status(404).json({error:'ไม่พบสนามของคุณ'})
 if(!['draft','changes_requested','rejected'].includes(String(venue.review_status))) return res.status(409).json({error:'สนามนี้ยังไม่อยู่ในสถานะที่ส่งตรวจสอบได้'})
 db.prepare("UPDATE venues SET review_status='pending_review',review_note='',submitted_at=CURRENT_TIMESTAMP WHERE id=?").run(venue.id)
 db.prepare("INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)").run(venue.id,req.user.id,'resubmitted','ส่งข้อมูลสนามให้ตรวจสอบอีกครั้ง')
 db.prepare("SELECT id FROM users WHERE role='admin'").all().forEach(a=>notify(a.id,'venue_review','มีสนามรอตรวจสอบ',`${req.user.name} ส่งสนาม ${venue.name} ให้ตรวจสอบอีกครั้ง`))
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(venue.id))
})
app.get('/api/admin/venue-requests', auth, (req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'เฉพาะแอดมินเท่านั้น'})
 const rows=db.prepare("SELECT v.*,u.name owner_name,u.email owner_email FROM venues v JOIN users u ON u.id=v.owner_id WHERE v.review_status<>'approved' ORDER BY CASE v.review_status WHEN 'pending_review' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END,v.submitted_at DESC,v.id DESC").all()
 res.json(rows)
})
app.get('/api/admin/venues/:id/review-history', auth, (req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'เฉพาะแอดมินเท่านั้น'})
 const rows=db.prepare("SELECT vr.*,u.name actor_name FROM venue_reviews vr JOIN users u ON u.id=vr.actor_user_id WHERE vr.venue_id=? ORDER BY vr.id DESC").all(req.params.id)
 res.json(rows)
})
app.patch('/api/admin/venues/:id/review', auth, (req,res)=>{
 if(req.user.role!=='admin') return res.status(403).json({error:'เฉพาะแอดมินเท่านั้น'})
 const action=String(req.body.action||'').trim();const note=String(req.body.note||'').trim()
 if(!['approve','request_changes','reject'].includes(action)) return res.status(400).json({error:'สถานะการตรวจสอบไม่ถูกต้อง'})
 if(action!=='approve'&&!note) return res.status(400).json({error:'กรุณาระบุเหตุผลก่อนส่งข้อความให้เจ้าของสนาม'})
 const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)
 if(!venue) return res.status(404).json({error:'ไม่พบสนาม'})
 const map={approve:'approved',request_changes:'changes_requested',reject:'rejected'};const status=map[action]
 db.prepare('UPDATE venues SET review_status=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?').run(status,note,req.user.id,venue.id)
 audit(req.user.id,'venue.review','venue',venue.id,{decision:action,note:note.slice(0,300)})
 db.prepare('INSERT INTO venue_reviews(venue_id,actor_user_id,action,note) VALUES(?,?,?,?)').run(venue.id,req.user.id,action,note)
 const title=action==='approve'?'สนามได้รับการอนุมัติ':action==='request_changes'?'กรุณาแก้ไขข้อมูลสนาม':'คำขอเพิ่มสนามไม่ผ่านการอนุมัติ'
 const msg=note?`${venue.name}: ${note}`:`${venue.name} พร้อมเปิดให้ลูกค้าจองแล้ว`
 if(venue.owner_id) notify(Number(venue.owner_id),'venue_review',title,msg)
 res.json(db.prepare('SELECT * FROM venues WHERE id=?').get(venue.id))
})

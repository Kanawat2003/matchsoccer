import db from './src/db.js'
import bcrypt from 'bcryptjs'
const email=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase()
const password=String(process.env.ADMIN_PASSWORD||'')
const name=String(process.env.ADMIN_NAME||'PorsBall Admin').trim()
if(!email||!password||password.length<8) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) before running')
const hash=await bcrypt.hash(password,10)
const existing=db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email)
if(existing){
 db.prepare("UPDATE users SET name=?,password_hash=?,role='admin',auth_version=auth_version+1 WHERE id=?").run(name,hash,existing.id)
 console.log('ADMIN_UPDATED')
}else{
 const r=db.prepare("INSERT INTO users(name,email,password_hash,role,auth_version) VALUES(?,?,?,?,0)").run(name,email,hash,'admin')
 console.log('ADMIN_CREATED',r.lastInsertRowid)
}
const row=db.prepare('SELECT id,name,email,role,auth_version FROM users WHERE lower(email)=?').get(email)
console.log(JSON.stringify(row))

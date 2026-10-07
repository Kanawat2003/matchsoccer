import db from './src/db.js'
import jwt from 'jsonwebtoken'

const base='http://127.0.0.1:4001/api'
const SECRET=process.env.JWT_SECRET || 'porsball-local-dev-secret'
const stamp=Date.now()
let host,guest,venueId,b1,b2,m1,m2,billId

const isoDaysFromNow=(days)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+days*86400000))
const tokenFor=(u)=>jwt.sign({id:u.id,role:u.role,ver:Number(u.auth_version||0)},SECRET,{expiresIn:'30m'})

async function req(path,opt={}) {
 const r=await fetch(base+path,{...opt,headers:{'Content-Type':'application/json',...(opt.token?{Authorization:'Bearer '+opt.token}:{})}})
 const t=await r.text()
 let d
 try{d=JSON.parse(t)}catch{throw Error(path+' non-json '+r.status)}
 return {s:r.status,d}
}
async function call(label,path,opt={}) {
 const x=await req(path,opt)
 if(x.s<200||x.s>=300) throw Error(label+' failed '+x.s+' '+JSON.stringify(x.d))
 console.log('PASS',label,x.s)
 return x.d
}
async function expectStatus(label,path,status,opt={}) {
 const x=await req(path,opt)
 if(x.s!==status) throw Error(label+' expected '+status+' got '+x.s+' '+JSON.stringify(x.d))
 console.log('PASS',label,x.s)
 return x.d
}
async function findAvailableSlot(vId,startDay=1,maxDays=14){
 for(let i=startDay;i<=maxDays;i++){
  const date=isoDaysFromNow(i)
  const data=await call('slots '+date,'/venues/'+vId+'/slots?date='+date)
  const slot=data.slots.find(x=>x.available)
  if(slot)return{date,slot}
 }
 throw Error('no available slot for venue '+vId)
}
function pickFixtures(){
 const users=db.prepare("SELECT id,name,email,role,auth_version FROM users WHERE role='player' ORDER BY id DESC LIMIT 20").all()
 if(users.length<2)throw Error('need at least 2 player fixtures')
 host=users[0]; guest=users.find(x=>x.id!==host.id)
 const venue=db.prepare("SELECT id,name,price_per_hour FROM venues WHERE review_status='approved' AND service_status='active' ORDER BY id LIMIT 1").get()
 if(!venue)throw Error('no approved active venue fixture')
 venueId=venue.id
 console.log('FIXTURES',JSON.stringify({host_id:host.id,guest_id:guest.id,venue_id:venue.id}))
}
function cleanup(){
 const matches=[m1?.id,m2?.id].filter(Boolean)
 const bookings=[b1?.id,b2?.id].filter(Boolean)
 const bills=[billId].filter(Boolean)
 const tx=db.transaction(()=>{
  for(const id of matches){
   db.prepare('DELETE FROM match_reminders WHERE match_id=?').run(id)
   db.prepare('DELETE FROM match_attendance WHERE match_id=?').run(id)
   db.prepare('DELETE FROM match_players WHERE match_id=?').run(id)
   db.prepare("DELETE FROM audit_logs WHERE entity_type='match' AND entity_id=?").run(id)
  }
  for(const id of bills){
   db.prepare('DELETE FROM split_bill_members WHERE split_bill_id=?').run(id)
   db.prepare('DELETE FROM split_bills WHERE id=?').run(id)
  }
  for(const id of matches)db.prepare('DELETE FROM matches WHERE id=?').run(id)
  for(const id of bookings){
   db.prepare("DELETE FROM audit_logs WHERE entity_type='booking' AND entity_id=?").run(id)
   db.prepare('DELETE FROM bookings WHERE id=?').run(id)
  }
 })
 tx()
 console.log('CLEANUP PASS')
}

async function main(){
 pickFixtures()
 const H=tokenFor(host),G=tokenFor(guest)

 try{
  const first=await findAvailableSlot(venueId,1,14)
  b1=await call('booking','/bookings',{method:'POST',token:H,body:JSON.stringify({venueId,bookingDate:first.date,startTime:first.slot.start,endTime:first.slot.end,totalPrice:first.slot.price||1200})})
  m1=await call('create match','/matches',{method:'POST',token:H,body:JSON.stringify({bookingId:b1.id,title:'E2E Match '+stamp,fee:120,maxPlayers:2})})
  await call('join guest','/matches/'+m1.id+'/join',{method:'POST',token:G})
  const players=await call('players','/matches/'+m1.id+'/players',{token:G})
  if(players.players.length!==2)throw Error('expected 2 players')

  const bill=await call('create split','/split-bills',{method:'POST',token:H,body:JSON.stringify({bookingId:b1.id,shareCount:2,names:[host.name,guest.name]})})
  billId=bill.id
  const sb=await call('get split','/split-bills/'+billId,{token:H})
  if(sb.members.length!==2)throw Error('expected 2 split members')
  await expectStatus('close split blocks unpaid','/split-bills/'+billId+'/close',409,{method:'POST',token:H})
  for(const member of sb.members)await call('pay '+member.name,'/split-bills/'+billId+'/members/'+member.id+'/pay',{method:'POST',token:H})
  await call('close split','/split-bills/'+billId+'/close',{method:'POST',token:H})
  const myb=await call('bookings excludes closed','/bookings/me',{token:H})
  if(myb.some(x=>x.id===b1.id))throw Error('closed booking still visible')
  const mm=await call('matches excludes closed','/matches')
  if(mm.some(x=>x.id===m1.id))throw Error('closed match still visible')

  const second=await findAvailableSlot(venueId,3,14)
  b2=await call('booking for cancel','/bookings',{method:'POST',token:H,body:JSON.stringify({venueId,bookingDate:second.date,startTime:second.slot.start,endTime:second.slot.end,totalPrice:second.slot.price||1200})})
  m2=await call('create cancel match','/matches',{method:'POST',token:H,body:JSON.stringify({bookingId:b2.id,title:'E2E Cancel '+stamp,fee:90,maxPlayers:2})})
  await call('cancel booking','/bookings/'+b2.id+'/cancel',{method:'POST',token:H})
  const mm2=await call('matches excludes cancelled','/matches')
  if(mm2.some(x=>x.id===m2.id))throw Error('cancelled match still visible')

  console.log('E2E PASS '+first.date+' / '+second.date)
 }finally{
  cleanup()
 }
}
main().catch(e=>{console.error('E2E FAIL',e.stack||e.message);process.exitCode=1})

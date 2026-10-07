import jwt from 'jsonwebtoken'
import db from './src/db.js'

const base='http://127.0.0.1:4001/api'
const secret=process.env.JWT_SECRET || 'porsball-local-dev-secret'
const tokenFor=(u)=>jwt.sign({id:u.id,role:u.role,ver:Number(u.auth_version||0)},secret,{expiresIn:'10m'})
const req=async(p,o={})=>{
  const r=await fetch(base+p,{...o,headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})}})
  const t=await r.text(); let d
  try{d=JSON.parse(t)}catch{throw Error(p+' non-json '+r.status+' '+t.slice(0,120))}
  if(r.status<200||r.status>=300) throw Error(p+' '+r.status+' '+JSON.stringify(d))
  return d
}
const pick=(role,offset=0)=>db.prepare('SELECT id,name,email,role,auth_version FROM users WHERE role=? ORDER BY id DESC LIMIT 1 OFFSET ?').get(role,offset)

function cleanupReliabilityQa(){
  const matches=db.prepare("SELECT id,booking_id FROM matches WHERE title LIKE 'Reliability QA%'").all()
  const tx=db.transaction(()=>{
    for(const m of matches){
      db.prepare('DELETE FROM match_reminders WHERE match_id=?').run(m.id)
      db.prepare('DELETE FROM match_attendance WHERE match_id=?').run(m.id)
      db.prepare('DELETE FROM match_players WHERE match_id=?').run(m.id)
      db.prepare("DELETE FROM audit_logs WHERE entity_type='match' AND entity_id=?").run(m.id)
      db.prepare('DELETE FROM matches WHERE id=?').run(m.id)
      if(m.booking_id){
        db.prepare("DELETE FROM audit_logs WHERE entity_type='booking' AND entity_id=?").run(m.booking_id)
        db.prepare('DELETE FROM bookings WHERE id=?').run(m.booking_id)
      }
    }
  })
  tx()
}

function refreshReliability(userId){
  const row=db.prepare("SELECT SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) attended,SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) no_show FROM match_attendance WHERE user_id=?").get(userId)
  const attended=Number(row.attended||0),cancelled=Number(row.cancelled||0),noShow=Number(row.no_show||0)
  const score=Math.max(0,Math.min(100,100-cancelled*5-noShow*20))
  db.prepare("INSERT INTO user_reliability(user_id,attended_count,cancelled_count,no_show_count,reliability_score,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET attended_count=excluded.attended_count,cancelled_count=excluded.cancelled_count,no_show_count=excluded.no_show_count,reliability_score=excluded.reliability_score,updated_at=CURRENT_TIMESTAMP").run(userId,attended,cancelled,noShow,score)
  return {attended_count:attended,cancelled_count:cancelled,no_show_count:noShow,reliability_score:score}
}

let player,other,venue,booking,match
cleanupReliabilityQa()
try{
  player=pick('player',0)
  other=pick('player',1)
  if(!player||!other) throw Error('need at least two existing player fixtures; no registration is performed by this QA')
  const P=tokenFor(player), G=tokenFor(other)
  const before=await req('/me/reliability',{token:G})
  const dates=[2,3,4,5,6].map(d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+d*86400000)))
  const candidates=db.prepare("SELECT id FROM venues WHERE review_status='approved' AND service_status='active' ORDER BY id DESC").all()

  for(const date of dates){
    for(const c of candidates){
      try{
        const slots=await req('/venues/'+c.id+'/slots?date='+date)
        const slot=slots.slots.find(x=>x.available)
        if(slot){
          venue=c
          booking=await req('/bookings',{method:'POST',token:P,body:JSON.stringify({venueId:venue.id,bookingDate:date,startTime:slot.start,endTime:slot.end,totalPrice:1000})})
          break
        }
      }catch{}
    }
    if(booking) break
  }
  if(!booking) throw Error('no available approved venue slot for reliability QA')

  match=await req('/matches',{method:'POST',token:P,body:JSON.stringify({bookingId:booking.id,title:'Reliability QA '+Date.now(),fee:500,maxPlayers:2})})
  await req('/matches/'+match.id+'/join',{method:'POST',token:G})
  await req('/matches/'+match.id+'/leave',{method:'POST',token:G})

  const after=await req('/me/reliability',{token:G})
  if(Number(after.cancelled_count)!==Number(before.cancelled_count)+1) throw Error('cancelled_count did not increment by 1: '+JSON.stringify({before,after}))
  if(Number(after.reliability_score)!==Math.max(0,Number(before.reliability_score)-5)) throw Error('reliability score did not decrease by 5: '+JSON.stringify({before,after}))

  const matchRel=await req('/matches/'+match.id+'/reliability',{token:P})
  const row=matchRel.players.find(x=>Number(x.user_id)===Number(other.id))
  if(!row||Number(row.cancelled_count)!==Number(after.cancelled_count)||Number(row.reliability_score)!==Number(after.reliability_score)) throw Error('match reliability response stale')

  console.log('RELIABILITY_QA_PASS',JSON.stringify({user_id:other.id,before,after,match_id:match.id}))
}finally{
  cleanupReliabilityQa()
  const restored=refreshReliability(other?.id||979)
  console.log('RELIABILITY_QA_CLEANUP_PASS',JSON.stringify(restored))
}

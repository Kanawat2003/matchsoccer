import db from './src/db.js'
const base='http://127.0.0.1:4001/api'
const stamp=Date.now()
const req=async(p,o={})=>{const r=await fetch(base+p,{...o,headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{throw Error(p+' non-json '+r.status)};if(r.status<200||r.status>=300)throw Error(p+' '+r.status+' '+JSON.stringify(d));return d}
const reg=async(prefix)=>req('/auth/register',{method:'POST',body:JSON.stringify({name:prefix+' '+stamp,email:prefix.toLowerCase().replace(/\s+/g,'')+stamp+'@porsball.test',password:'TestPass123!',phone:'0812345678',address:'QA',birthDate:'2000-01-15'})})
let player,other,owner,field,booking,match
try {
 player=await reg('Rel Player'); other=await reg('Rel Other'); owner=await reg('Rel Owner')
 db.prepare("UPDATE users SET role='owner' WHERE id=?").run(owner.user.id)
 const F=await req('/owner/facilities',{method:'POST',token:owner.token,body:JSON.stringify({name:'Reliability QA',address:'QA Bangkok',phone:'0811111111',description:'QA',image:''})})
 field=await req(`/owner/facilities/${F.id}/fields`,{method:'POST',token:owner.token,body:JSON.stringify({name:'Rel Field',area:'Bangkok',address:'QA',price_per_hour:1000,field_types:'7v7',roof:true,image:''})})
 const admin=await reg('Rel Admin'); db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id)
 await req(`/admin/venues/${field.id}/review`,{method:'PATCH',token:admin.token,body:JSON.stringify({action:'approve',note:''})})
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+2*86400000))
 const slots=await req(`/venues/${field.id}/slots?date=${date}`); const slot=slots.slots.find(x=>x.available)
 booking=await req('/bookings',{method:'POST',token:player.token,body:JSON.stringify({venueId:field.id,bookingDate:date,startTime:slot.start,endTime:slot.end,totalPrice:1000})})
 match=await req('/matches',{method:'POST',token:player.token,body:JSON.stringify({bookingId:booking.id,title:'Reliability QA',fee:500,maxPlayers:2})})
 await req(`/matches/${match.id}/join`,{method:'POST',token:other.token})
 await req(`/matches/${match.id}/leave`,{method:'POST',token:other.token})
 const rel=await req('/me/reliability',{token:other.token})
 if(rel.cancelled_count<1||rel.reliability_score!==95)throw Error('cancelled reliability score failed '+JSON.stringify(rel))
 const matchRel=await req(`/matches/${match.id}/reliability`,{token:player.token})
 if(!matchRel.players.some(x=>x.user_id===other.user.id&&x.cancelled_count>=1&&x.reliability_score===95))throw Error('match reliability response stale')
 console.log('RELIABILITY_QA_PASS',JSON.stringify(rel))
} finally {
 if(booking?.id) db.prepare('UPDATE bookings SET status=\'cancelled\' WHERE id=?').run(booking.id)
}

// reliability QA marker

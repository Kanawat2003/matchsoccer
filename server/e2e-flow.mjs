import db from './src/db.js'
const base='http://127.0.0.1:4001/api'
const stamp=Date.now()
const host={name:`E2E Host ${stamp}`,email:`e2e-host-${stamp}@porsball.test`,password:'TestPass123!',phone:'0812345678',address:'E2E Test Address',birthDate:'2000-01-15'}
const guest={name:`E2E Guest ${stamp}`,email:`e2e-guest-${stamp}@porsball.test`,password:'TestPass123!',phone:'0812345678',address:'E2E Test Address',birthDate:'2000-01-15'}
let H,G
async function req(path,opt={}){const r=await fetch(base+path,{...opt,headers:{'Content-Type':'application/json',...(opt.token?{Authorization:`Bearer ${opt.token}`}:{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{throw Error(`${path} non-json ${r.status}`)};return{s:r.status,d}}
async function call(label,path,opt={}){const x=await req(path,opt);if(x.s<200||x.s>=300)throw Error(`${label} failed ${x.s} ${JSON.stringify(x.d)}`);console.log('PASS',label,x.s);return x.d}
const isoDaysFromNow=(days)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+days*86400000))
async function findAvailableSlot(venueId,startDay=1,maxDays=14){for(let i=startDay;i<=maxDays;i++){const date=isoDaysFromNow(i);const data=await call(`slots ${date}`,`/venues/${venueId}/slots?date=${date}`);const slot=data.slots.find(x=>x.available);if(slot)return{date,slot}}throw Error(`no available slot for venue ${venueId}`)}
async function main(){
 H=await call('register host','/auth/register',{method:'POST',body:JSON.stringify(host)})
 G=await call('register guest','/auth/register',{method:'POST',body:JSON.stringify(guest)})
 const first=await findAvailableSlot(1)
 const date=first.date,slot=first.slot
 const b1=await call('booking','/bookings',{method:'POST',token:H.token,body:JSON.stringify({venueId:1,bookingDate:date,startTime:slot.start,endTime:slot.end,totalPrice:1200})})
 const m=await call('create match','/matches',{method:'POST',token:H.token,body:JSON.stringify({bookingId:b1.id,title:`E2E Match ${stamp}`,fee:120,maxPlayers:2})})
 await call('join guest',`/matches/${m.id}/join`,{method:'POST',token:G.token})
 const p=await call('players',`/matches/${m.id}/players`,{token:G.token})
 if(p.players.length!==2)throw Error('expected 2 players')
 const bill=await call('create split','/split-bills',{method:'POST',token:H.token,body:JSON.stringify({bookingId:b1.id,shareCount:2,names:[host.name,guest.name]})})
 const sb=await call('get split',`/split-bills/${bill.id}`,{token:H.token})
 if(sb.members.length!==2||sb.members[0].name!==host.name||sb.members[1].name!==guest.name)throw Error('split names mismatch')
 for(const member of sb.members)await call(`pay ${member.name}`,`/split-bills/${bill.id}/members/${member.id}/pay`,{method:'POST',token:H.token})
 await call('close split',`/split-bills/${bill.id}/close`,{method:'POST',token:H.token})
 const myb=await call('bookings excludes closed','/bookings/me',{token:H.token})
 if(myb.some(x=>x.id===b1.id))throw Error('closed booking still visible')
 const mm=await call('matches excludes closed','/matches')
 if(mm.some(x=>x.id===m.id))throw Error('closed match still visible')
 const cancelVenue={id:1}; const second=await findAvailableSlot(cancelVenue.id,3)
 const b2=await call('booking for cancel','/bookings',{method:'POST',token:H.token,body:JSON.stringify({venueId:cancelVenue.id,bookingDate:second.date,startTime:second.slot.start,endTime:second.slot.end,totalPrice:1200})})
 const m2=await call('create cancel match','/matches',{method:'POST',token:H.token,body:JSON.stringify({bookingId:b2.id,title:`E2E Cancel ${stamp}`,fee:90,maxPlayers:2})})
 await call('cancel booking',`/bookings/${b2.id}/cancel`,{method:'POST',token:H.token})
 const mm2=await call('matches excludes cancelled','/matches')
 if(mm2.some(x=>x.id===m2.id))throw Error('cancelled match still visible')
 console.log('E2E PASS',date)
}
main().catch(e=>{console.error('E2E FAIL',e.message);process.exitCode=1})

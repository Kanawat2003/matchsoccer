import db from './src/db.js'
const base='http://127.0.0.1:4001/api'
const stamp=Date.now()
const req=async(p,o={})=>{const r=await fetch(base+p,{...o,headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{throw Error(p+' non-json '+r.status)};if(r.status<200||r.status>=300)throw Error(p+' '+r.status+' '+JSON.stringify(d));return d}
const reg=async(n)=>req('/auth/register',{method:'POST',body:JSON.stringify({name:n+' '+stamp,email:n.toLowerCase().replace(/\s+/g,'')+stamp+'@porsball.test',password:'TestPass123!',phone:'0812345678',address:'QA',birthDate:'2000-01-15'})})
let owner,admin,player,F,V,b,m,bill,links
try {
 owner=await reg('QA Owner2'); admin=await reg('QA Admin2'); player=await reg('QA Player2')
 db.prepare("UPDATE users SET role='owner' WHERE id=?").run(owner.user.id); db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id)
 F=await req('/owner/facilities',{method:'POST',token:owner.token,body:JSON.stringify({name:'QA Post Booking',address:'QA Bangkok',phone:'0811111111',description:'QA',image:''})})
 V=await req(`/owner/facilities/${F.id}/fields`,{method:'POST',token:owner.token,body:JSON.stringify({name:'QA Field 2',area:'Bangkok',address:'QA Bangkok',price_per_hour:1200,field_types:'7v7',roof:true,image:''})})
 await req(`/admin/venues/${V.id}/review`,{method:'PATCH',token:admin.token,body:JSON.stringify({action:'approve',note:''})})
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+2*86400000)); const slots=await req(`/venues/${V.id}/slots?date=${date}`); const slot=slots.slots.find(x=>x.available)
 b=await req('/bookings',{method:'POST',token:player.token,body:JSON.stringify({venueId:V.id,bookingDate:date,startTime:slot.start,endTime:slot.end,totalPrice:1200})})
 m=await req('/matches',{method:'POST',token:player.token,body:JSON.stringify({bookingId:b.id,title:'QA Match',fee:600,maxPlayers:2})})
 await req(`/matches/${m.id}/join`,{method:'POST',token:owner.token})
 const p1=await req(`/matches/${m.id}/players`,{token:player.token}); if(p1.players.length!==2)throw Error('join failed')
 await req(`/matches/${m.id}/leave`,{method:'POST',token:owner.token}); await req(`/matches/${m.id}/join`,{method:'POST',token:owner.token})
 await req(`/matches/${m.id}/players/${owner.user.id}`,{method:'DELETE',token:player.token})
 await req(`/matches/${m.id}/join`,{method:'POST',token:owner.token}); await req(`/matches/${m.id}/close`,{method:'POST',token:player.token})
 const playerNotices=await req('/notifications',{token:player.token}); const ownerNotices=await req('/notifications',{token:owner.token}); for(const t of ['join','leave'])if(!playerNotices.some(x=>x.type===t))throw Error('missing player notification '+t); for(const t of ['remove','match_close'])if(!ownerNotices.some(x=>x.type===t))throw Error('missing owner notification '+t)
 bill=await req('/split-bills',{method:'POST',token:player.token,body:JSON.stringify({bookingId:b.id,shareCount:2,names:['เน€เธเนเธฒเธเธญเธเธเธฑเธ”','เธเธนเนเธฃเนเธงเธกเน€เธฅเนเธ']})})
 links=await req(`/split-bills/${bill.id}/share-links`,{method:'POST',token:player.token}); if(links.links.length!==2)throw Error('share links failed')
 try{await req(`/split-bills/${bill.id}/close`,{method:'POST',token:player.token});throw Error('close should be blocked')}catch(e){if(!String(e).includes('409'))throw e}
 await req(`/split-bills/${bill.id}/members/${(await req(`/split-bills/${bill.id}`,{token:player.token})).members[0].id}/pay`,{method:'POST',token:player.token})
 await req(`/split-bills/${bill.id}/members/${(await req(`/split-bills/${bill.id}`,{token:player.token})).members[1].id}/pay`,{method:'POST',token:player.token})
 await req(`/split-bills/${bill.id}/close`,{method:'POST',token:player.token})
 b=await req(`/bookings/${b.id}/cancel`,{method:'POST',token:player.token})
 const after=await req('/venues'); const v=after.find(x=>x.id===V.id); if(v?.id!==V.id)throw Error('venue unexpectedly missing')
 console.log('E2E POST-BOOKING MATCH-SPLIT-CANCEL PASS',JSON.stringify({booking:b.id,match:m.id,bill:bill.id,notifications:['join','leave','remove','match_close']}))
} finally { console.log('POST-BOOKING DATA CREATED; run qa-cleanup.mjs') }



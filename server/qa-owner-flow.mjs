import db from './src/db.js'
const base='http://127.0.0.1:4001/api'
const stamp=Date.now()
const img='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const req=async(p,o={})=>{const r=await fetch(base+p,{...o,headers:{'Content-Type':'application/json',...(o.token?{Authorization:'Bearer '+o.token}:{})}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{throw Error(p+' non-json '+r.status+' '+t.slice(0,500))};if(r.status<200||r.status>=300)throw Error(p+' '+r.status+' '+JSON.stringify(d));return d}
const reg=async(prefix)=>req('/auth/register',{method:'POST',body:JSON.stringify({name:prefix+' '+stamp,email:prefix.toLowerCase().replace(/\s+/g,'')+stamp+'@porsball.test',password:'TestPass123!',phone:'0812345678',address:'Test Address',birthDate:'2000-01-15'})})
let owner,admin,player,F,V,b
try {
 owner=await reg('QA Owner'); admin=await reg('QA Admin'); player=await reg('QA Player')
 db.prepare("UPDATE users SET role='owner' WHERE id=?").run(owner.user.id)
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id)
 F=await req('/owner/facilities',{method:'POST',token:owner.token,body:JSON.stringify({name:'QA Football Center',address:'99 QA Road Bangkok',phone:'0811111111',description:'E2E venue',image:img})})
 V=await req(`/owner/facilities/${F.id}/fields`,{method:'POST',token:owner.token,body:JSON.stringify({name:'QA Field 1',area:'Bangkok',address:'99 QA Road Bangkok',price_per_hour:1000,field_types:'7v7',roof:true,image:img})})
 if(!F.image||!V.image||V.review_status!=='pending_review')throw Error('owner create/image/review state failed')
 const pub0=await req('/venues'); if(pub0.some(x=>x.id===V.id))throw Error('pending field publicly visible')
 const pending=await req('/admin/venue-requests',{token:admin.token}); if(!pending.some(x=>x.id===V.id))throw Error('admin cannot see pending')
 const approved=await req(`/admin/venues/${V.id}/review`,{method:'PATCH',token:admin.token,body:JSON.stringify({action:'approve',note:''})})
 if(approved.review_status!=='approved')throw Error('approval failed')
 const pub=await req('/venues'); const pv=pub.find(x=>x.id===V.id); if(!pv||pv.facility_name!=='QA Football Center')throw Error('approved field not public')
 const detail=await req(`/facilities/${F.id}`); if(detail.fields.length!==1||detail.fields[0].id!==V.id)throw Error('facility fields mismatch')
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+2*86400000))
 const slots=await req(`/venues/${V.id}/slots?date=${date}`); const slot=slots.slots.find(x=>x.available); if(!slot)throw Error('no available slot')
 b=await req('/bookings',{method:'POST',token:player.token,body:JSON.stringify({venueId:V.id,bookingDate:date,startTime:slot.start,endTime:slot.end,totalPrice:1000})})
 const slots2=await req(`/venues/${V.id}/slots?date=${date}`); const same=slots2.slots.find(x=>x.start===slot.start); if(!same||same.available)throw Error('booked slot still available')
 const ownerNotifications=await req('/notifications',{token:owner.token}); const bookingNotice=ownerNotifications.find(x=>x.type==='booking'); if(!bookingNotice)throw Error('owner booking notification missing'); if(/เธ|เน€|�/.test(`${bookingNotice.title}${bookingNotice.message}`))throw Error('owner booking notification garbled')
 console.log('E2E OWNER->ADMIN->USER->BOOKING PASS',JSON.stringify({facility:F.id,venue:V.id,booking:b.id,date,start:slot.start,status:approved.review_status,notification:'pass'}))
} finally {
 console.log('E2E DATA CREATED; run qa-cleanup.mjs after verification')
}

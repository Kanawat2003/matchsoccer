import db from './src/db.js'
const base='http://127.0.0.1:4001/api'
const stamp=Date.now()
const host={name:`Share Host ${stamp}`,email:`share-host-${stamp}@porsball.test`,password:'TestPass123!'}
const guest={name:`Share Guest ${stamp}`,email:`share-guest-${stamp}@porsball.test`,password:'TestPass123!'}
let hostUser,guestUser,bookingId,billId
async function req(path,opt={}){const r=await fetch(base+path,{...opt,headers:{'Content-Type':'application/json',...(opt.token?{Authorization:`Bearer ${opt.token}`}:{})}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{throw Error(`${path} non-json ${r.status}`)};return{s:r.status,d:data}}
async function ok(label,path,opt={}){const x=await req(path,opt);if(x.s<200||x.s>=300)throw Error(`${label} failed ${x.s} ${JSON.stringify(x.d)}`);console.log('PASS',label,x.s);return x.d}
async function expect(label,path,status,opt={}){const x=await req(path,opt);if(x.s!==status)throw Error(`${label} expected ${status}, got ${x.s} ${JSON.stringify(x.d)}`);console.log('PASS',label,x.s);return x.d}
const isoDaysFromNow=days=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(Date.now()+days*86400000))
async function findSlot(venueId){for(let i=1;i<=14;i++){const date=isoDaysFromNow(i);const x=await ok(`slot ${date}`,`/venues/${venueId}/slots?date=${date}`);const slot=x.slots.find(s=>s.available);if(slot)return{date,slot}}throw Error('no available slot')}
async function cleanup(){try{if(billId)db.prepare('DELETE FROM split_bill_members WHERE split_bill_id=?').run(billId);if(billId)db.prepare('DELETE FROM split_bills WHERE id=?').run(billId);if(bookingId)db.prepare('DELETE FROM matches WHERE booking_id=?').run(bookingId);if(bookingId)db.prepare('DELETE FROM bookings WHERE id=?').run(bookingId);for(const u of [hostUser,guestUser])if(u)db.prepare('DELETE FROM users WHERE id=?').run(u.id)}catch(e){console.error('CLEANUP FAIL',e.message)}}
async function main(){
 const h=await ok('register host','/auth/register',{method:'POST',body:JSON.stringify(host)});hostUser=h.user
 const g=await ok('register guest','/auth/register',{method:'POST',body:JSON.stringify(guest)});guestUser=g.user
 const found=await findSlot(1);const b=await ok('create booking','/bookings',{method:'POST',token:h.token,body:JSON.stringify({venueId:1,bookingDate:found.date,startTime:found.slot.start,endTime:found.slot.end,totalPrice:1200})});bookingId=b.id
 const bill=await ok('create split bill','/split-bills',{method:'POST',token:h.token,body:JSON.stringify({bookingId,shareCount:2,names:[host.name,guest.name]})});billId=bill.id
 const links=await ok('generate member links',`/split-bills/${billId}/share-links`,{method:'POST',token:h.token})
 if(links.links.length!==2||!links.links.every(x=>/^[a-f0-9]{48}$/.test(x.token)))throw Error('invalid member token format')
 const guestLink=links.links.find(x=>x.name===guest.name);if(!guestLink)throw Error('guest link missing')
 const view=await ok('guest opens own link',`/split-bills/share/${guestLink.token}`)
 if(view.member_id!==guestLink.memberId||view.name!==guest.name)throw Error('guest link resolved wrong member')
 await ok('guest confirms payment',`/split-bills/share/${guestLink.token}/pay`,{method:'POST'})
 await expect('duplicate guest payment rejected',`/split-bills/share/${guestLink.token}/pay`,409,{method:'POST'})
 const hostLink=links.links.find(x=>x.name===host.name);await ok('host opens own link',`/split-bills/share/${hostLink.token}`)
 await ok('host confirms payment',`/split-bills/share/${hostLink.token}/pay`,{method:'POST'})
 await ok('close fully paid bill',`/split-bills/${billId}/close`,{method:'POST',token:h.token})
 await expect('closed guest link rejected',`/split-bills/share/${guestLink.token}`,404)
 await expect('malformed share token rejected','/split-bills/share/not-a-token',400)
 console.log('SHARE LINKS PASS')
}
main().catch(e=>{console.error('SHARE LINKS FAIL',e.message);process.exitCode=1}).finally(cleanup)

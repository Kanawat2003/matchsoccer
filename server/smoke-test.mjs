const base = 'http://127.0.0.1:4001/api'
const results = []
async function check(name, fn){
 try{const r=await fn();results.push({name,ok:true,status:r.status});console.log(`PASS ${name} [${r.status}]`)}
 catch(e){results.push({name,ok:false,error:String(e)});console.log(`FAIL ${name}: ${e}`)}
}
async function raw(path, options={}){const r=await fetch(base+path,options);const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{};return {status:r.status,ok:r.ok,body}}
await check('venues public',async()=>{const r=await raw('/venues');if(!r.ok||!Array.isArray(r.body))throw Error('invalid venues response');return r})
await check('slots valid date',async()=>{const r=await raw('/venues/1/slots?date=2026-09-04');if(!r.ok||!Array.isArray(r.body.slots))throw Error('invalid slots response');return r})
await check('slots rejects invalid date',async()=>{const r=await raw('/venues/1/slots?date=bad-date');if(r.status!==400)throw Error(`expected 400, got ${r.status}`);return r})
await check('admin users protected',async()=>{const r=await raw('/admin/users');if(r.status!==401)throw Error(`expected 401, got ${r.status}`);return r})
await check('owner venues protected',async()=>{const r=await raw('/owner/venues');if(r.status!==401)throw Error(`expected 401, got ${r.status}`);return r})
await check('my bookings protected',async()=>{const r=await raw('/bookings/me');if(r.status!==401)throw Error(`expected 401, got ${r.status}`);return r})
await check('matches protected',async()=>{const r=await raw('/matches/me');if(r.status!==401)throw Error(`expected 401, got ${r.status}`);return r})
await check('split bill protected',async()=>{const r=await raw('/split-bills/1');if(r.status!==401)throw Error(`expected 401, got ${r.status}`);return r})
const failed=results.filter(x=>!x.ok)
console.log(`\nSmoke test: ${results.length-failed.length}/${results.length} passed`)
if(failed.length)process.exitCode=1

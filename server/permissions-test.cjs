const jwt=require('jsonwebtoken')
const base='http://127.0.0.1:4001/api'
const secret='porsball-local-dev-secret'
const token=id=>jwt.sign({id},secret,{expiresIn:'10m'})
const T={admin:token(15),owner14:token(14),owner4:token(4),player:token(1)}
async function req(path,opt={}){const r=await fetch(base+path,{...opt,headers:{'Content-Type':'application/json',...(opt.token?{Authorization:`Bearer ${opt.token}`}:{})}});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null}return{status:r.status,body}}
async function expect(name,fn,status){const r=await fn();if(r.status!==status)throw Error(`${name}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);console.log(`PASS ${name} [${r.status}]`);return r.body}
async function main(){
 await expect('player cannot assign venue',()=>req('/admin/venues/3/owner',{method:'PATCH',token:T.player,body:JSON.stringify({ownerId:14})}),403)
 await expect('admin rejects player as owner',()=>req('/admin/venues/3/owner',{method:'PATCH',token:T.admin,body:JSON.stringify({ownerId:1})}),400)
 const assigned=await expect('admin assigns venue 3 to owner 14',()=>req('/admin/venues/3/owner',{method:'PATCH',token:T.admin,body:JSON.stringify({ownerId:14})}),200)
 if(assigned.owner_id!==14)throw Error('assignment did not persist')
 const own=await expect('owner 14 can edit owned venue',()=>req('/owner/venues/3',{method:'PATCH',token:T.owner14,body:JSON.stringify({name:assigned.name,area:assigned.area,address:assigned.address,price_per_hour:assigned.price_per_hour,roof:assigned.roof,field_types:assigned.field_types})}),200)
 if(own.owner_id!==14)throw Error('owner edit changed ownership')
 await expect('owner 4 cannot edit venue 1',()=>req('/owner/venues/1',{method:'PATCH',token:T.owner4,body:JSON.stringify({name:'blocked',area:'blocked',address:'blocked',price_per_hour:1,roof:0,field_types:'5v5'})}),403)
 await expect('player cannot edit venue',()=>req('/owner/venues/1',{method:'PATCH',token:T.player,body:JSON.stringify({name:'blocked',area:'blocked',address:'blocked',price_per_hour:1,roof:0,field_types:'5v5'})}),403)
 const adminVenue=await expect('admin can edit venue',()=>req('/owner/venues/1',{method:'PATCH',token:T.admin,body:JSON.stringify({name:'Goal Arena Rama 9',area:'พระราม 9 • 2.3 กม.',address:'ถ.พระราม 9 กรุงเทพฯ',price_per_hour:1200,roof:1,field_types:'5v5,7v7'})}),200)
 if(adminVenue.owner_id!==14)throw Error('admin edit changed venue ownership')
 await expect('admin cannot demote self',()=>req('/admin/users/15/role',{method:'PATCH',token:T.admin,body:JSON.stringify({role:'owner'})}),409)
 const restored=await expect('admin restores venue 3 owner',()=>req('/admin/venues/3/owner',{method:'PATCH',token:T.admin,body:JSON.stringify({ownerId:4})}),200)
 if(restored.owner_id!==4)throw Error('venue 3 owner was not restored to 4')
 const v1=await expect('owner 14 sees assigned venues',()=>req('/owner/venues',{token:T.owner14}),200)
 if(!v1.some(v=>v.id===1)||!v1.some(v=>v.id===2))throw Error('owner 14 lost existing venues')
 if(v1.some(v=>v.id===3))throw Error('venue 3 still assigned after restore')
 console.log('PERMISSIONS PASS')
}
main().catch(e=>{console.error('PERMISSIONS FAIL',e.message);process.exitCode=1})

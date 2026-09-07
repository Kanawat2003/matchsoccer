import jwt from 'jsonwebtoken'
const base='http://127.0.0.1:4001/api'
const secret='porsball-local-dev-secret'
const token=(id,role)=>jwt.sign({id,role},secret,{expiresIn:'10m'})
const cases=[
 {name:'player',id:1,expect:{'/admin/users':403,'/owner/venues':403,'/owner/bookings':403}},
 {name:'owner',id:14,expect:{'/admin/users':403,'/owner/venues':200,'/owner/bookings':200}},
 {name:'admin',id:15,expect:{'/admin/users':200,'/owner/venues':200,'/owner/bookings':200}}
]
for(const c of cases){
 const t=token(c.id,c.name)
 for(const [path,want] of Object.entries(c.expect)){const r=await fetch(base+path,{headers:{Authorization:`Bearer ${t}`}});console.log(`${c.name} ${path} ${r.status} ${r.status===want?'PASS':'FAIL expected '+want}`)}
}
const admin=token(15,'admin')
let r=await fetch(base+'/admin/venues/1/owner',{method:'PATCH',headers:{Authorization:`Bearer ${admin}`,'Content-Type':'application/json'},body:JSON.stringify({ownerId:1})})
console.log('invalid venue owner 400',r.status,r.status===400?'PASS':'FAIL')
r=await fetch(base+'/admin/users/14/role',{method:'PATCH',headers:{Authorization:`Bearer ${admin}`,'Content-Type':'application/json'},body:JSON.stringify({role:'player'})})
console.log('demote owner with venue 409',r.status,r.status===409?'PASS':'FAIL')

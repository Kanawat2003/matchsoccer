import jwt from 'jsonwebtoken'
const token=jwt.sign({id:4,role:'player'},'porsball-local-dev-secret',{expiresIn:'10m'})
const r=await fetch('http://127.0.0.1:4001/api/matches',{headers:{Authorization:`Bearer ${token}`}})
console.log('MATCHES',r.status,await r.text())
const body={bookingId:13,title:'QA duplicate check',fee:90,maxPlayers:10}
const x=await fetch('http://127.0.0.1:4001/api/matches',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
console.log('DUPLICATE_CREATE',x.status,await x.text())

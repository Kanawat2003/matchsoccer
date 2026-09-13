const jwt=require('jsonwebtoken')
const base='http://127.0.0.1:4001/api'
const secret='porsball-local-dev-secret'
async function main(){
 const db=(await import('./src/db.js')).default; const admin=db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id DESC LIMIT 1").get(); const owner=db.prepare("SELECT id FROM users WHERE role='owner' ORDER BY id DESC LIMIT 1").get(); const player=db.prepare("SELECT id FROM users WHERE role='player' ORDER BY id DESC LIMIT 1").get(); const venue=db.prepare('SELECT id,owner_id,name,area,address,price_per_hour,roof,field_types FROM venues ORDER BY id LIMIT 1').get();
 if(!admin||!owner||!player||!venue)throw Error('missing fixtures');
 const T={admin:jwt.sign({id:admin.id},secret,{expiresIn:'10m'}),owner:jwt.sign({id:owner.id},secret,{expiresIn:'10m'}),player:jwt.sign({id:player.id},secret,{expiresIn:'10m'})};
 const req=async(path,opt={})=>{const r=await fetch(base+path,{...opt,headers:{'Content-Type':'application/json',...(opt.token?{Authorization:'Bearer '+opt.token}:{})}});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null}return{status:r.status,body}};
 const expect=async(name,fn,status)=>{const r=await fn();if(r.status!==status)throw Error(name+': expected '+status+', got '+r.status+' '+JSON.stringify(r.body));console.log('PASS '+name+' ['+r.status+']');return r.body};
 const originalOwner=venue.owner_id; try{
 await expect('player cannot assign venue',()=>req('/admin/venues/'+venue.id+'/owner',{method:'PATCH',token:T.player,body:JSON.stringify({ownerId:owner.id})}),403);
 await expect('admin rejects player as owner',()=>req('/admin/venues/'+venue.id+'/owner',{method:'PATCH',token:T.admin,body:JSON.stringify({ownerId:player.id})}),400);
 const assigned=await expect('admin assigns venue to owner',()=>req('/admin/venues/'+venue.id+'/owner',{method:'PATCH',token:T.admin,body:JSON.stringify({ownerId:owner.id})}),200); if(assigned.owner_id!==owner.id)throw Error('assignment did not persist');
 const own=await expect('owner can edit owned venue',()=>req('/owner/venues/'+venue.id,{method:'PATCH',token:T.owner,body:JSON.stringify({name:venue.name,area:venue.area,address:venue.address,price_per_hour:venue.price_per_hour,roof:venue.roof,field_types:venue.field_types})}),200); if(own.owner_id!==owner.id)throw Error('owner edit changed ownership');
 await expect('player cannot edit venue',()=>req('/owner/venues/'+venue.id,{method:'PATCH',token:T.player,body:JSON.stringify({name:'blocked',area:'blocked',address:'blocked',price_per_hour:1,roof:0,field_types:'5v5'})}),403);
 const av=await expect('admin can edit venue',()=>req('/owner/venues/'+venue.id,{method:'PATCH',token:T.admin,body:JSON.stringify({name:venue.name,area:venue.area,address:venue.address,price_per_hour:venue.price_per_hour,roof:venue.roof,field_types:venue.field_types})}),200); if(av.owner_id!==owner.id)throw Error('admin edit changed ownership');
 await expect('admin cannot demote self',()=>req('/admin/users/'+admin.id+'/role',{method:'PATCH',token:T.admin,body:JSON.stringify({role:'owner'})}),409);
 console.log('PERMISSIONS PASS'); } finally {db.prepare('UPDATE venues SET owner_id=? WHERE id=?').run(originalOwner,venue.id)}
}
main().catch(e=>{console.error('PERMISSIONS FAIL',e.message);process.exitCode=1})

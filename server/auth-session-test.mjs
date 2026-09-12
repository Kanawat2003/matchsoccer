const base='http://127.0.0.1:4001/api'
const email=`auth_session_${Date.now()}@test.local`
const post=async(path,body,token)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});const j=await r.json();return {status:r.status,j}}
const getMe=async(token)=>{const r=await fetch(base+'/me',{headers:{Authorization:`Bearer ${token}`}});return {status:r.status,j:await r.json()}}
const reg=await post('/auth/register',{name:'Session Audit',email,password:'OldPass123!',phone:'0812345678',address:'QA',birthDate:'2000-01-15'})
if(reg.status!==201)throw new Error('register failed')
const oldToken=reg.j.token
if((await getMe(oldToken)).status!==200)throw new Error('old token should work before reset')
const forgot=await post('/auth/forgot-password',{email})
if(!forgot.j.devCode)throw new Error('dev OTP unavailable')
const reset=await post('/auth/reset-password',{email,code:forgot.j.devCode,newPassword:'NewPass123!'})
if(reset.status!==200)throw new Error('reset failed')
const oldAfter=await getMe(oldToken)
if(oldAfter.status!==401)throw new Error(`old token still valid: ${oldAfter.status}`)
const login=await post('/auth/login',{email,password:'NewPass123!'})
if(login.status!==200)throw new Error('new password login failed')
if((await getMe(login.j.token)).status!==200)throw new Error('new token invalid')
console.log('AUTH SESSION PASS')

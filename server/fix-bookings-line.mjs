import fs from 'node:fs'
const p='C:/porsball/server/src/index.js'
let s=fs.readFileSync(p,'utf8')
const a=s.indexOf("app.get('/api/bookings/me'")
const b=s.indexOf("\napp.get('/api/matches'",a)
const line="app.get('/api/bookings/me', auth, (req,res) => res.json(db.prepare(\"SELECT b.*,v.name venue_name FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.user_id=? AND NOT EXISTS (SELECT 1 FROM split_bills sb WHERE sb.booking_id=b.id AND sb.status='closed') ORDER BY b.booking_date DESC,b.start_time DESC\").all(req.user.id)))"
if(a<0||b<0) throw new Error('booking route not found')
s=s.slice(0,a)+line+s.slice(b)
fs.writeFileSync(p,s,'utf8')
console.log('BOOKINGS_ROUTE_FIXED')

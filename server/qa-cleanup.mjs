import db from './src/db.js'
const users=db.prepare("SELECT id FROM users WHERE id>=471 AND email LIKE 'qa%porsball.test'").all().map(x=>x.id)
const venues=db.prepare("SELECT id FROM venues WHERE owner_id IN (SELECT id FROM users WHERE id>=471)").all().map(x=>x.id)
for(const v of venues){
 const bookings=db.prepare('SELECT id FROM bookings WHERE venue_id=?').all(v).map(x=>x.id)
 for(const b of bookings){db.prepare('DELETE FROM split_bill_members WHERE split_bill_id IN (SELECT id FROM split_bills WHERE booking_id=?)').run(b);db.prepare('DELETE FROM split_bills WHERE booking_id=?').run(b);db.prepare('DELETE FROM matches WHERE booking_id=?').run(b);db.prepare('DELETE FROM bookings WHERE id=?').run(b)}
 db.prepare('DELETE FROM venue_reviews WHERE venue_id=?').run(v)
 db.prepare('DELETE FROM venues WHERE id=?').run(v)
}
for(const f of db.prepare("SELECT id FROM facilities WHERE owner_id IN (SELECT id FROM users WHERE id>=471)").all().map(x=>x.id))db.prepare('DELETE FROM facilities WHERE id=?').run(f)
for(const id of users){db.prepare('DELETE FROM notifications WHERE user_id=?').run(id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(id);db.prepare('DELETE FROM match_players WHERE user_id=?').run(id);db.prepare('DELETE FROM reviews WHERE user_id=?').run(id);db.prepare('DELETE FROM users WHERE id=?').run(id)}
console.log('QA CLEANUP PASS')

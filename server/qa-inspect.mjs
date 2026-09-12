import db from './src/db.js'
console.log('qa users',db.prepare("SELECT id,name,email,role FROM users WHERE email LIKE 'qa%porsball.test'").all())
console.log('qa venues',db.prepare("SELECT id,name,owner_id,facility_id,review_status FROM venues WHERE name LIKE 'QA %'").all())
console.log('qa facilities',db.prepare("SELECT id,name,owner_id FROM facilities WHERE name LIKE 'QA %'").all())

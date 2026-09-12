import db from './src/db.js'
const rows=db.prepare("SELECT id,name,email,role,created_at FROM users WHERE lower(name) LIKE '%admin%' OR lower(email) LIKE '%admin%' OR role='admin' ORDER BY id").all()
console.log(JSON.stringify(rows,null,2))

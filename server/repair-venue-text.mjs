import db from './src/db.js'
const rows=db.prepare('SELECT id,name,area,address FROM venues ORDER BY id').all()
console.log(JSON.stringify(rows,null,2))
const fixes={
  1:{area:'พระราม 9 • 2.3 กม.',address:'ถ.พระราม 9 กรุงเทพฯ'},
  2:{area:'ลาดพร้าว • 4.1 กม.',address:'ลาดพร้าว กรุงเทพฯ'},
  3:{area:'รัชดา • 6.3 กม.',address:'รัชดา กรุงเทพฯ'}
}
const update=db.prepare('UPDATE venues SET area=?, address=? WHERE id=?')
for(const r of rows){const f=fixes[r.id];if(f) update.run(f.area,f.address,r.id)}
console.log(JSON.stringify(db.prepare('SELECT id,name,area,address FROM venues ORDER BY id').all(),null,2))
db.close()





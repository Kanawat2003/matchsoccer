import db from './src/db.js'
console.log('USERS',db.prepare('select id,name,email from users').all())
console.log('BOOKINGS',db.prepare('select id,user_id,venue_id,booking_date,start_time,end_time,status from bookings order by id desc limit 10').all())
console.log('MATCHES',db.prepare('select id,creator_id,booking_id,title,match_date,start_time,max_players,open_for_join from matches order by id desc limit 10').all())
console.log('PLAYERS',db.prepare('select * from match_players order by joined_at desc limit 20').all())

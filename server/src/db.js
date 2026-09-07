import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const file = 'C:/porsball/server/data/porsball.db'
mkdirSync(dirname(file), { recursive: true })
const db = new Database(file)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'player', points INTEGER NOT NULL DEFAULT 0,
 wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 auth_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS venues (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, area TEXT NOT NULL,
 address TEXT NOT NULL, rating REAL NOT NULL DEFAULT 0, price_per_hour INTEGER NOT NULL,
 roof INTEGER NOT NULL DEFAULT 0, field_types TEXT NOT NULL DEFAULT '5v5,7v7',
 owner_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, venue_id INTEGER NOT NULL REFERENCES venues(id),
 user_id INTEGER NOT NULL REFERENCES users(id), booking_date TEXT NOT NULL,
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, total_price INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(venue_id, booking_date, start_time)
);
CREATE TABLE IF NOT EXISTS matches (
 id INTEGER PRIMARY KEY AUTOINCREMENT, creator_id INTEGER NOT NULL REFERENCES users(id),
 venue_id INTEGER NOT NULL REFERENCES venues(id), title TEXT NOT NULL, match_date TEXT NOT NULL,
 start_time TEXT NOT NULL, fee INTEGER NOT NULL, max_players INTEGER NOT NULL,
 booking_id INTEGER REFERENCES bookings(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS match_players (
 match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id), joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(match_id,user_id)
);
CREATE TABLE IF NOT EXISTS password_resets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT, venue_id INTEGER NOT NULL REFERENCES venues(id),
 user_id INTEGER NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`)
try { db.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE matches ADD COLUMN booking_id INTEGER REFERENCES bookings(id)') } catch {}
try { db.exec('ALTER TABLE matches ADD COLUMN open_for_join INTEGER NOT NULL DEFAULT 0') } catch {}

const count = db.prepare('SELECT COUNT(*) AS n FROM venues').get().n
if (!count) {
 const add = db.prepare('INSERT INTO venues (name,area,address,rating,price_per_hour,roof,field_types) VALUES (?,?,?,?,?,?,?)')
 add.run('Goal Arena Rama 9','\\u0e1e\\u0e23\\u0e30\\u0e23\\u0e32\\u0e21 9 \\u00b7 2.3 \\u0e01\\u0e21.','\\u0e16\\u0e19\\u0e19\\u0e1e\\u0e23\\u0e30\\u0e23\\u0e32\\u0e21 9 \\u0e01\\u0e23\\u0e38\\u0e07\\u0e40\\u0e17\\u0e1e\\u0e2f',4.8,1200,1,'5v5,7v7')
 add.run('SoccerPro Ladprao','\\u0e25\\u0e32\\u0e14\\u0e1e\\u0e23\\u0e49\\u0e32\\u0e27 \\u00b7 4.1 \\u0e01\\u0e21.','\\u0e25\\u0e32\\u0e14\\u0e1e\\u0e23\\u0e49\\u0e32\\u0e27 \\u0e01\\u0e23\\u0e38\\u0e07\\u0e40\\u0e17\\u0e1e\\u0e2f',4.6,900,1,'5v5,7v7')
 add.run('Kick Off Stadium','\\u0e23\\u0e31\\u0e0a\\u0e14\\u0e32 \\u00b7 6.3 \\u0e01\\u0e21.','\\u0e23\\u0e31\\u0e0a\\u0e14\\u0e32 \\u0e01\\u0e23\\u0e38\\u0e07\\u0e40\\u0e17\\u0e1e\\u0e2f',4.7,1000,0,'5v5,7v7,11v11')
}
try { db.exec(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`) } catch {}

export default db

// Split-bill tables
try {
 db.exec(`
 CREATE TABLE IF NOT EXISTS split_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  total_amount INTEGER NOT NULL,
  share_count INTEGER NOT NULL,
  share_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS split_bill_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  split_bill_id INTEGER NOT NULL REFERENCES split_bills(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  member_token_hash TEXT
 );
 `)
} catch (error) {
 console.error('split bill migration failed', error)
}
try { db.exec('ALTER TABLE split_bill_members ADD COLUMN amount INTEGER NOT NULL DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE split_bill_members ADD COLUMN member_token_hash TEXT') } catch {}
try { db.exec('UPDATE split_bill_members SET amount=(SELECT share_amount FROM split_bills WHERE split_bills.id=split_bill_members.split_bill_id) WHERE amount=0') } catch {}

// Query-performance indexes
try { db.exec(`
 CREATE INDEX IF NOT EXISTS idx_bookings_user_status_date ON bookings(user_id,status,booking_date,start_time);
 CREATE INDEX IF NOT EXISTS idx_bookings_venue_date_start ON bookings(venue_id,booking_date,start_time);
 CREATE INDEX IF NOT EXISTS idx_matches_creator_date ON matches(creator_id,match_date,start_time);
 CREATE INDEX IF NOT EXISTS idx_matches_booking ON matches(booking_id);
 CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
 CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id,read,created_at);
 CREATE INDEX IF NOT EXISTS idx_password_resets_user_used_created ON password_resets(user_id,used,created_at);
 CREATE INDEX IF NOT EXISTS idx_split_bills_booking_status ON split_bills(booking_id,status);
 CREATE INDEX IF NOT EXISTS idx_split_bill_members_bill_paid ON split_bill_members(split_bill_id,paid);
 `) } catch (error) { console.error('index migration failed', error) }

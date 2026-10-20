import db from './src/db.js'
import jwt from 'jsonwebtoken'

const base = 'http://127.0.0.1:4001/api'
const secret = process.env.JWT_SECRET || 'porsball-local-dev-secret'
const stamp = Date.now()
const host = db.prepare("SELECT id,name,role,auth_version,points,wins,losses FROM users WHERE role='player' ORDER BY id DESC LIMIT 1").get()
const guest = db.prepare("SELECT id,name,role,auth_version,points,wins,losses FROM users WHERE role='player' AND id<>? ORDER BY id DESC LIMIT 1").get(host?.id)
if (!host || !guest) throw new Error('Need two player fixtures')
const initial = new Map([host, guest].map(u => [u.id, { points: u.points, wins: u.wins, losses: u.losses }]))
const token = u => jwt.sign({ id: u.id, role: u.role, ver: Number(u.auth_version || 0) }, secret, { expiresIn: '10m' })
async function req(path, opt = {}) {
  const r = await fetch(base + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.token ? { Authorization: 'Bearer ' + opt.token } : {}) } })
  let d; try { d = await r.json() } catch { d = {} }
  return { status: r.status, data: d }
}
function check(ok, message) { if (!ok) throw new Error(message); console.log('PASS', message) }
async function scenario(label, a, b, expected, points) {
  let teamId, bookingId, matchId
  const tx = db.transaction(() => {
    teamId = Number(db.prepare('INSERT INTO teams(owner_id,name) VALUES(?,?)').run(host.id, 'Outcome E2E ' + label + ' ' + stamp).lastInsertRowid)
    for (const u of [host, guest]) db.prepare('INSERT INTO team_members(team_id,user_id) VALUES(?,?)').run(teamId, u.id)
    bookingId = Number(db.prepare("INSERT INTO bookings(venue_id,user_id,booking_date,start_time,end_time,total_price,status) VALUES(1,?,'2020-01-01','10:00','11:00',1200,'confirmed')").run(host.id).lastInsertRowid)
    matchId = Number(db.prepare("INSERT INTO matches(creator_id,venue_id,title,match_date,start_time,end_time,fee,max_players,booking_id,open_for_join,team_id) VALUES(?,1,?,'2020-01-01','10:00','11:00',100,2,?,1,?)").run(host.id, 'Outcome E2E ' + label + ' ' + stamp, bookingId, teamId).lastInsertRowid)
    for (const u of [host, guest]) {
      db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(matchId, u.id)
      db.prepare("INSERT INTO match_attendance(match_id,user_id,status,checked_in_at) VALUES(?,?,'attended',CURRENT_TIMESTAMP)").run(matchId, u.id)
    }
  })
  try {
    tx()
    const r = await req('/matches/' + matchId + '/result', { method: 'POST', token: token(host), body: JSON.stringify({ teamAScore: a, teamBScore: b, opponentName: 'Outcome Test' }) })
    check(r.status === 201 && r.data.outcome === expected && r.data.points_per_player === points, label + ' result and points')
    const winDelta = expected === 'win' ? 1 : 0
    const lossDelta = expected === 'loss' ? 1 : 0
    for (const u of [host, guest]) {
      const now = db.prepare('SELECT points,wins,losses FROM users WHERE id=?').get(u.id)
      const before = initial.get(u.id)
      check(now.points === before.points + points && now.wins === before.wins + winDelta && now.losses === before.losses + lossDelta, label + ' stats for user ' + u.id)
      check(db.prepare('SELECT COUNT(*) n FROM point_events WHERE user_id=? AND event_key=?').get(u.id, 'match_result:' + matchId + ':' + expected).n === 1, label + ' one point event for user ' + u.id)
    }
  } finally {
    if (matchId) {
      const clean = db.transaction(() => {
        for (const u of [host, guest]) {
          const before = initial.get(u.id)
          db.prepare('UPDATE users SET points=?,wins=?,losses=? WHERE id=?').run(before.points, before.wins, before.losses, u.id)
          db.prepare('DELETE FROM point_events WHERE user_id=? AND event_key LIKE ?').run(u.id, 'match_result:' + matchId + ':%')
          db.prepare('DELETE FROM point_events WHERE user_id=? AND event_key=?').run(u.id, 'match_attended:' + matchId)
        }
        db.prepare("DELETE FROM audit_logs WHERE entity_type='match_result' AND entity_id IN (SELECT id FROM match_results WHERE match_id=?)").run(matchId)
        db.prepare('DELETE FROM match_attendance WHERE match_id=?').run(matchId)
        db.prepare('DELETE FROM match_players WHERE match_id=?').run(matchId)
        db.prepare('DELETE FROM match_results WHERE match_id=?').run(matchId)
        db.prepare('DELETE FROM matches WHERE id=?').run(matchId)
        db.prepare('DELETE FROM bookings WHERE id=?').run(bookingId)
        db.prepare('DELETE FROM team_members WHERE team_id=?').run(teamId)
        db.prepare('DELETE FROM teams WHERE id=?').run(teamId)
      })
      clean()
      console.log('CLEANUP PASS', label)
    }
  }
}
try {
  await scenario('WIN', 2, 1, 'win', 20)
  await scenario('DRAW', 1, 1, 'draw', 10)
  await scenario('LOSS', 0, 3, 'loss', 5)
  console.log('MATCH RESULT OUTCOMES E2E PASS')
} catch (e) {
  console.error('MATCH RESULT OUTCOMES E2E FAIL', e.stack || e.message)
  process.exitCode = 1
}

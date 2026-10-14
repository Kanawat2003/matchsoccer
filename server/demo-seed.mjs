/**
 * Local-only demo fixture for MatchSoccer.
 *
 * This script is intentionally opt-in. It never calls the production API.
 * Run only against the local SQLite database after setting:
 *   MATCHSOCCER_DEMO_SEED=LOCAL_ONLY
 *   DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD
 *   DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD
 *   DEMO_PLAYER_EMAIL, DEMO_PLAYER_PASSWORD
 *
 * PowerShell example:
 *   $env:MATCHSOCCER_DEMO_SEED='LOCAL_ONLY'
 *   $env:DEMO_ADMIN_EMAIL='demo-admin@example.test'
 *   $env:DEMO_ADMIN_PASSWORD='use-a-unique-long-local-password'
 *   $env:DEMO_OWNER_EMAIL='demo-owner@example.test'
 *   $env:DEMO_OWNER_PASSWORD='use-a-unique-long-local-password'
 *   $env:DEMO_PLAYER_EMAIL='demo-player@example.test'
 *   $env:DEMO_PLAYER_PASSWORD='use-a-unique-long-local-password'
 *   node .\demo-seed.mjs
 *
 * Use .test addresses and unique passwords. Do not reuse production credentials.
 */
if (process.env.NODE_ENV === 'production' || process.env.MATCHSOCCER_DEMO_SEED !== 'LOCAL_ONLY') {
  throw new Error('Refusing to run: this script requires MATCHSOCCER_DEMO_SEED=LOCAL_ONLY and non-production NODE_ENV.')
}

const roles = [
  { key: 'ADMIN', role: 'admin', name: 'Demo Admin' },
  { key: 'OWNER', role: 'owner', name: 'Demo Owner' },
  { key: 'PLAYER', role: 'player', name: 'Demo Player' },
]
const accounts = roles.map((r) => ({
  ...r,
  email: String(process.env[`DEMO_${r.key}_EMAIL`] || '').trim().toLowerCase(),
  password: String(process.env[`DEMO_${r.key}_PASSWORD`] || ''),
}))
for (const a of accounts) {
  if (!a.email.endsWith('.test') || !a.email.includes('@')) throw new Error(`Set DEMO_${a.key}_EMAIL to a reserved .test address.`)
  if (a.password.length < 12) throw new Error(`DEMO_${a.key}_PASSWORD must be at least 12 characters.`)
}
if (new Set(accounts.map(a => a.email)).size !== accounts.length) throw new Error('Each demo role must use a different email.')

const [{ default: db }, { default: bcrypt }] = await Promise.all([
  import('./src/db.js'),
  import('bcryptjs'),
])
const exists = db.prepare('SELECT id,email,role FROM users WHERE lower(email)=?')
for (const a of accounts) {
  const row = exists.get(a.email)
  if (row) throw new Error(`Email ${a.email} already exists; no changes made. Choose a fresh .test address.`)
}
const facilityName = 'MatchSoccer Demo Arena'
const existingFacility = db.prepare('SELECT id FROM facilities WHERE name=?').get(facilityName)
const tx = db.transaction(() => {
  const userIds = {}
  for (const a of accounts) {
    if (exists.get(a.email)) throw new Error(`Email ${a.email} appeared during setup; transaction aborted without reusing an account.`)
    const hash = bcrypt.hashSync(a.password, 12)
    const result = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
      .run(a.name, a.email, hash, a.role)
    userIds[a.key] = Number(result.lastInsertRowid)
  }
  let facilityId = existingFacility?.id
  if (!facilityId) {
    facilityId = Number(db.prepare('INSERT INTO facilities(owner_id,name,address,phone,description) VALUES(?,?,?,?,?)')
      .run(userIds.OWNER, facilityName, 'Demo address, Bangkok', '', 'Local-only demonstration facility').lastInsertRowid)
  } else {
    const f = db.prepare('SELECT owner_id FROM facilities WHERE id=?').get(facilityId)
    if (Number(f.owner_id) !== userIds.OWNER) throw new Error('Demo facility already belongs to a different account; no changes made.')
  }
  const addVenue = db.prepare("INSERT INTO venues(name,area,address,rating,price_per_hour,roof,field_types,owner_id,review_status,service_status,facility_id) VALUES(?,?,?,?,?,?,?,?, 'approved','active',?)")
  for (const [name, price] of [['Demo Arena โ€” Field A', 800], ['Demo Arena โ€” Field B', 900]]) {
    const found = db.prepare('SELECT id FROM venues WHERE facility_id=? AND name=?').get(facilityId, name)
    if (!found) addVenue.run(name, 'Demo Bangkok', 'Demo address, Bangkok', 5, price, 1, '5v5,7v7', userIds.OWNER, facilityId)
  }
  return { userIds, facilityId }
})
const result = tx()
console.log(JSON.stringify({
  ok: true,
  environment: 'LOCAL_ONLY',
  accounts: accounts.map(a => ({ role: a.role, email: a.email, id: result.userIds[a.key] })),
  facility: { id: result.facilityId, name: facilityName },
  fields: db.prepare('SELECT id,name,price_per_hour FROM venues WHERE facility_id=? ORDER BY id').all(result.facilityId),
  note: 'Passwords were not printed. Never reuse these accounts on production.',
}, null, 2))

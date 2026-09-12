from pathlib import Path
p=Path(r"C:\porsball\server\src\db.js")
s=p.read_text(encoding="utf-8")
needle="try { db.exec('ALTER TABLE matches ADD COLUMN open_for_join INTEGER NOT NULL DEFAULT 0') } catch {}"
addition=needle+'\ntry { db.exec("CREATE TABLE IF NOT EXISTS match_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT,match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT \'pending\',checked_in_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(match_id,user_id));") } catch {}\ntry { db.exec("CREATE TABLE IF NOT EXISTS user_reliability (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,attended_count INTEGER NOT NULL DEFAULT 0,cancelled_count INTEGER NOT NULL DEFAULT 0,no_show_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);") } catch {}\n'
if needle not in s: raise SystemExit("db anchor missing")
s=s.replace(needle,addition,1)
p.write_text(s,encoding="utf-8")
print("reliability tables added")

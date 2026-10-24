import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
export const db = new DatabaseSync(cfg.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  weight INTEGER NOT NULL DEFAULT 3,          -- importancia base 1..5
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  priority INTEGER NOT NULL DEFAULT 3,        -- 1..5
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','active','done','backlog','dropped')),
  priority REAL NOT NULL DEFAULT 0,           -- calculada
  urgency INTEGER NOT NULL DEFAULT 3,         -- 1..5 detectada por LLM
  is_aligned INTEGER NOT NULL DEFAULT 1,
  snooze_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);

-- kind: ping | skipped | message | analysis
CREATE TABLE IF NOT EXISTS interaction_logs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  task_id INTEGER,
  slot TEXT,
  hour INTEGER,
  sent_at TEXT DEFAULT (datetime('now','localtime')),
  responded_at TEXT,
  response TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_slot ON interaction_logs(slot);

CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT);
`);

const DEFAULTS = {
  checkin_hours: [10, 15, 19],
  max_daily_pings: 5,
  ignore_limit: 2,          // pings ignorados seguidos antes de pausar el día
  dnd_until: null,
  paused_date: null,
  owner_chat_id: null,
  analysis_hour: 21,
  last_analysis: null,
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  db.prepare('INSERT OR IGNORE INTO bot_config(key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
}

export function getConfig(key) {
  const row = db.prepare('SELECT value FROM bot_config WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : DEFAULTS[key] ?? null;
}
export function setConfig(key, value) {
  db.prepare('INSERT INTO bot_config(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
export function allConfig() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM bot_config').all().map(r => [r.key, JSON.parse(r.value)]));
}

const p = n => String(n).padStart(2, '0');
export function nowStr(d = new Date()) {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export const todayStr = () => nowStr().slice(0, 10);

// ---------- Logs ----------
export function logInteraction({ kind, task_id = null, slot = null, response = null }) {
  const r = db.prepare('INSERT INTO interaction_logs(kind, task_id, slot, hour, sent_at, response) VALUES (?,?,?,?,?,?)')
    .run(kind, task_id, slot, new Date().getHours(), nowStr(), response);
  return Number(r.lastInsertRowid);
}
export function markPingResponded(logId, response) {
  db.prepare('UPDATE interaction_logs SET responded_at = ?, response = ? WHERE id = ? AND responded_at IS NULL')
    .run(nowStr(), response, logId);
}
/** Cualquier mensaje del usuario cuenta como respuesta al último ping pendiente de hoy. */
export function markLatestPingResponded(response) {
  const row = db.prepare(`SELECT id FROM interaction_logs WHERE kind='ping' AND responded_at IS NULL
    AND substr(sent_at,1,10) = ? ORDER BY id DESC LIMIT 1`).get(todayStr());
  if (row) markPingResponded(row.id, response);
}

// ---------- Tareas ----------
export function setTaskStatus(id, status) {
  db.prepare(`UPDATE tasks SET status = ?, updated_at = ?, completed_at = CASE WHEN ? = 'done' THEN ? ELSE completed_at END WHERE id = ?`)
    .run(status, nowStr(), status, nowStr(), id);
}
export const getTask = id => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

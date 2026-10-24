import express from 'express';
import path from 'node:path';
import { ROOT, cfg } from '../config.js';
import { db, allConfig, setConfig, nowStr, setTaskStatus } from '../db.js';
import { recalcTask, recalcAll } from '../priority.js';
import { runAnalysis } from '../agent.js';

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k] === '' ? null : obj[k]]));

function update(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

export function startWeb() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(ROOT, 'public')));

  app.get('/api/state', (_req, res) => {
    res.json({
      areas: db.prepare('SELECT * FROM areas ORDER BY archived, weight DESC, name').all(),
      goals: db.prepare('SELECT * FROM goals ORDER BY status, priority DESC').all(),
      tasks: db.prepare(`SELECT * FROM tasks WHERE status != 'done' OR completed_at >= ? ORDER BY priority DESC`)
        .all(nowStr(new Date(Date.now() - 7 * 86400000))),
      config: allConfig(),
      telemetry: {
        byHour: db.prepare(`SELECT hour, SUM(kind='ping') pings, SUM(kind='ping' AND responded_at IS NOT NULL) respondidos,
          SUM(kind='message') mensajes FROM interaction_logs WHERE sent_at >= ? GROUP BY hour ORDER BY hour`)
          .all(nowStr(new Date(Date.now() - 14 * 86400000))),
        recent: db.prepare('SELECT * FROM interaction_logs ORDER BY id DESC LIMIT 25').all(),
      },
    });
  });

  // Áreas
  app.post('/api/areas', (req, res) => {
    const r = db.prepare('INSERT INTO areas(name, weight) VALUES (?, ?)').run(req.body.name, Number(req.body.weight) || 3);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/areas/:id', (req, res) => {
    update('areas', req.params.id, pick(req.body, ['name', 'weight', 'archived'])); recalcAll(); res.json({ ok: true });
  });
  app.delete('/api/areas/:id', (req, res) => { db.prepare('DELETE FROM areas WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

  // Metas
  app.post('/api/goals', (req, res) => {
    const r = db.prepare('INSERT INTO goals(area_id, title, priority) VALUES (?, ?, ?)')
      .run(req.body.area_id || null, req.body.title, Number(req.body.priority) || 3);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/goals/:id', (req, res) => {
    update('goals', req.params.id, pick(req.body, ['area_id', 'title', 'status', 'priority'])); recalcAll(); res.json({ ok: true });
  });
  app.delete('/api/goals/:id', (req, res) => { db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

  // Tareas
  app.post('/api/tasks', (req, res) => {
    const { title, goal_id = null, area_id = null, urgency = 3, status = 'active' } = req.body;
    const g = goal_id ? db.prepare('SELECT area_id FROM goals WHERE id = ?').get(goal_id) : null;
    const r = db.prepare(`INSERT INTO tasks(goal_id, area_id, title, status, urgency, is_aligned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(goal_id || null, area_id || g?.area_id || null, title, status, Number(urgency), goal_id ? 1 : 0, nowStr(), nowStr());
    recalcTask(Number(r.lastInsertRowid));
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/tasks/:id', (req, res) => {
    const f = pick(req.body, ['title', 'goal_id', 'area_id', 'urgency', 'snooze_count']);
    if (f.goal_id !== undefined) f.is_aligned = f.goal_id ? 1 : 0;
    update('tasks', req.params.id, f);
    if (req.body.status) setTaskStatus(req.params.id, req.body.status);
    recalcTask(req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/tasks/:id', (req, res) => { db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
  app.post('/api/tasks/purge-dropped', (_req, res) => {
    res.json({ deleted: Number(db.prepare(`DELETE FROM tasks WHERE status = 'dropped'`).run().changes) });
  });

  // Config
  app.patch('/api/config', (req, res) => {
    for (const k of ['checkin_hours', 'max_daily_pings', 'ignore_limit', 'dnd_until', 'paused_date', 'analysis_hour']) {
      if (req.body[k] !== undefined) setConfig(k, req.body[k]);
    }
    res.json({ ok: true });
  });

  app.post('/api/analyze', async (_req, res) => {
    try { res.json(await runAnalysis('a pedido')); } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
  });

  app.listen(cfg.port, '127.0.0.1', () => console.log(`🌐 Dashboard en http://localhost:${cfg.port}`));
}

import { db, nowStr } from './db.js';

/**
 * Prioridad = peso del área*2 + prioridad de meta*2 + urgencia*3 + antigüedad (máx 7 días)*0.3 − postergaciones*0.5
 * Simple, explicable y sin pedirle nada al usuario.
 */
export function computePriority(t) {
  const area = t.area_id ? db.prepare('SELECT weight FROM areas WHERE id = ?').get(t.area_id) : null;
  const goal = t.goal_id ? db.prepare('SELECT priority FROM goals WHERE id = ?').get(t.goal_id) : null;
  const ageDays = t.created_at ? (Date.now() - new Date(t.created_at.replace(' ', 'T')).getTime()) / 86400000 : 0;
  const score = (area?.weight ?? 2) * 2 + (goal?.priority ?? 1) * 2 + (t.urgency ?? 3) * 3
    + Math.min(Math.max(ageDays, 0), 7) * 0.3 - (t.snooze_count ?? 0) * 0.5;
  return Math.round(score * 10) / 10;
}

export function recalcTask(id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return;
  db.prepare('UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?').run(computePriority(t), nowStr(), id);
}

export function recalcAll() {
  for (const { id } of db.prepare(`SELECT id FROM tasks WHERE status IN ('inbox','active','backlog')`).all()) recalcTask(id);
}

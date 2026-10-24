import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cfg, ROOT } from './config.js';
import { db, getConfig, setConfig, nowStr, setTaskStatus, logInteraction } from './db.js';
import { recalcTask } from './priority.js';
import { send } from './telegram.js';

let running = false;

function gatherStats() {
  const since = nowStr(new Date(Date.now() - 14 * 86400000));
  return {
    ahora: nowStr(),
    horarios_actuales: getConfig('checkin_hours'),
    actividad_por_hora: db.prepare(`SELECT hour,
        SUM(kind='ping') AS pings,
        SUM(kind='ping' AND responded_at IS NOT NULL) AS respondidos,
        SUM(kind='message') AS mensajes_espontaneos
      FROM interaction_logs WHERE sent_at >= ? GROUP BY hour ORDER BY hour`).all(since),
    tareas_trabadas: db.prepare(`SELECT id, title, snooze_count FROM tasks WHERE status='active' AND snooze_count >= 3`).all(),
    hechas_24h: db.prepare(`SELECT COUNT(*) c FROM tasks WHERE status='done' AND completed_at >= ?`).get(nowStr(new Date(Date.now() - 86400000))).c,
    hechas_7d: db.prepare(`SELECT COUNT(*) c FROM tasks WHERE status='done' AND completed_at >= ?`).get(nowStr(new Date(Date.now() - 7 * 86400000))).c,
    top_activas: db.prepare(`SELECT t.id, t.title, t.priority, g.title meta FROM tasks t LEFT JOIN goals g ON g.id=t.goal_id
      WHERE t.status='active' ORDER BY t.priority DESC LIMIT 5`).all(),
    en_inbox_o_backlog: db.prepare(`SELECT COUNT(*) c FROM tasks WHERE status IN ('inbox','backlog')`).get().c,
  };
}

function buildPrompt(kind, stats) {
  return `# Retrospectiva ${kind} del asistente "Super-yo"

Eres el motor de auto-mejora de un asistente personal de carga cognitiva cero.
Base de datos SQLite (solo lectura, opcional): ${cfg.dbPath}
Tablas: areas, goals, tasks, interaction_logs, bot_config.

Datos ya resumidos:
\`\`\`json
${JSON.stringify(stats, null, 2)}
\`\`\`

Tareas:
1. Horario: elige 2 a 4 horas (enteros 8-21) donde el usuario realmente responde o escribe espontáneamente. Si hay pocos datos, conserva los horarios actuales.
2. Tareas trabadas (snooze_count >= 3): para cada una decide "split" (propón un primer paso de 5 minutos, concreto, en infinitivo) o "backlog".
3. Escribe un resumen en español, máximo 5 líneas, tono cálido y breve, con el foco principal sugerido.

NO modifiques la base de datos. Responde ÚNICAMENTE con este JSON (sin texto extra):
{"checkin_hours":[10,15,19],"stuck":[{"task_id":1,"action":"split","first_step":"..."}],"focus":"...","digest":"..."}
`;
}

function runCli(promptFile) {
  return new Promise((resolve, reject) => {
    const rel = path.relative(ROOT, promptFile).replaceAll('\\', '/');
    const cmd = `${cfg.agentCmd} "Lee el archivo ${rel} y sigue sus instrucciones. Responde solo con el JSON pedido."`;
    const child = spawn(cmd, { cwd: ROOT, shell: true, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Timeout del agente CLI')); }, cfg.agentTimeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      const m = out.match(/\{[\s\S]*\}/g);
      if (!m) return reject(new Error(`Agente sin JSON (code ${code}): ${err.slice(0, 300)}`));
      for (const cand of m.reverse()) { try { return resolve(JSON.parse(cand)); } catch { /* sigue */ } }
      reject(new Error('JSON del agente inválido'));
    });
  });
}

/** Plan B si el agente CLI no está disponible. */
function heuristic(stats) {
  const scored = stats.actividad_por_hora
    .filter(r => r.hour >= 8 && r.hour <= 21)
    .map(r => ({ h: r.hour, act: r.respondidos + r.mensajes_espontaneos * 0.5, rate: r.pings ? r.respondidos / r.pings : 1 }))
    .filter(r => r.act >= 2 && r.rate >= 0.4)
    .sort((a, b) => b.act - a.act).slice(0, 3).map(r => r.h);
  const top = stats.top_activas[0];
  return {
    checkin_hours: scored.length >= 2 ? scored : stats.horarios_actuales,
    stuck: stats.tareas_trabadas.map(t => ({ task_id: t.id, action: 'split', first_step: `Abrir y dedicar 5 min a: ${t.title}` })),
    focus: top?.title || null,
    digest: `Completaste ${stats.hechas_24h} tarea(s) hoy y ${stats.hechas_7d} esta semana.${top ? ` Foco sugerido: ${top.title}.` : ''}`,
  };
}

function apply(result, stats) {
  const changes = [];
  const hours = Array.isArray(result.checkin_hours)
    ? [...new Set(result.checkin_hours.map(Number).filter(h => Number.isInteger(h) && h >= 7 && h <= 22))].sort((a, b) => a - b).slice(0, 6)
    : [];
  if (hours.length && JSON.stringify(hours) !== JSON.stringify(stats.horarios_actuales)) {
    setConfig('checkin_hours', hours);
    changes.push(`🕐 Nuevos horarios de check-in: ${hours.map(h => `${h}:00`).join(', ')}`);
  }
  const stuckIds = new Set(stats.tareas_trabadas.map(t => t.id));
  for (const s of result.stuck || []) {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(s.task_id);
    if (!t || !stuckIds.has(t.id)) continue;
    if (s.action === 'backlog') {
      setTaskStatus(t.id, 'backlog');
      changes.push(`🧊 Congelé "${t.title}" (pospuesta ${t.snooze_count} veces)`);
    } else if (s.first_step) {
      const id = Number(db.prepare(`INSERT INTO tasks(goal_id, area_id, title, status, urgency, is_aligned, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(t.goal_id, t.area_id, s.first_step, 'active', 5, t.is_aligned, nowStr(), nowStr()).lastInsertRowid);
      recalcTask(id);
      db.prepare('UPDATE tasks SET snooze_count = 0 WHERE id = ?').run(t.id);
      recalcTask(t.id);
      changes.push(`🪓 "${t.title}" → primer paso: ${s.first_step}`);
    }
  }
  return changes;
}

export async function runAnalysis(kind = 'diario', { notify = true } = {}) {
  if (running) return { ok: false, message: 'Ya hay un análisis en curso' };
  running = true;
  try {
    const stats = gatherStats();
    const file = path.join(path.dirname(cfg.dbPath), 'agent_input.md');
    fs.writeFileSync(file, buildPrompt(kind, stats), 'utf8');
    let result, source = 'agente';
    try { result = await runCli(file); } catch (e) {
      console.warn('Agente CLI no disponible, uso heurística:', e.message);
      result = heuristic(stats); source = 'heurística';
    }
    const changes = apply(result, stats);
    const summary = { at: nowStr(), kind, source, changes, focus: result.focus || null, digest: result.digest || '' };
    setConfig('last_analysis', summary);
    logInteraction({ kind: 'analysis', response: source });
    if (notify) {
      const text = [`🧠 *Resumen ${kind}*`, result.digest, changes.length ? `\n*Ajustes:*\n${changes.join('\n')}` : '',
        result.focus ? `\n👉 Foco: *${result.focus}*` : ''].filter(Boolean).join('\n');
      await send(text, { parse_mode: 'Markdown' });
    }
    return { ok: true, ...summary };
  } finally {
    running = false;
  }
}

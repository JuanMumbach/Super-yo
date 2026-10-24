import { db, nowStr, setTaskStatus, getTask } from './db.js';
import { chatJSON } from './llm.js';
import { recalcTask } from './priority.js';
import { Markup } from 'telegraf';

const SYSTEM = `Eres el clasificador de un asistente personal de "carga cognitiva cero".
El usuario escribe en español, sin estructura. Tú decides la estructura.
Devuelve SOLO JSON con la forma {"actions":[...], "reply":"texto breve opcional en español"}.
Tipos de acción:
- {"type":"create_area","name":string,"weight":1-5}
- {"type":"create_goal","title":string,"area_id":int|null,"area_name":string|null,"priority":1-5}
- {"type":"create_task","title":string,"goal_id":int|null,"area_id":int|null,"urgency":1-5}
- {"type":"complete_task","task_id":int}
- {"type":"chat"}  (si no es nada de lo anterior; responde en "reply")
Reglas:
- Un mensaje puede contener varias acciones (ej. varias tareas).
- Solo crea áreas o metas si el usuario lo pide explícitamente o declara un objetivo nuevo claro.
- goal_id solo si la tarea claramente contribuye a una meta ACTIVA del contexto; si no, null. area_id si encaja en un área.
- Nunca inventes ids que no estén en el contexto.
- Para complete_task elige la tarea del contexto que mejor coincida ("ya hice X", "terminé X").
- Títulos cortos, en infinitivo. Urgencia: 5 = hoy/urgente, 3 = normal, 1 = algún día.`;

function context() {
  return {
    areas: db.prepare('SELECT id, name, weight FROM areas WHERE archived = 0').all(),
    metas_activas: db.prepare(`SELECT id, title, area_id FROM goals WHERE status = 'active'`).all(),
    tareas_abiertas: db.prepare(`SELECT id, title FROM tasks WHERE status IN ('inbox','active') ORDER BY priority DESC LIMIT 60`).all(),
  };
}

function ensureArea(name, weight = 3) {
  const ex = db.prepare('SELECT id FROM areas WHERE lower(name) = lower(?)').get(name);
  if (ex) return ex.id;
  return Number(db.prepare('INSERT INTO areas(name, weight) VALUES (?, ?)').run(name, clamp(weight)).lastInsertRowid);
}
const clamp = (n, lo = 1, hi = 5) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 3)));
const validId = (table, id) => id && db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) ? Number(id) : null;

export function alignmentButtons(taskId) {
  return Markup.inlineKeyboard([
    Markup.button.callback('🚀 Activar igual', `al:act:${taskId}`),
    Markup.button.callback('🧊 Congelar', `al:bak:${taskId}`),
    Markup.button.callback('🗑️ Descartar', `al:del:${taskId}`),
  ]);
}

/** Procesa texto libre. Devuelve una lista de mensajes [{text, extra}] para enviar. */
export async function handleCapture(text) {
  const out = [];
  const res = await chatJSON(SYSTEM, `Contexto:\n${JSON.stringify(context())}\n\nMensaje:\n${text}`);
  const actions = Array.isArray(res.actions) ? res.actions : [];
  const done = [];

  for (const a of actions) {
    try {
      if (a.type === 'create_area' && a.name) {
        ensureArea(a.name, a.weight);
        done.push(`🗂️ Área: *${a.name}*`);
      } else if (a.type === 'create_goal' && a.title) {
        const areaId = validId('areas', a.area_id) ?? (a.area_name ? ensureArea(a.area_name) : null);
        db.prepare('INSERT INTO goals(area_id, title, priority) VALUES (?, ?, ?)').run(areaId, a.title, clamp(a.priority));
        done.push(`🎯 Meta: *${a.title}*`);
      } else if (a.type === 'create_task' && a.title) {
        const goalId = validId('goals', a.goal_id);
        const goal = goalId ? db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId) : null;
        const aligned = goal && goal.status === 'active';
        const areaId = goal?.area_id ?? validId('areas', a.area_id);
        const id = Number(db.prepare(`INSERT INTO tasks(goal_id, area_id, title, status, urgency, is_aligned, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(goalId, areaId, a.title, aligned ? 'active' : 'inbox', clamp(a.urgency),
          aligned ? 1 : 0, nowStr(), nowStr()).lastInsertRowid);
        recalcTask(id);
        if (aligned) done.push(`✅ Tarea: *${a.title}* → ${goal.title}`);
        else out.push({
          text: `🤔 *${a.title}* no encaja con ninguna meta activa. ¿Qué hago?`,
          extra: { parse_mode: 'Markdown', ...alignmentButtons(id) },
        });
      } else if (a.type === 'complete_task') {
        const t = getTask(validId('tasks', a.task_id));
        if (t) { setTaskStatus(t.id, 'done'); done.push(`🎉 Hecho: *${t.title}*`); }
      }
    } catch (e) {
      console.error('Acción fallida', a, e.message);
    }
  }

  const head = [res.reply, ...done].filter(Boolean).join('\n');
  if (head) out.unshift({ text: head, extra: { parse_mode: 'Markdown' } });
  if (!out.length) out.push({ text: '👍 Anotado.', extra: {} });
  return out;
}

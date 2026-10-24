import cron from 'node-cron';
import { Markup } from 'telegraf';
import { db, getConfig, setConfig, logInteraction, todayStr, nowStr } from './db.js';
import { send } from './telegram.js';
import { runAnalysis } from './agent.js';

const QUIET_START = 8, QUIET_END = 22;

export function checkinButtons(taskId, logId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Hecho', `ci:done:${taskId}:${logId}`), Markup.button.callback('⏳ En eso', `ci:work:${taskId}:${logId}`)],
    [Markup.button.callback('⏭️ Posponer', `ci:snooze:${taskId}:${logId}`), Markup.button.callback('🔕 DND 3h', `ci:dnd:${taskId}:${logId}`)],
  ]);
}

const slotDone = slot => !!db.prepare('SELECT 1 FROM interaction_logs WHERE slot = ?').get(slot);
const pingsToday = () => db.prepare(`SELECT COUNT(*) c FROM interaction_logs WHERE kind='ping' AND substr(sent_at,1,10)=?`).get(todayStr()).c;

function consecutiveIgnoredToday() {
  const rows = db.prepare(`SELECT responded_at FROM interaction_logs WHERE kind='ping' AND substr(sent_at,1,10)=? ORDER BY id DESC`).all(todayStr());
  let n = 0;
  for (const r of rows) { if (r.responded_at) break; n++; }
  return n;
}

/** Devuelve el motivo para no enviar ping, o null si se puede. */
async function blockReason() {
  const dnd = getConfig('dnd_until');
  if (dnd && dnd > nowStr()) return 'dnd';
  if (getConfig('paused_date') === todayStr()) return 'pausado';
  if (pingsToday() >= getConfig('max_daily_pings')) return 'limite';
  if (consecutiveIgnoredToday() >= getConfig('ignore_limit')) {
    setConfig('paused_date', todayStr());
    await send('😴 Veo que hoy estás a full. Pauso los recordatorios hasta mañana. Puedes seguir escribiéndome cuando quieras.',
      { disable_notification: true });
    return 'fatiga';
  }
  return null;
}

export async function sendCheckin(slot, { catchup = false } = {}) {
  const t = db.prepare(`SELECT t.*, g.title goal FROM tasks t LEFT JOIN goals g ON g.id = t.goal_id
    WHERE t.status = 'active' ORDER BY t.priority DESC, t.snooze_count ASC LIMIT 1`).get();
  const logId = logInteraction({ kind: 'ping', task_id: t?.id ?? null, slot });
  const pre = catchup ? '⏰ (recordatorio pendiente)\n' : '';
  if (!t) {
    return send(`${pre}👋 ¿Algo rondando en la cabeza? Mándamelo por texto o audio y yo lo ordeno.`,
      Markup.inlineKeyboard([Markup.button.callback('🔕 DND 3h', `ci:dnd:0:${logId}`)]));
  }
  return send(`${pre}🎯 Foco sugerido: *${t.title}*${t.goal ? `\n_${t.goal}_` : ''}\n¿Cómo vas?`,
    { parse_mode: 'Markdown', ...checkinButtons(t.id, logId) });
}

async function maybePing(slot, opts) {
  if (slotDone(slot)) return;
  const reason = await blockReason();
  if (reason) { logInteraction({ kind: 'skipped', slot, response: reason }); return; }
  await sendCheckin(slot, opts);
}

async function tick() {
  const h = new Date().getHours();
  if (!getConfig('checkin_hours').includes(h)) return;
  await maybePing(`${todayStr()}-${h}`);
}

/** Si la PC estuvo apagada durante un recordatorio de hoy, envía uno de recuperación. */
export async function startupCatchUp() {
  const h = new Date().getHours();
  if (h < QUIET_START || h >= QUIET_END) return;
  const hours = getConfig('checkin_hours');
  if (hours.includes(h)) return; // tick() lo cubre
  const missed = hours.filter(x => x < h).sort((a, b) => b - a)[0];
  if (missed === undefined) return;
  await maybePing(`${todayStr()}-${missed}`, { catchup: true });
}

export function startScheduler() {
  cron.schedule('* * * * *', () => tick().catch(e => console.error('tick:', e.message)));
  // Retrospectiva diaria a la hora configurada; semanal los domingos
  cron.schedule('0 * * * *', () => {
    const d = new Date();
    if (d.getHours() !== getConfig('analysis_hour')) return;
    runAnalysis(d.getDay() === 0 ? 'semanal' : 'diario').catch(e => console.error('análisis:', e.message));
  });
}

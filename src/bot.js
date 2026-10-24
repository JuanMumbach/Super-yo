import { bot, ownerId } from './telegram.js';
import { cfg } from './config.js';
import { db, setConfig, getConfig, nowStr, logInteraction, markPingResponded, markLatestPingResponded, setTaskStatus, getTask } from './db.js';
import { handleCapture } from './capture.js';
import { transcribe } from './llm.js';
import { recalcTask } from './priority.js';
import { runAnalysis } from './agent.js';

const HELP = `Hola 👋 Soy tu Super-yo.
Escríbeme o mándame un audio con lo que tengas en la cabeza. Yo lo ordeno.

/hoy – tu foco del día
/analizar – retrospectiva y ajustes
/dnd – silencio 3 horas
/reanudar – reactivar recordatorios`;

async function replyAll(ctx, msgs) {
  for (const m of msgs) {
    try { await ctx.reply(m.text, m.extra); } catch { await ctx.reply(m.text.replace(/[*_]/g, ''), { ...m.extra, parse_mode: undefined }); }
  }
}

async function capture(ctx, text) {
  logInteraction({ kind: 'message' });
  markLatestPingResponded('mensaje');
  try { await replyAll(ctx, await handleCapture(text)); } catch (e) {
    console.error(e);
    await ctx.reply('⚠️ No pude procesarlo ahora. Lo intento de nuevo si me lo reenvías.');
  }
}

export function setupBot() {
  if (!bot) { console.warn('⚠️  Sin TELEGRAM_BOT_TOKEN: bot desactivado.'); return; }

  // Solo el dueño puede usar el bot
  bot.use((ctx, next) => {
    const id = String(ctx.chat?.id ?? '');
    if (!id) return;
    if (!ownerId()) { setConfig('owner_chat_id', id); console.log('Dueño registrado:', id); }
    if (String(ownerId()) !== id) return;
    return next();
  });

  bot.start(ctx => ctx.reply(HELP));
  bot.command('ayuda', ctx => ctx.reply(HELP));

  bot.command('hoy', ctx => {
    const rows = db.prepare(`SELECT title FROM tasks WHERE status='active' ORDER BY priority DESC LIMIT 3`).all();
    ctx.reply(rows.length ? `🎯 Hoy:\n${rows.map((r, i) => `${i + 1}. ${r.title}`).join('\n')}` : 'Nada activo. ¡Día libre o mándame algo! 🙌');
  });

  bot.command('dnd', ctx => {
    setConfig('dnd_until', nowStr(new Date(Date.now() + 3 * 3600000)));
    ctx.reply('🔕 Silencio por 3 horas.');
  });

  bot.command('reanudar', ctx => {
    setConfig('dnd_until', null); setConfig('paused_date', null);
    ctx.reply('🔔 Recordatorios reactivados.');
  });

  bot.command('analizar', async ctx => {
    await ctx.reply('🧠 Analizando… te aviso en un rato.');
    const r = await runAnalysis('a pedido');
    if (!r.ok) ctx.reply(r.message);
  });

  bot.on('text', ctx => capture(ctx, ctx.message.text));

  bot.on(['voice', 'audio'], async ctx => {
    const f = ctx.message.voice || ctx.message.audio;
    try {
      const link = await ctx.telegram.getFileLink(f.file_id);
      const buf = Buffer.from(await (await fetch(link.href)).arrayBuffer());
      const text = await transcribe(buf, 'audio.ogg');
      if (!text) return ctx.reply('🤷 No entendí el audio.');
      await ctx.reply(`🎙️ _${text}_`, { parse_mode: 'Markdown' }).catch(() => ctx.reply(`🎙️ ${text}`));
      await capture(ctx, text);
    } catch (e) {
      console.error(e);
      ctx.reply('⚠️ No pude transcribir el audio.');
    }
  });

  // Check-ins: ci:<acción>:<taskId>:<logId>
  bot.action(/^ci:(done|work|snooze|dnd):(\d+):(\d+)$/, async ctx => {
    const [, action, taskId, logId] = ctx.match;
    markPingResponded(Number(logId), action);
    const t = getTask(Number(taskId));
    let msg;
    if (action === 'done' && t) { setTaskStatus(t.id, 'done'); msg = `🎉 ¡Bien! "${t.title}" hecha.`; }
    else if (action === 'work') msg = '💪 ¡Dale! Sigo atento.';
    else if (action === 'snooze' && t) {
      db.prepare('UPDATE tasks SET snooze_count = snooze_count + 1 WHERE id = ?').run(t.id);
      recalcTask(t.id);
      msg = '⏭️ Pospuesta. Sin culpa.';
    } else if (action === 'dnd') { setConfig('dnd_until', nowStr(new Date(Date.now() + 3 * 3600000))); msg = '🔕 Silencio por 3 horas.'; }
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    if (msg) await ctx.reply(msg);
  });

  // Filtro anti-ruido: al:<act|bak|del>:<taskId>
  bot.action(/^al:(act|bak|del):(\d+)$/, async ctx => {
    const [, action, taskId] = ctx.match;
    const t = getTask(Number(taskId));
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    if (!t) return;
    const map = { act: ['active', '🚀 Activada'], bak: ['backlog', '🧊 Al congelador'], del: ['dropped', '🗑️ Descartada'] };
    setTaskStatus(t.id, map[action][0]);
    await ctx.reply(`${map[action][1]}: ${t.title}`);
  });

  bot.catch(e => console.error('Error del bot:', e));
  bot.launch().catch(e => console.error('No se pudo iniciar el bot:', e.message));
  console.log('🤖 Bot de Telegram iniciado' + (cfg.chatId || getConfig('owner_chat_id') ? '' : ' (envía /start para registrarte)'));
}

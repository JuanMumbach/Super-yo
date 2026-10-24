import { Telegraf } from 'telegraf';
import { cfg } from './config.js';
import { getConfig } from './db.js';

export const bot = cfg.telegramToken ? new Telegraf(cfg.telegramToken) : null;

export const ownerId = () => cfg.chatId || getConfig('owner_chat_id');

/** Envía un mensaje al dueño. Silencioso si no hay bot o dueño. */
export async function send(text, extra = {}) {
  const id = ownerId();
  if (!bot || !id) { console.log('[telegram desactivado]', text); return null; }
  try {
    return await bot.telegram.sendMessage(id, text, extra);
  } catch (e) {
    // Si falla Markdown, reintenta en texto plano
    if (extra.parse_mode) return bot.telegram.sendMessage(id, text, { ...extra, parse_mode: undefined });
    console.error('Error enviando a Telegram:', e.message);
    return null;
  }
}

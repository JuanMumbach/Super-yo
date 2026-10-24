import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const cfg = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || null,
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  whisperModel: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
  dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/superyo.db'),
  port: Number(process.env.PORT || 3000),
  agentCmd: process.env.AGENT_CMD || 'opencode run',
  agentTimeoutMs: Number(process.env.AGENT_TIMEOUT_MS || 300000),
};

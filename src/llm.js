import { cfg } from './config.js';

const BASE = 'https://api.groq.com/openai/v1';

export async function chatJSON(system, user) {
  if (!cfg.groqKey) throw new Error('Falta GROQ_API_KEY');
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.groqModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

export async function transcribe(buffer, filename = 'audio.ogg') {
  if (!cfg.groqKey) throw new Error('Falta GROQ_API_KEY');
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  fd.append('model', cfg.whisperModel);
  fd.append('language', 'es');
  const r = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqKey}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${await r.text()}`);
  return (await r.json()).text?.trim() || '';
}

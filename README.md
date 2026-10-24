# 🧭 Super-yo

Asistente personal **local** con carga cognitiva cero: capturas por Telegram (texto o audio), el sistema ordena todo solo, un panel web para revisar cuando estás en la PC y un agente CLI (`opencode` / `agy`) que hace retrospectivas y ajusta el comportamiento a tus hábitos reales.

## Stack (mínimo)

| Pieza | Elección | Por qué |
|---|---|---|
| Runtime | Node.js ≥ 22.13 | `node:sqlite` nativo, `fetch`/`FormData` incluidos |
| Base de datos | `node:sqlite` (sin compilación nativa) | Un solo archivo `data/superyo.db` |
| Bot | `telegraf` | Long polling, sin abrir puertos |
| Web | `express` + HTML/JS vanilla | Sin build step |
| Cron | `node-cron` | Check-ins y retrospectivas |
| IA | Groq (LLM JSON + Whisper) vía `fetch` | Rápido y barato |
| Retrospectiva | Subproceso `opencode run` / `agy` | Con heurística de respaldo si no está |

## Estructura

```
src/
  index.js        Arranque (web + bot + cron + catch-up)
  config.js       Variables de entorno
  db.js           Esquema SQLite, config dinámica, logs
  priority.js     Cálculo automático de prioridad
  llm.js          Groq chat (JSON) + Whisper
  capture.js      Texto libre → intenciones → áreas/metas/tareas + filtro anti-ruido
  telegram.js     Instancia del bot + send()
  bot.js          Comandos, voz, botones de check-in y alineación
  scheduler.js    Check-ins, guardia de fatiga, DND, recuperación al iniciar
  agent.js        Retrospectiva con agente CLI → aplica horarios / destraba tareas / resumen
  cli-analyze.js  `npm run analizar`
  web/server.js   API REST del panel
public/           Panel web (index.html, app.js, style.css)
data/             superyo.db + agent_input.md (se crean solos)
```

## Puesta en marcha

```powershell
npm install
copy .env.example .env    # completa TELEGRAM_BOT_TOKEN y GROQ_API_KEY
npm start
```

1. Abre tu bot en Telegram y envía `/start` (el primer chat queda registrado como dueño, o fija `TELEGRAM_CHAT_ID`).
2. Abre el panel: <http://localhost:3000>.
3. Escribe o graba lo que tengas en la cabeza, por ejemplo: *"Quiero aprobar Álgebra este cuatrimestre"* → crea meta; *"tengo que repasar matrices para el jueves"* → tarea vinculada.

### Comandos de Telegram
`/hoy` · `/analizar` · `/dnd` · `/reanudar` · `/ayuda`

### Agente CLI
`AGENT_CMD` se ejecuta en la raíz del proyecto con un prompt corto que le pide leer `data/agent_input.md` (estadísticas + instrucciones) y responder con JSON. Super-yo valida y aplica los cambios (el agente no escribe en la base). Si el comando falla o no está instalado, se usa una heurística local, así que todo funciona igual.

- Automático: cada día a `analysis_hour` (21 h por defecto; los domingos es "semanal").
- Manual: `/analizar`, botón en el panel, o `npm run analizar`.

## Cómo funciona el comportamiento
- **Prioridad** = importancia del área·2 + prioridad de la meta·2 + urgencia·3 + antigüedad − postergaciones.
- **Filtro anti-ruido**: si una tarea no encaja con ninguna meta activa, el bot pregunta: Activar igual / Congelar / Descartar.
- **Guardia de fatiga**: si ignoras `ignore_limit` pings seguidos (2 por defecto), se pausan los recordatorios hasta mañana. También hay un tope diario (`max_daily_pings`).
- **Recuperación**: al iniciar, si la PC estuvo apagada durante un check-in de hoy, envía uno marcado como pendiente.
- **Auto-ajuste**: la retrospectiva mira a qué horas respondes o escribes espontáneamente y mueve los check-ins ahí; las tareas pospuestas 3+ veces se parten en un primer paso de 5 minutos o se congelan.

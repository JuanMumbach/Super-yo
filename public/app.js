const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null;

const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { alert('Error: ' + (await r.text())); throw new Error(r.status); }
  return r.json();
};
const act = async (...a) => { await api(...a); await load(); };

// ---------- Tabs ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button, .tab').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); $('#' + b.dataset.tab).classList.add('on');
});

// ---------- Render ----------
const STATUS = { inbox: '📥 Inbox', active: '⚡ Activa', done: '✅ Hecha', backlog: '🧊 Congelada', dropped: '🗑️ Descartada' };
const GSTATUS = { active: 'Activa', paused: 'Pausada', completed: 'Completada' };
const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

function taskRow(t) {
  const goalOpts = `<option value="">— sin meta —</option>` + S.goals.filter(g => g.status === 'active' || g.id === t.goal_id)
    .map(g => `<option value="${g.id}" ${g.id === t.goal_id ? 'selected' : ''}>${esc(g.title)}</option>`).join('');
  return `<div class="task" data-id="${t.id}">
    <span class="pill ${t.priority >= 25 ? 'hi' : ''}" title="Prioridad calculada">${t.priority}</span>
    <span class="t" contenteditable="true" data-f="title">${esc(t.title)}</span>
    ${t.snooze_count ? `<span class="pill snz" title="Veces pospuesta">⏭️${t.snooze_count}</span>` : ''}
    <input type="number" min="1" max="5" value="${t.urgency}" data-f="urgency" title="Urgencia" />
    <select data-f="goal_id">${goalOpts}</select>
    <select data-f="status">${opts(STATUS, t.status)}</select>
    <button class="icon" data-del="tasks" title="Eliminar">✕</button>
  </div>`;
}

function render() {
  const open = S.tasks.filter(t => ['active', 'inbox', 'done'].includes(t.status));
  const sel = (list, label, cur) => `<option value="">${label}</option>` + list.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name || x.title)}</option>`).join('');
  document.querySelectorAll('.sel-area').forEach(e => e.innerHTML = sel(S.areas.filter(a => !a.archived), '— área —'));
  document.querySelectorAll('.sel-goal').forEach(e => e.innerHTML = sel(S.goals.filter(g => g.status === 'active'), '— meta —'));

  const top = S.tasks.filter(t => t.status === 'active').slice(0, 3);
  $('#focus').innerHTML = top.length ? `<b>🎯 Foco ahora:</b> ${top.map(t => esc(t.title)).join(' · ')}` : '<span class="muted">Sin tareas activas. Todo en calma ☕</span>';

  const goalBlock = g => `<div class="goal" data-gid="${g.id}">
      <div class="head"><span class="name" contenteditable="true" data-gf="title">🎯 ${esc(g.title)}</span>
        <input type="number" min="1" max="5" value="${g.priority}" data-gf="priority" title="Prioridad" />
        <select data-gf="status">${opts(GSTATUS, g.status)}</select>
        <button class="icon" data-gdel title="Eliminar meta">✕</button></div>
      ${open.filter(t => t.goal_id === g.id).map(taskRow).join('') || '<div class="task muted">Sin tareas</div>'}
    </div>`;

  const areas = S.areas.map(a => `<div class="area ${a.archived ? 'archived' : ''}" data-aid="${a.id}">
      <div class="head"><span class="name" contenteditable="true" data-af="name">${esc(a.name)}</span>
        <input type="number" min="1" max="5" value="${a.weight}" data-af="weight" title="Importancia" />
        <button class="icon" data-aarch>${a.archived ? '📤 Restaurar' : '📦 Archivar'}</button>
        <button class="icon" data-adel title="Eliminar área">✕</button></div>
      ${S.goals.filter(g => g.area_id === a.id).map(goalBlock).join('')}
      ${open.filter(t => t.area_id === a.id && !t.goal_id).map(taskRow).join('')}
    </div>`).join('');

  const orphanGoals = S.goals.filter(g => !g.area_id);
  const orphanTasks = open.filter(t => !t.area_id && !t.goal_id);
  const orphan = orphanGoals.length || orphanTasks.length
    ? `<div class="area"><div class="head"><span class="name muted">Sin área</span></div>${orphanGoals.map(goalBlock).join('')}${orphanTasks.map(taskRow).join('')}</div>` : '';
  $('#tree').innerHTML = areas + orphan || '<p class="muted">Aún no hay nada. Escríbele al bot o crea un área arriba.</p>';

  const frozen = S.tasks.filter(t => ['backlog', 'dropped'].includes(t.status) || (t.status === 'inbox' && !t.is_aligned));
  $('#freezer').innerHTML = frozen.length ? `<div class="area">${frozen.map(taskRow).join('')}</div>` : '<p class="muted">El congelador está vacío 🧊</p>';

  // Sistema
  const c = S.config;
  $('#c-hours').value = c.checkin_hours.join(',');
  $('#c-max').value = c.max_daily_pings; $('#c-ignore').value = c.ignore_limit; $('#c-ahour').value = c.analysis_hour;
  const today = new Date().toLocaleDateString('sv');
  $('#c-state').textContent = [c.dnd_until && c.dnd_until > new Date().toLocaleString('sv') ? `🔕 No molestar hasta ${c.dnd_until}` : '',
    c.paused_date === today ? '😴 Recordatorios pausados hoy por fatiga' : ''].filter(Boolean).join(' · ') || '🔔 Recordatorios activos';
  const la = c.last_analysis;
  $('#analysis').textContent = la ? `Último: ${la.at} (${la.source})\n${la.digest}\n${(la.changes || []).join('\n')}` : 'Aún no se ejecutó.';

  const byH = Object.fromEntries(S.telemetry.byHour.map(r => [r.hour, r]));
  const max = Math.max(1, ...S.telemetry.byHour.map(r => r.respondidos + r.mensajes));
  $('#chart').innerHTML = Array.from({ length: 16 }, (_, i) => i + 7).map(h => {
    const r = byH[h] || { pings: 0, respondidos: 0, mensajes: 0 };
    const v = r.respondidos + r.mensajes;
    return `<div class="col ${c.checkin_hours.includes(h) ? 'sel' : ''}" title="${r.respondidos}/${r.pings} pings respondidos · ${r.mensajes} mensajes">
      <div class="barv" style="height:${(v / max) * 100}%"></div>${h}</div>`;
  }).join('');
  $('#logs').innerHTML = S.telemetry.recent.map(l => `<tr><td>${l.sent_at}</td><td>${l.kind}</td><td>${l.response ?? (l.kind === 'ping' ? '<span class="muted">sin respuesta</span>' : '')}</td><td>${l.responded_at ?? ''}</td></tr>`).join('');
}

async function load() { S = await api('GET', '/api/state'); render(); }

// ---------- Eventos ----------
const formData = f => Object.fromEntries(new FormData(f));
$('#f-area').onsubmit = e => { e.preventDefault(); act('POST', '/api/areas', formData(e.target)); e.target.reset(); };
$('#f-goal').onsubmit = e => { e.preventDefault(); act('POST', '/api/goals', formData(e.target)); e.target.reset(); };
$('#f-task').onsubmit = e => { e.preventDefault(); act('POST', '/api/tasks', formData(e.target)); e.target.reset(); };

document.addEventListener('change', e => {
  const el = e.target, val = el.value === '' ? null : el.value;
  if (el.dataset.f) act('PATCH', `/api/tasks/${el.closest('.task').dataset.id}`, { [el.dataset.f]: val });
  if (el.dataset.gf) act('PATCH', `/api/goals/${el.closest('.goal').dataset.gid}`, { [el.dataset.gf]: val });
  if (el.dataset.af) act('PATCH', `/api/areas/${el.closest('.area').dataset.aid}`, { [el.dataset.af]: val });
});
document.addEventListener('focusout', e => {
  const el = e.target;
  if (!el.isContentEditable) return;
  const text = el.textContent.replace(/^🎯\s*/, '').trim();
  if (!text) return load();
  if (el.dataset.f) act('PATCH', `/api/tasks/${el.closest('.task').dataset.id}`, { title: text });
  if (el.dataset.gf) act('PATCH', `/api/goals/${el.closest('.goal').dataset.gid}`, { title: text });
  if (el.dataset.af) act('PATCH', `/api/areas/${el.closest('.area').dataset.aid}`, { name: text });
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.isContentEditable) { e.preventDefault(); e.target.blur(); } });
document.addEventListener('click', e => {
  const el = e.target;
  if (el.dataset.del && confirm('¿Eliminar tarea?')) act('DELETE', `/api/tasks/${el.closest('.task').dataset.id}`);
  if (el.hasAttribute('data-gdel') && confirm('¿Eliminar meta? (las tareas quedan sin meta)')) act('DELETE', `/api/goals/${el.closest('.goal').dataset.gid}`);
  if (el.hasAttribute('data-adel') && confirm('¿Eliminar área?')) act('DELETE', `/api/areas/${el.closest('.area').dataset.aid}`);
  if (el.hasAttribute('data-aarch')) {
    const a = S.areas.find(x => x.id == el.closest('.area').dataset.aid);
    act('PATCH', `/api/areas/${a.id}`, { archived: a.archived ? 0 : 1 });
  }
});

$('#purge').onclick = () => confirm('¿Eliminar definitivamente las tareas descartadas?') && act('POST', '/api/tasks/purge-dropped');
$('#save-cfg').onclick = () => act('PATCH', '/api/config', {
  checkin_hours: $('#c-hours').value.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 23).sort((a, b) => a - b),
  max_daily_pings: Number($('#c-max').value), ignore_limit: Number($('#c-ignore').value), analysis_hour: Number($('#c-ahour').value),
});
$('#resume').onclick = () => act('PATCH', '/api/config', { dnd_until: null, paused_date: null });
$('#analyze').onclick = async e => {
  e.target.disabled = true; e.target.textContent = '🧠 Analizando…';
  try { await act('POST', '/api/analyze'); } finally { e.target.disabled = false; e.target.textContent = 'Ejecutar retrospectiva'; }
};

load();
setInterval(() => { if (!document.activeElement?.isContentEditable && document.activeElement?.tagName !== 'INPUT') load(); }, 30000);

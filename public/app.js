const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;
let activeFilter = 'all'; // 'all' | 'active' | 'done'
let searchQuery = '';
const collapsedAreas = new Set(JSON.parse(localStorage.getItem('superyo_collapsed') || '[]'));

// ---------- Toast Notifications ----------
function showToast(message, type = 'info') {
  const container = $('#toasts');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = message;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 250);
  }, 2800);
}

// ---------- API ----------
const api = async (method, url, body) => {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const err = await r.text();
      showToast(`⚠️ Error: ${err}`, 'error');
      throw new Error(r.status);
    }
    return r.json();
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
};

const act = async (...a) => {
  await api(...a);
  await load();
};

// ---------- Navigation Tabs ----------
$$('nav .nav-tab').forEach(b => {
  b.onclick = () => {
    $$('nav .nav-tab, .tab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const target = $('#' + b.dataset.tab);
    if (target) target.classList.add('on');
  };
});

// ---------- Creation Tabs ----------
$$('.create-tab-btn').forEach(btn => {
  btn.onclick = () => {
    $$('.create-tab-btn').forEach(b => b.classList.remove('on'));
    $$('.create-form').forEach(f => f.classList.remove('on'));
    btn.classList.add('on');
    const formId = `#f-${btn.dataset.createTab}`;
    const form = $(formId);
    if (form) {
      form.classList.add('on');
      const input = form.querySelector('input');
      if (input) input.focus();
    }
  };
});

// ---------- Status Constants ----------
const STATUS = {
  inbox: '📥 Inbox',
  active: '⚡ Activa',
  done: '✅ Hecha',
  backlog: '🧊 Congelada',
  dropped: '🗑️ Descartada',
};
const GSTATUS = {
  active: 'Activa',
  paused: 'Pausada',
  completed: 'Completada',
};

const opts = (map, cur) =>
  Object.entries(map)
    .map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`)
    .join('');

// ---------- Task Row Component ----------
function taskRow(t) {
  const isDone = t.status === 'done';
  const goalOpts =
    `<option value="">— sin meta —</option>` +
    S.goals
      .filter(g => g.status === 'active' || g.id === t.goal_id)
      .map(g => `<option value="${g.id}" ${g.id === t.goal_id ? 'selected' : ''}>🎯 ${esc(g.title)}</option>`)
      .join('');

  return `
    <div class="task ${isDone ? 'done' : ''}" data-id="${t.id}">
      <button class="task-check" data-toggle-done="${t.id}" title="${isDone ? 'Marcar como activa' : 'Marcar como completada'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>
      </button>

      <span class="pill-priority ${t.priority >= 20 ? 'hi' : ''}" title="Prioridad calculada: ${t.priority}">
        ${t.priority >= 20 ? '🔥 ' : ''}${t.priority}
      </span>

      <span class="task-title" contenteditable="true" data-f="title" spellcheck="false">${esc(t.title)}</span>

      ${t.snooze_count ? `<span class="pill-snz" title="Veces pospuesta: ${t.snooze_count}">⏭️ ${t.snooze_count}</span>` : ''}

      <select class="task-select urgency-select" data-f="urgency" title="Urgencia (1-5)">
        <option value="1" ${t.urgency === 1 ? 'selected' : ''}>⚡ 1</option>
        <option value="2" ${t.urgency === 2 ? 'selected' : ''}>⚡ 2</option>
        <option value="3" ${t.urgency === 3 ? 'selected' : ''}>⚡ 3</option>
        <option value="4" ${t.urgency === 4 ? 'selected' : ''}>⚡ 4</option>
        <option value="5" ${t.urgency === 5 ? 'selected' : ''}>⚡ 5</option>
      </select>

      <select class="task-select" data-f="goal_id" title="Meta asignada">
        ${goalOpts}
      </select>

      <select class="task-select" data-f="status" title="Estado">
        ${opts(STATUS, t.status)}
      </select>

      <div class="task-actions">
        <button class="icon-btn" data-quick-snooze="${t.id}" title="Posponer tarea (+1 snooze)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
        </button>
        <button class="icon-btn danger" data-del="tasks" title="Eliminar tarea">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>`;
}

// ---------- Render Logic ----------
function render() {
  if (!S) return;

  const openTasks = S.tasks.filter(t => ['active', 'inbox', 'done'].includes(t.status));
  const activeTasks = S.tasks.filter(t => t.status === 'active');
  const doneTasks = S.tasks.filter(t => t.status === 'done');
  const frozenTasks = S.tasks.filter(
    t => ['backlog', 'dropped'].includes(t.status) || (t.status === 'inbox' && !t.is_aligned)
  );

  // Update Badges & KPIs
  $('#count-active').textContent = activeTasks.length;
  $('#count-frozen').textContent = frozenTasks.length;
  $('#kpi-active').textContent = activeTasks.length;
  $('#kpi-goals').textContent = S.goals.filter(g => g.status === 'active').length;
  $('#kpi-areas').textContent = S.areas.filter(a => !a.archived).length;
  $('#kpi-done').textContent = doneTasks.length;

  // Dropdown Selectors for Creation forms
  const selAreaOpts =
    `<option value="">— Seleccionar Área —</option>` +
    S.areas
      .filter(a => !a.archived)
      .map(a => `<option value="${a.id}">📂 ${esc(a.name)}</option>`)
      .join('');
  const selGoalOpts =
    `<option value="">— Seleccionar Meta —</option>` +
    S.goals
      .filter(g => g.status === 'active')
      .map(g => `<option value="${g.id}">🎯 ${esc(g.title)}</option>`)
      .join('');

  $$('.sel-area').forEach(e => (e.innerHTML = selAreaOpts));
  $$('.sel-goal').forEach(e => (e.innerHTML = selGoalOpts));

  // ---------- Focus Hero ----------
  const topActive = activeTasks.slice(0, 3);
  if (topActive.length) {
    const mainTask = topActive[0];
    const goal = S.goals.find(g => g.id === mainTask.goal_id);
    const area = S.areas.find(a => a.id === (mainTask.area_id || goal?.area_id));

    const subTasksHtml =
      topActive.length > 1
        ? `<div class="focus-sublist">
            <span>Siguientes:</span>
            ${topActive
              .slice(1)
              .map(
                st => `
              <span class="focus-chip" data-quick-focus="${st.id}">
                ${st.priority >= 20 ? '🔥' : '⚡'} <b>${esc(st.title)}</b>
                <span class="pill-priority ${st.priority >= 20 ? 'hi' : ''}">${st.priority}</span>
              </span>`
              )
              .join('')}
          </div>`
        : '';

    $('#focus').innerHTML = `
      <div class="focus-hero">
        <div class="focus-header">
          <div class="focus-badge">🎯 Foco Prioritario Actual</div>
          <span class="pill-priority ${mainTask.priority >= 20 ? 'hi' : ''}">Score: ${mainTask.priority}</span>
        </div>
        <div class="focus-content">
          <div class="focus-main">
            <div class="focus-title">${esc(mainTask.title)}</div>
            <div class="focus-meta">
              ${area ? `<span class="badge">📂 ${esc(area.name)}</span>` : ''}
              ${goal ? `<span class="badge active">🎯 ${esc(goal.title)}</span>` : ''}
              <span class="badge">⚡ Urgencia: ${mainTask.urgency}/5</span>
              ${mainTask.snooze_count ? `<span class="pill-snz">⏭️ ${mainTask.snooze_count} pospuestas</span>` : ''}
            </div>
          </div>
          <div class="focus-actions">
            <button class="btn btn-emerald btn-sm" data-toggle-done="${mainTask.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Marcar Hecha
            </button>
            <button class="btn btn-outline btn-sm" data-quick-snooze="${mainTask.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
              Posponer
            </button>
          </div>
        </div>
        ${subTasksHtml}
      </div>`;
  } else {
    $('#focus').innerHTML = `
      <div class="focus-hero">
        <div class="focus-empty">
          <span style="font-size:24px;">☕</span>
          <div>
            <b>Todo al día y en calma</b>
            <div class="muted" style="font-size:12px;">No tienes tareas activas inmediatas. Puedes capturar una nueva tarea arriba.</div>
          </div>
        </div>
      </div>`;
  }

  // ---------- Tree Filtering ----------
  let filteredTasks = openTasks;
  if (activeFilter === 'active') {
    filteredTasks = openTasks.filter(t => t.status === 'active' || t.status === 'inbox');
  } else if (activeFilter === 'done') {
    filteredTasks = openTasks.filter(t => t.status === 'done');
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredTasks = filteredTasks.filter(t => t.title.toLowerCase().includes(q));
  }

  // ---------- Goal Block ----------
  const goalBlock = g => {
    const goalTasks = filteredTasks.filter(t => t.goal_id === g.id);
    const allGoalTasks = openTasks.filter(t => t.goal_id === g.id);
    const completedCount = allGoalTasks.filter(t => t.status === 'done').length;
    const totalCount = allGoalTasks.length;
    const percent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

    // If searching and this goal has no matching tasks and title doesn't match query, skip
    if (searchQuery.trim()) {
      const matchGoalTitle = g.title.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchGoalTitle && goalTasks.length === 0) return '';
    }

    return `
      <div class="goal" data-gid="${g.id}">
        <div class="goal-header">
          <div class="goal-title-wrap">
            <span class="goal-icon">🎯</span>
            <span class="goal-name" contenteditable="true" data-gf="title" spellcheck="false">${esc(g.title)}</span>
          </div>

          <div class="goal-meta-group">
            ${
              totalCount > 0
                ? `<div class="goal-progress" title="${completedCount} de ${totalCount} tareas completadas (${percent}%)">
                    <div class="progress-track"><div class="progress-fill" style="width: ${percent}%;"></div></div>
                    <span>${completedCount}/${totalCount}</span>
                  </div>`
                : ''
            }

            <select class="task-select" data-gf="priority" title="Prioridad de la meta">
              <option value="1" ${g.priority === 1 ? 'selected' : ''}>P1 · Baja</option>
              <option value="2" ${g.priority === 2 ? 'selected' : ''}>P2 · Media</option>
              <option value="3" ${g.priority === 3 ? 'selected' : ''}>P3 · Normal</option>
              <option value="4" ${g.priority === 4 ? 'selected' : ''}>P4 · Alta</option>
              <option value="5" ${g.priority === 5 ? 'selected' : ''}>P5 · Clave</option>
            </select>

            <select class="task-select" data-gf="status" title="Estado de la meta">
              ${opts(GSTATUS, g.status)}
            </select>

            <button class="icon-btn" data-quick-task="${g.id}" title="Añadir tarea a esta meta">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>

            <button class="icon-btn danger" data-gdel title="Eliminar meta (tareas quedarán sin meta)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
        </div>

        <div class="goal-tasks">
          ${goalTasks.map(taskRow).join('') || (activeFilter === 'all' && !searchQuery ? `<div class="goal-empty-tasks"><span>Sin tareas en esta meta</span><button class="btn btn-ghost btn-sm" data-quick-task="${g.id}">+ Sumar tarea</button></div>` : '')}
        </div>
      </div>`;
  };

  // ---------- Area Block ----------
  const areasHtml = S.areas
    .map(a => {
      const areaGoals = S.goals.filter(g => g.area_id === a.id);
      const directTasks = filteredTasks.filter(t => t.area_id === a.id && !t.goal_id);
      const totalAreaTasks = openTasks.filter(t => t.area_id === a.id || areaGoals.some(g => g.id === t.goal_id));
      const isCollapsed = collapsedAreas.has(String(a.id));

      const renderedGoals = areaGoals.map(goalBlock).join('');
      const renderedDirect = directTasks.map(taskRow).join('');

      // If searching and nothing matches in this area, hide it
      if (searchQuery.trim() && !renderedGoals && !renderedDirect && !a.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return '';
      }

      return `
        <div class="area ${a.archived ? 'archived' : ''} ${isCollapsed ? 'collapsed' : ''}" data-aid="${a.id}">
          <div class="area-header">
            <div class="area-title-wrap">
              <button class="collapse-btn" data-toggle-collapse="${a.id}" title="Colapsar / Expandir">▼</button>
              <span class="area-icon">📂</span>
              <span class="area-name" contenteditable="true" data-af="name" spellcheck="false">${esc(a.name)}</span>
              <span class="area-count-badge">${areaGoals.length} metas · ${totalAreaTasks.length} tareas</span>
            </div>

            <div class="area-badge-group">
              <select class="task-select" data-af="weight" title="Importancia del área (1-5)">
                <option value="1" ${a.weight === 1 ? 'selected' : ''}>Peso 1 · Ocasional</option>
                <option value="2" ${a.weight === 2 ? 'selected' : ''}>Peso 2 · Bajo</option>
                <option value="3" ${a.weight === 3 ? 'selected' : ''}>Peso 3 · Regular</option>
                <option value="4" ${a.weight === 4 ? 'selected' : ''}>Peso 4 · Importante</option>
                <option value="5" ${a.weight === 5 ? 'selected' : ''}>Peso 5 · Crítica</option>
              </select>

              <button class="btn btn-outline btn-sm" data-quick-goal="${a.id}" title="Crear nueva meta en esta área">
                + Meta
              </button>

              <button class="btn btn-outline btn-sm" data-aarch title="${a.archived ? 'Restaurar área' : 'Archivar área'}">
                ${a.archived ? '📤 Restaurar' : '📦 Archivar'}
              </button>

              <button class="icon-btn danger" data-adel title="Eliminar área">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          </div>

          <div class="area-body">
            ${renderedGoals}
            ${renderedDirect}
          </div>
        </div>`;
    })
    .join('');

  // ---------- Orphan Goals & Tasks ----------
  const orphanGoals = S.goals.filter(g => !g.area_id);
  const orphanTasks = filteredTasks.filter(t => !t.area_id && !t.goal_id);
  const orphan =
    orphanGoals.length || orphanTasks.length
      ? `<div class="area">
          <div class="area-header">
            <div class="area-title-wrap">
              <span class="area-icon">📌</span>
              <span class="area-name muted">Sin área asignada</span>
            </div>
          </div>
          <div class="area-body">
            ${orphanGoals.map(goalBlock).join('')}
            ${orphanTasks.map(taskRow).join('')}
          </div>
        </div>`
      : '';

  $('#tree').innerHTML =
    areasHtml + orphan ||
    `<div style="text-align:center; padding: 40px; color: var(--text-muted);">
      <p style="font-size:16px; margin-bottom:8px;">🔍 No se encontraron elementos</p>
      <p style="font-size:13px;">Prueba ajustando los filtros o el término de búsqueda.</p>
    </div>`;

  // ---------- Freezer Tab ----------
  if (frozenTasks.length) {
    $('#freezer').innerHTML = `
      <div class="freezer-card">
        ${frozenTasks
          .map(
            t => `
          <div class="freezer-item" data-id="${t.id}">
            <span class="pill-priority ${t.priority >= 20 ? 'hi' : ''}">${t.priority}</span>
            <div class="freezer-item-title">${esc(t.title)}</div>
            <div class="freezer-item-meta">
              <span class="badge ${t.status === 'backlog' ? 'paused' : ''}">${STATUS[t.status] || t.status}</span>
              <button class="btn btn-primary btn-sm" data-reactivate="${t.id}">
                ⚡ Reactivar
              </button>
              <button class="icon-btn danger" data-del="tasks" title="Eliminar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>`;
  } else {
    $('#freezer').innerHTML = `
      <div class="freezer-card" style="text-align:center; padding: 40px; color: var(--text-muted);">
        <p style="font-size:20px; margin-bottom:6px;">🧊</p>
        <p style="font-size:15px; font-weight:600; color:var(--text-main); margin-bottom:4px;">El congelador está vacío</p>
        <p style="font-size:13px; margin:0;">No hay tareas en pausa o descartadas acumuladas.</p>
      </div>`;
  }

  // ---------- Sistema Tab ----------
  const c = S.config;
  $('#c-hours').value = c.checkin_hours.join(', ');
  $('#c-max').value = c.max_daily_pings;
  $('#c-ignore').value = c.ignore_limit;
  $('#c-ahour').value = c.analysis_hour;

  const today = new Date().toLocaleDateString('sv');
  const dndActive = c.dnd_until && c.dnd_until > new Date().toLocaleString('sv');
  const pausedFatigue = c.paused_date === today;

  const statusBadge = $('#c-status-badge');
  if (dndActive) {
    statusBadge.textContent = '🔕 No molestar';
    statusBadge.className = 'badge paused';
  } else if (pausedFatigue) {
    statusBadge.textContent = '😴 Pausado hoy';
    statusBadge.className = 'badge paused';
  } else {
    statusBadge.textContent = '🔔 Activo';
    statusBadge.className = 'badge active';
  }

  $('#c-state').textContent =
    [dndActive ? `🔕 Modo No Molestar activo hasta ${c.dnd_until}` : '', pausedFatigue ? '😴 Recordatorios pausados por hoy debido a fatiga' : '']
      .filter(Boolean)
      .join(' · ') || '🔔 Recordatorios y notificaciones operando normalmente.';

  const la = c.last_analysis;
  $('#analysis').textContent = la
    ? `[${la.at}] Origen: ${la.source}\n\n${la.digest}\n\n${(la.changes || []).map(ch => `• ${ch}`).join('\n')}`
    : 'No se ha ejecutado ninguna retrospectiva aún.\nHaz clic en "Ejecutar retrospectiva" para iniciarla.';

  // Hourly Chart
  const byH = Object.fromEntries(S.telemetry.byHour.map(r => [r.hour, r]));
  const maxVal = Math.max(1, ...S.telemetry.byHour.map(r => r.respondidos + r.mensajes));
  $('#chart').innerHTML = Array.from({ length: 16 }, (_, i) => i + 7)
    .map(h => {
      const r = byH[h] || { pings: 0, respondidos: 0, mensajes: 0 };
      const v = r.respondidos + r.mensajes;
      const isCheckin = c.checkin_hours.includes(h);
      const heightPercent = Math.max(3, (v / maxVal) * 100);
      return `
        <div class="col ${isCheckin ? 'sel' : ''}" title="${h}:00 hs · ${r.respondidos}/${r.pings} pings respondidos · ${r.mensajes} mensajes recibidos">
          <div class="barv" style="height:${heightPercent}%"></div>
          <span class="col-hour">${h}</span>
        </div>`;
    })
    .join('');

  // Logs Table
  if (S.telemetry.recent.length) {
    $('#logs').innerHTML = `
      <thead>
        <tr>
          <th>Fecha y Hora</th>
          <th>Tipo</th>
          <th>Respuesta / Contenido</th>
          <th>Respondido a las</th>
        </tr>
      </thead>
      <tbody>
        ${S.telemetry.recent
          .map(
            l => `
          <tr>
            <td style="font-family:var(--font-mono); font-size:11px;">${l.sent_at}</td>
            <td><span class="chip-kind ${l.kind}">${l.kind}</span></td>
            <td>${l.response ? esc(l.response) : l.kind === 'ping' ? '<span class="muted">sin respuesta</span>' : '—'}</td>
            <td style="font-family:var(--font-mono); font-size:11px;">${l.responded_at ?? '—'}</td>
          </tr>`
          )
          .join('')}
      </tbody>`;
  } else {
    $('#logs').innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center; padding:18px;">Sin registros de interacción aún.</td></tr>`;
  }
}

// ---------- Main Load ----------
async function load() {
  S = await api('GET', '/api/state');
  render();
}

// ---------- Event Handling ----------
const formData = f => Object.fromEntries(new FormData(f));

$('#f-area').onsubmit = async e => {
  e.preventDefault();
  const data = formData(e.target);
  await act('POST', '/api/areas', data);
  e.target.reset();
  showToast(`📂 Área <b>"${esc(data.name)}"</b> creada.`);
};

$('#f-goal').onsubmit = async e => {
  e.preventDefault();
  const data = formData(e.target);
  await act('POST', '/api/goals', data);
  e.target.reset();
  showToast(`🎯 Meta <b>"${esc(data.title)}"</b> creada.`);
};

$('#f-task').onsubmit = async e => {
  e.preventDefault();
  const data = formData(e.target);
  await act('POST', '/api/tasks', data);
  e.target.reset();
  showToast(`⚡ Tarea <b>"${esc(data.title)}"</b> agregada.`);
};

// Filter pills
$$('.pill-filter').forEach(btn => {
  btn.onclick = () => {
    $$('.pill-filter').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    activeFilter = btn.dataset.filter;
    render();
  };
});

// Search input
$('#search-input').oninput = e => {
  searchQuery = e.target.value;
  $('#search-clear').style.display = searchQuery ? 'inline-flex' : 'none';
  render();
};

$('#search-clear').onclick = () => {
  $('#search-input').value = '';
  searchQuery = '';
  $('#search-clear').style.display = 'none';
  render();
};

// Toggle all collapse
let allCollapsed = false;
$('#btn-toggle-all').onclick = () => {
  allCollapsed = !allCollapsed;
  if (allCollapsed) {
    S.areas.forEach(a => collapsedAreas.add(String(a.id)));
    $('#btn-toggle-all').textContent = '↕ Expandir todo';
  } else {
    collapsedAreas.clear();
    $('#btn-toggle-all').textContent = '↕ Colapsar todo';
  }
  localStorage.setItem('superyo_collapsed', JSON.stringify([...collapsedAreas]));
  render();
};

// Dynamic Field Changes
document.addEventListener('change', async e => {
  const el = e.target;
  const val = el.value === '' ? null : el.value;

  if (el.dataset.f) {
    const taskId = el.closest('.task').dataset.id;
    await act('PATCH', `/api/tasks/${taskId}`, { [el.dataset.f]: val });
    showToast('Tarea actualizada');
  }
  if (el.dataset.gf) {
    const goalId = el.closest('.goal').dataset.gid;
    await act('PATCH', `/api/goals/${goalId}`, { [el.dataset.gf]: val });
    showToast('Meta actualizada');
  }
  if (el.dataset.af) {
    const areaId = el.closest('.area').dataset.aid;
    await act('PATCH', `/api/areas/${areaId}`, { [el.dataset.af]: val });
    showToast('Área actualizada');
  }
});

// Editable Content Focusout
document.addEventListener('focusout', async e => {
  const el = e.target;
  if (!el.isContentEditable) return;
  const text = el.textContent.trim();
  if (!text) return load();

  if (el.dataset.f) {
    await act('PATCH', `/api/tasks/${el.closest('.task').dataset.id}`, { title: text });
    showToast('Título de tarea actualizado');
  }
  if (el.dataset.gf) {
    await act('PATCH', `/api/goals/${el.closest('.goal').dataset.gid}`, { title: text });
    showToast('Título de meta actualizado');
  }
  if (el.dataset.af) {
    await act('PATCH', `/api/areas/${el.closest('.area').dataset.aid}`, { name: text });
    showToast('Nombre de área actualizado');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.isContentEditable) {
    e.preventDefault();
    e.target.blur();
  }
});

// Click Delegations
document.addEventListener('click', async e => {
  const el = e.target.closest('button, .focus-chip');
  if (!el) return;

  // Quick focus from sublist
  if (el.hasAttribute('data-quick-focus')) {
    const tid = el.dataset.quickFocus;
    const taskEl = document.querySelector(`.task[data-id="${tid}"]`);
    if (taskEl) {
      taskEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      taskEl.style.transition = 'box-shadow 0.3s, background 0.3s';
      taskEl.style.boxShadow = '0 0 0 2px var(--blue)';
      taskEl.style.background = 'rgba(59, 130, 246, 0.15)';
      setTimeout(() => {
        taskEl.style.boxShadow = '';
        taskEl.style.background = '';
      }, 1500);
    }
    return;
  }

  // Toggle Collapse on Area
  if (el.dataset.toggleCollapse) {
    const aid = String(el.dataset.toggleCollapse);
    if (collapsedAreas.has(aid)) {
      collapsedAreas.delete(aid);
    } else {
      collapsedAreas.add(aid);
    }
    localStorage.setItem('superyo_collapsed', JSON.stringify([...collapsedAreas]));
    render();
    return;
  }

  // Toggle Done Task Checkbox
  if (el.hasAttribute('data-toggle-done')) {
    const tid = el.dataset.toggleDone;
    const task = S.tasks.find(t => String(t.id) === String(tid));
    if (!task) return;
    const nextStatus = task.status === 'done' ? 'active' : 'done';
    await act('PATCH', `/api/tasks/${tid}`, { status: nextStatus });
    showToast(nextStatus === 'done' ? '🎉 Tarea completada!' : 'Tarea reactivada como activa');
    return;
  }

  // Quick Snooze
  if (el.hasAttribute('data-quick-snooze')) {
    const tid = el.dataset.quickSnooze;
    const task = S.tasks.find(t => String(t.id) === String(tid));
    if (!task) return;
    const count = (task.snooze_count || 0) + 1;
    await act('PATCH', `/api/tasks/${tid}`, { snooze_count: count });
    showToast(`⏭️ Tarea pospuesta (cuenta: ${count})`);
    return;
  }

  // Reactivate Frozen Task
  if (el.hasAttribute('data-reactivate')) {
    const tid = el.dataset.reactivate;
    await act('PATCH', `/api/tasks/${tid}`, { status: 'active' });
    showToast('⚡ Tarea reactivada en la Jerarquía');
    return;
  }

  // Quick Goal from Area header
  if (el.hasAttribute('data-quick-goal')) {
    const aid = el.dataset.quickGoal;
    const tabBtn = $('[data-create-tab="goal"]');
    if (tabBtn) tabBtn.click();
    const areaSel = $('#f-goal .sel-area');
    if (areaSel) areaSel.value = aid;
    const gInput = $('#g-title');
    if (gInput) {
      gInput.focus();
      gInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  // Quick Task from Goal header
  if (el.hasAttribute('data-quick-task')) {
    const gid = el.dataset.quickTask;
    const tabBtn = $('[data-create-tab="task"]');
    if (tabBtn) tabBtn.click();
    const goalSel = $('#f-task .sel-goal');
    if (goalSel) goalSel.value = gid;
    const tInput = $('#t-title');
    if (tInput) {
      tInput.focus();
      tInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  // Delete Task
  if (el.dataset.del && confirm('¿Eliminar esta tarea?')) {
    const taskRow = el.closest('.task, .freezer-item');
    if (taskRow) {
      await act('DELETE', `/api/tasks/${taskRow.dataset.id}`);
      showToast('Tarea eliminada');
    }
    return;
  }

  // Delete Goal
  if (el.hasAttribute('data-gdel') && confirm('¿Eliminar meta? (Las tareas permanecerán sin meta)')) {
    const goalEl = el.closest('.goal');
    if (goalEl) {
      await act('DELETE', `/api/goals/${goalEl.dataset.gid}`);
      showToast('Meta eliminada');
    }
    return;
  }

  // Delete Area
  if (el.hasAttribute('data-adel') && confirm('¿Eliminar área por completo?')) {
    const areaEl = el.closest('.area');
    if (areaEl) {
      await act('DELETE', `/api/areas/${areaEl.dataset.aid}`);
      showToast('Área eliminada');
    }
    return;
  }

  // Archive / Restore Area
  if (el.hasAttribute('data-aarch')) {
    const a = S.areas.find(x => String(x.id) === String(el.closest('.area').dataset.aid));
    if (a) {
      await act('PATCH', `/api/areas/${a.id}`, { archived: a.archived ? 0 : 1 });
      showToast(a.archived ? 'Área restaurada' : 'Área archivada');
    }
    return;
  }
});

// Purge Dropped
$('#purge').onclick = async () => {
  if (confirm('¿Eliminar definitivamente todas las tareas descartadas?')) {
    const res = await api('POST', '/api/tasks/purge-dropped');
    await load();
    showToast(`🗑️ ${res.deleted || 0} tareas eliminadas definitivamente.`);
  }
};

// Save Config
$('#save-cfg').onclick = async () => {
  const hours = $('#c-hours')
    .value.split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 23)
    .sort((a, b) => a - b);

  await act('PATCH', '/api/config', {
    checkin_hours: hours,
    max_daily_pings: Number($('#c-max').value),
    ignore_limit: Number($('#c-ignore').value),
    analysis_hour: Number($('#c-ahour').value),
  });
  showToast('⚙️ Configuración del sistema guardada con éxito.');
};

// Resume Today
$('#resume').onclick = async () => {
  await act('PATCH', '/api/config', { dnd_until: null, paused_date: null });
  showToast('🔔 Recordatorios reanudados para hoy.');
};

// Analyze CLI Agent
$('#analyze').onclick = async e => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = '🧠 Analizando…';
  try {
    await act('POST', '/api/analyze');
    showToast('🧠 Análisis retrospectivo completado.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ejecutar retrospectiva';
  }
};

// Initialize & auto-refresh
load();
setInterval(() => {
  if (!document.activeElement?.isContentEditable && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
    load();
  }
}, 30000);

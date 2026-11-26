/* =====================================================================
   TASKFLOW – Calendar (calendar.html)
   Month / week / day views of tasks by due date. Only the visible date
   range is fetched from Supabase.
   ===================================================================== */

const cal = {
  view: 'month', // 'month' | 'week' | 'day'
  cursor: new Date(), // a date inside the visible period
  selected: todayStr(), // YYYY-MM-DD shown in the side panel
  tasks: [],
};

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await initProtectedPage('calendar', { title: 'Calendar', subtitle: 'See your tasks by due date' });
  if (!ready) return;

  const saved = sessionStorage.getItem('tf-cal-view');
  if (['month', 'week', 'day'].includes(saved)) cal.view = saved;

  $('#calPrev').addEventListener('click', () => move(-1));
  $('#calNext').addEventListener('click', () => move(1));
  $('#calToday').addEventListener('click', () => {
    cal.cursor = new Date();
    cal.selected = todayStr();
    loadCalendar();
  });
  $$('[data-cal-view]').forEach((b) =>
    b.addEventListener('click', () => {
      cal.view = b.dataset.calView;
      cal.cursor = parseDate(cal.selected);
      sessionStorage.setItem('tf-cal-view', cal.view);
      loadCalendar();
    })
  );
  $('#panelAdd').addEventListener('click', () => addOn(cal.selected));

  // Clicks inside the calendar: select a day, open a task or add on a date
  $('#calView').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return addOn(add.dataset.add);
    const taskEl = e.target.closest('[data-task]');
    if (taskEl) {
      const t = cal.tasks.find((x) => x.id === taskEl.dataset.task);
      if (t) {
        if (t.due_date !== cal.selected && cal.view !== 'day') {
          cal.selected = t.due_date;
          render();
        }
        return openTaskDetails(t, loadCalendar);
      }
    }
    const day = e.target.closest('[data-date]');
    if (day) selectDate(day.dataset.date);
  });
  bindTaskList($('#panelList'), () => cal.tasks, loadCalendar);
  window.onTasksChanged = loadCalendar;

  // Keyboard: ← → move between periods
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, .modal-overlay')) return;
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  });

  revealContent();
  await loadCalendar();
});

function addOn(date) {
  openTaskModal({ defaults: { due_date: date }, onSaved: loadCalendar });
}

function move(step) {
  const d = new Date(cal.cursor);
  if (cal.view === 'month') {
    d.setDate(1);
    d.setMonth(d.getMonth() + step);
  } else d.setDate(d.getDate() + step * (cal.view === 'week' ? 7 : 1));
  cal.cursor = d;
  // keep the side panel on a date inside the newly visible period
  if (cal.view === 'day') cal.selected = toDateStr(d);
  else {
    const first = cal.view === 'week' ? startOfWeek(d) : new Date(d.getFullYear(), d.getMonth(), 1);
    const last = cal.view === 'week' ? addDays(first, 6) : new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const today = todayStr();
    cal.selected = today >= toDateStr(first) && today <= toDateStr(last) ? today : toDateStr(first);
  }
  loadCalendar();
}

function selectDate(date) {
  cal.selected = date;
  if (cal.view === 'month' && parseDate(date).getMonth() !== cal.cursor.getMonth()) {
    cal.cursor = parseDate(date);
    return loadCalendar();
  }
  render();
}

/** First and last date shown for the current view. */
function visibleRange() {
  if (cal.view === 'day') return [cal.cursor, cal.cursor];
  if (cal.view === 'week') {
    const s = startOfWeek(cal.cursor);
    return [s, addDays(s, 6)];
  }
  const first = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth(), 1);
  const start = startOfWeek(first);
  return [start, addDays(start, 41)]; // 6-week grid
}

async function loadCalendar() {
  const [from, to] = visibleRange();
  $('#calView').setAttribute('aria-busy', 'true');
  try {
    cal.tasks = await fetchTasksInRange(toDateStr(from), toDateStr(to));
  } catch (err) {
    toast(`Could not load calendar: ${err.message}`, 'error');
    cal.tasks = [];
  }
  $('#calView').removeAttribute('aria-busy');
  render();
}

const tasksOn = (date) => cal.tasks.filter((t) => t.due_date === date).sort(compareByDue);
const colorOf = (t) => (t.category ? t.category.color : '#7c5cff');

function render() {
  $$('[data-cal-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.calView === cal.view);
    b.setAttribute('aria-selected', b.dataset.calView === cal.view);
  });
  if (cal.view === 'month') renderMonth();
  else if (cal.view === 'week') renderWeek();
  else renderDay();
  renderPanel();
  refreshIcons();
}

function renderMonth() {
  $('#calTitle').textContent = cal.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const [start] = visibleRange();
  const month = cal.cursor.getMonth();
  const today = todayStr();
  const weekdays = [...Array(7)].map((_, i) => addDays(start, i).toLocaleDateString(undefined, { weekday: 'short' }));

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const key = toDateStr(d);
    const list = tasksOn(key);
    const cls = [d.getMonth() !== month && 'other-month', key === today && 'today', key === cal.selected && 'selected']
      .filter(Boolean)
      .join(' ');
    cells += `
      <div class="cal-day ${cls}" data-date="${key}" role="gridcell" tabindex="0"
        aria-label="${d.toLocaleDateString(undefined, { dateStyle: 'full' })}, ${list.length} task${list.length === 1 ? '' : 's'}">
        <span class="cal-num">${d.getDate()}</span>
        ${list
          .slice(0, 3)
          .map((t) => `<span class="cal-pill ${t.status === 'completed' ? 'done' : ''}" style="--c:${escapeHtml(colorOf(t))}" data-task="${t.id}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>`)
          .join('')}
        ${list.length > 3 ? `<span class="cal-more">+${list.length - 3} more</span>` : ''}
        ${list.length ? `<span class="cal-dots">${list.slice(0, 4).map((t) => `<i style="--c:${escapeHtml(colorOf(t))}"></i>`).join('')}</span>` : ''}
      </div>`;
  }
  $('#calView').innerHTML = `
    <div class="cal-weekdays" role="row">${weekdays.map((w) => `<div role="columnheader">${w}</div>`).join('')}</div>
    <div class="cal-grid" role="grid">${cells}</div>`;
  bindDayKeys();
}

function renderWeek() {
  const [start, end] = visibleRange();
  const sameMonth = start.getMonth() === end.getMonth();
  $('#calTitle').textContent = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
  const today = todayStr();
  let cols = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const key = toDateStr(d);
    const list = tasksOn(key);
    cols += `
      <div class="week-col ${key === today ? 'today' : ''} ${key === cal.selected ? 'selected' : ''}">
        <button class="week-head" data-date="${key}"><small>${d.toLocaleDateString(undefined, { weekday: 'short' })}</small><strong>${d.getDate()}</strong></button>
        <div class="week-body">
          ${list
            .map(
              (t) => `<button class="week-task ${t.status === 'completed' ? 'done' : ''}" style="--c:${escapeHtml(colorOf(t))}" data-task="${t.id}">
                <strong>${escapeHtml(t.title)}</strong><small>${t.due_time ? formatTime(t.due_time) : 'Any time'} · ${PRIORITY[t.priority].label}</small></button>`
            )
            .join('')}
          <button class="week-add" data-add="${key}" aria-label="Add task on ${d.toLocaleDateString(undefined, { dateStyle: 'medium' })}"><i data-lucide="plus"></i></button>
        </div>
      </div>`;
  }
  $('#calView').innerHTML = `<div class="week-grid">${cols}</div>`;
}

function renderDay() {
  const key = toDateStr(cal.cursor);
  cal.selected = key;
  $('#calTitle').textContent = cal.cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const list = tasksOn(key);
  if (!list.length) {
    $('#calView').innerHTML = `<div class="day-view">${emptyStateHTML({
      icon: 'calendar-plus',
      title: 'No tasks on this day',
      text: 'Add a task to plan this day.',
      action: `<button class="btn btn-primary btn-sm" data-add="${key}"><i data-lucide="plus"></i>Add task</button>`,
    })}</div>`;
    return;
  }
  // Group by time: "All day" first, then each time slot
  const groups = {};
  list.forEach((t) => {
    const k = t.due_time ? t.due_time.slice(0, 5) : '';
    (groups[k] = groups[k] || []).push(t);
  });
  $('#calView').innerHTML = `<div class="day-view"><ul class="day-timeline">
    ${Object.keys(groups)
      .sort()
      .map(
        (k) => `<li class="day-slot"><span class="day-time">${k ? formatTime(k) : 'Any time'}</span>
          <div class="week-body" style="padding:0">${groups[k]
            .map(
              (t) => `<button class="week-task ${t.status === 'completed' ? 'done' : ''}" style="--c:${escapeHtml(colorOf(t))}" data-task="${t.id}">
                <strong>${escapeHtml(t.title)}</strong><small>${STATUS[t.status].label} · ${PRIORITY[t.priority].label}${t.category ? ' · ' + escapeHtml(t.category.name) : ''}</small></button>`
            )
            .join('')}</div></li>`
      )
      .join('')}
    </ul></div>`;
}

/** Side panel: the selected date's tasks with full actions. */
function renderPanel() {
  const d = parseDate(cal.selected);
  $('#panelTitle').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const list = tasksOn(cal.selected);
  $('#panelSub').textContent = `${list.length} task${list.length === 1 ? '' : 's'}${
    list.length ? ` · ${list.filter((t) => t.status === 'completed').length} done` : ''
  }`;
  $('#panelList').innerHTML =
    list.length
      ? `<ul class="task-list">${list.map((t) => taskItemHTML(t, { compact: true })).join('')}</ul>`
      : emptyStateHTML({ icon: 'calendar-plus', title: 'Free day', text: 'No tasks due on this date.' });
}

/** Enter/Space selects a focused month cell. */
function bindDayKeys() {
  $$('.cal-day').forEach((cell) =>
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectDate(cell.dataset.date);
      }
    })
  );
}
/* =====================================================================
   TASKFLOW – Productivity analytics (analytics.html)
   All charts are computed from the user's tasks in Supabase, using
   completed_at (set by a database trigger) for productivity over time.
   ===================================================================== */

let anTasks = [];

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await initProtectedPage('analytics', { title: 'Analytics', subtitle: 'Understand how you work' });
  if (!ready) return;
  window.onTasksChanged = loadAnalytics;
  revealContent();
  await loadAnalytics();
});

async function loadAnalytics() {
  $('#kpis').innerHTML = '<div class="card skeleton" style="height:110px"></div>'.repeat(5);
  try {
    anTasks = await fetchAllTasks();
  } catch (err) {
    toast(`Could not load analytics: ${err.message}`, 'error');
    $('#kpis').innerHTML = '';
    return;
  }
  renderKpis();
  renderDaily();
  renderCompletion();
  renderWeeklyTrend();
  renderMonthly();
  renderPriorityBreakdown();
  renderCategoryBreakdown();
  refreshIcons();
}

/** Local YYYY-MM-DD of each completion. */
const completionDays = () => anTasks.filter((t) => t.completed_at).map((t) => toDateStr(new Date(t.completed_at)));

function countBetween(days, from, to) {
  return days.filter((d) => d >= from && d <= to).length;
}

function renderKpis() {
  const days = completionDays();
  const today = new Date();
  const ws = startOfWeek(today);
  const thisWeek = countBetween(days, toDateStr(ws), todayStr());
  const lastWeek = countBetween(days, toDateStr(addDays(ws, -7)), toDateStr(addDays(ws, -1)));
  const monthStart = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const thisMonth = countBetween(days, monthStart, todayStr());
  const total = anTasks.length;
  const done = anTasks.filter((t) => t.status === 'completed').length;

  // Streak: consecutive days (ending today or yesterday) with ≥1 completion
  const set = new Set(days);
  let streak = 0;
  let d = set.has(todayStr()) ? today : addDays(today, -1);
  while (set.has(toDateStr(d))) {
    streak++;
    d = addDays(d, -1);
  }

  const delta = thisWeek - lastWeek;
  const kpi = (tone, icon, label, value, sub) => `
    <div class="card stat-card ${tone}">
      <div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon"><i data-lucide="${icon}"></i></span></div>
      <span class="stat-value">${value}</span><span class="kpi-sub">${sub}</span>
    </div>`;
  $('#kpis').innerHTML =
    kpi('tone-green', 'check-circle-2', 'Total Completed', done, `of ${total} task${total === 1 ? '' : 's'}`) +
    kpi('tone-purple', 'percent', 'Completion Rate', `${total ? Math.round((done / total) * 100) : 0}%`, 'all time') +
    kpi('tone-blue', 'calendar-range', 'This Week', thisWeek, delta === 0 ? 'same as last week' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs last week`) +
    kpi('tone-amber', 'calendar', 'This Month', thisMonth, 'tasks completed') +
    kpi('tone-red', 'flame', 'Current Streak', `${streak}d`, streak ? 'days in a row' : 'complete a task today');
}

function renderDaily() {
  const days = completionDays();
  const data = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    const key = toDateStr(d);
    data.push({
      label: i % 2 === 0 || window.innerWidth > 700 ? String(d.getDate()) : '',
      title: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      value: days.filter((x) => x === key).length,
      highlight: i === 0,
    });
  }
  renderBarChart($('#dailyChart'), data, { unit: 'completed' });
}

function renderWeeklyTrend() {
  const days = completionDays();
  const ws = startOfWeek(new Date());
  const data = [];
  for (let i = 7; i >= 0; i--) {
    const start = addDays(ws, -7 * i);
    const end = addDays(start, 6);
    data.push({
      label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      title: `Week of ${start.toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
      value: countBetween(days, toDateStr(start), toDateStr(end)),
      highlight: i === 0,
    });
  }
  renderBarChart($('#weeklyChart'), data, { unit: 'completed' });
}

function renderMonthly() {
  const days = completionDays();
  const now = new Date();
  const data = [];
  for (let i = 5; i >= 0; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    data.push({
      label: first.toLocaleDateString(undefined, { month: 'short' }),
      title: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      value: countBetween(days, toDateStr(first), toDateStr(last)),
      highlight: i === 0,
    });
  }
  renderBarChart($('#monthlyChart'), data, { unit: 'completed' });
}

function renderCompletion() {
  const total = anTasks.length;
  const done = anTasks.filter((t) => t.status === 'completed').length;
  renderRing($('#completionRing'), total ? Math.round((done / total) * 100) : 0, 'complete');
  $('#statusMeta').innerHTML = `
    <div><strong>${done}</strong><small>Done</small></div>
    <div><strong>${anTasks.filter((t) => t.status === 'in_progress').length}</strong><small>In progress</small></div>
    <div><strong>${anTasks.filter(isOverdue).length}</strong><small>Overdue</small></div>`;
}

function renderPriorityBreakdown() {
  if (!anTasks.length) {
    $('#priorityChart').innerHTML = emptyStateHTML({ icon: 'flag', title: 'No data yet', text: 'Create tasks to see your priority mix.' });
    return;
  }
  renderDonut(
    $('#priorityChart'),
    ['high', 'medium', 'low'].map((p) => ({ label: PRIORITY[p].label, value: anTasks.filter((t) => t.priority === p).length, color: PRIORITY_COLORS[p] })),
    'tasks'
  );
}

function renderCategoryBreakdown() {
  const groups = App.categories.map((c) => ({ name: c.name, color: c.color, tasks: anTasks.filter((t) => t.category_id === c.id) }));
  const none = anTasks.filter((t) => !t.category_id);
  if (none.length) groups.push({ name: 'No category', color: '#94a3b8', tasks: none });
  const used = groups.filter((g) => g.tasks.length).sort((a, b) => b.tasks.length - a.tasks.length);
  if (!used.length) {
    $('#categoryChart').innerHTML = emptyStateHTML({ icon: 'tags', title: 'No data yet', text: 'Assign categories to tasks to compare them here.' });
    return;
  }
  const max = Math.max(...used.map((g) => g.tasks.length));
  $('#categoryChart').innerHTML = `<ul class="hbar-list">${used
    .map((g) => {
      const done = g.tasks.filter((t) => t.status === 'completed').length;
      return `<li>
        <div class="hbar-head"><span><span class="dot" style="background:${escapeHtml(g.color)}"></span>${escapeHtml(g.name)}</span>
          <span><strong>${g.tasks.length}</strong> <span class="muted">· ${done} done (${Math.round((done / g.tasks.length) * 100)}%)</span></span></div>
        <div class="hbar-track"><div class="hbar-fill" style="--w:${(g.tasks.length / max) * 100}%;--c:${escapeHtml(g.color)}"></div></div>
      </li>`;
    })
    .join('')}</ul>`;
}
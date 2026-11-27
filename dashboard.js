/* =====================================================================
   TASKFLOW – Dashboard (index.html)
   Every number on this page is computed from the user's tasks in Supabase.
   ===================================================================== */

let dashTasks = [];

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await initProtectedPage('dashboard', () => ({
    title: 'Dashboard',
    subtitle: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  }));
  if (!ready) return;

  window.onTasksChanged = loadDashboard; // refresh after the shared "New Task" modal
  $('#quickAddBtn').addEventListener('click', () => openTaskModal({ defaults: { due_date: todayStr() }, onSaved: loadDashboard }));

  // One delegated handler per task list widget
  ['#todayList', '#recentList'].forEach((sel) => bindTaskList($(sel), () => dashTasks, loadDashboard));
  // Deadline and activity rows open the task's details (click or Enter)
  ['#deadlineList', '#activityList'].forEach((sel) => {
    const open = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      const item = e.target.closest('[data-id]');
      if (!item) return;
      const task = dashTasks.find((t) => t.id === item.dataset.id);
      if (task) openTaskDetails(task, loadDashboard);
    };
    $(sel).addEventListener('click', open);
    $(sel).addEventListener('keydown', open);
  });

  revealContent();
  await loadDashboard();
  runNotifications();
});

/** Fetches all tasks and re-renders every widget. */
async function loadDashboard() {
  ['#todayList', '#recentList', '#deadlineList'].forEach((sel) => {
    if (!dashTasks.length) $(sel).innerHTML = skeletonList(3);
  });
  try {
    dashTasks = await fetchAllTasks();
  } catch (err) {
    toast(`Could not load tasks: ${err.message}`, 'error');
    $('#todayList').innerHTML = emptyStateHTML({ icon: 'cloud-off', title: 'Could not load tasks', text: err.message });
    return;
  }
  const s = computeStats(dashTasks);
  renderWelcome(s);
  renderStats(s);
  renderToday(s);
  renderProgress(s);
  renderWeekly();
  renderPriority();
  renderRecent();
  renderDeadlines();
  renderActivity();
  refreshIcons();
}

/**
 * Recent activity built from each task's timestamps (created, completed,
 * edited). Deleted tasks are gone from the database, so they don't appear.
 */
function renderActivity() {
  const events = [];
  dashTasks.forEach((t) => {
    events.push({ task: t, at: t.created_at, kind: 'created' });
    if (t.completed_at) events.push({ task: t, at: t.completed_at, kind: 'completed' });
    const edited = new Date(t.updated_at) - new Date(t.created_at) > 60000;
    const sameAsCompletion = t.completed_at && Math.abs(new Date(t.updated_at) - new Date(t.completed_at)) < 60000;
    if (edited && !sameAsCompletion) events.push({ task: t, at: t.updated_at, kind: 'updated' });
  });
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  const meta = {
    created: { icon: 'plus', tone: 'tone-blue', verb: 'Created' },
    completed: { icon: 'check', tone: 'tone-green', verb: 'Completed' },
    updated: { icon: 'pencil', tone: 'tone-amber', verb: 'Updated' },
  };
  $('#activityList').innerHTML = events.length
    ? `<ul class="activity-list">${events
        .slice(0, 8)
        .map(
          (e) => `<li class="activity-item" data-id="${e.task.id}" tabindex="0">
            <span class="activity-icon ${meta[e.kind].tone}"><i data-lucide="${meta[e.kind].icon}"></i></span>
            <span class="activity-text">${meta[e.kind].verb} <strong>${escapeHtml(e.task.title)}</strong></span>
            <span class="activity-time" title="${formatDateTime(e.at)}">${timeAgo(e.at)}</span>
          </li>`
        )
        .join('')}</ul>`
    : emptyStateHTML({ icon: 'history', title: 'No activity yet', text: 'Creating, editing and completing tasks will show up here.' });
}

/** All dashboard numbers in one place. */
function computeStats(tasks) {
  const today = todayStr();
  const completed = tasks.filter((t) => t.status === 'completed');
  const todayTasks = tasks.filter((t) => t.due_date === today);
  return {
    total: tasks.length,
    completed: completed.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    overdue: tasks.filter(isOverdue).length,
    upcoming: tasks.filter((t) => t.due_date > today && t.status !== 'completed').length,
    today: todayTasks,
    todayDone: todayTasks.filter((t) => t.status === 'completed').length,
    completedToday: completed.filter((t) => t.completed_at && toDateStr(new Date(t.completed_at)) === today).length,
    percent: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
  };
}

function renderWelcome(s) {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#welcomeTitle').textContent = `${greet}, ${displayName().split(' ')[0]} 👋`;
  const open = s.today.length - s.todayDone;
  $('#welcomeText').textContent = !s.total
    ? 'Your workspace is ready. Add your first task to get started.'
    : open
    ? `You have ${open} task${open === 1 ? '' : 's'} left for today. Let's get them done.`
    : s.today.length
    ? 'Everything due today is done. Great work!'
    : 'Nothing is due today. A good moment to plan ahead.';
  $('#overviewPills').innerHTML = `
    <span><i data-lucide="sun"></i>${s.today.length} due today</span>
    <span><i data-lucide="check-circle-2"></i>${s.completedToday} completed today</span>
    <span><i data-lucide="loader"></i>${s.inProgress} in progress</span>`;
}

function renderStats(s) {
  const card = (href, tone, icon, label, value) => `
    <a href="${href}" class="card stat-card ${tone}">
      <div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon"><i data-lucide="${icon}"></i></span></div>
      <span class="stat-value">${value}</span>
    </a>`;
  $('#statsGrid').innerHTML =
    card('tasks.html', 'tone-purple', 'list-checks', 'Total Tasks', s.total) +
    card('tasks.html?view=completed', 'tone-green', 'check-circle-2', 'Completed', s.completed) +
    card('tasks.html?view=pending', 'tone-amber', 'clock', 'Pending', s.pending) +
    card('tasks.html?view=overdue', 'tone-red', 'alarm-clock', 'Overdue', s.overdue) +
    card('tasks.html?view=upcoming', 'tone-purple', 'calendar-clock', 'Upcoming', s.upcoming) +
    card('tasks.html?view=today', 'tone-blue', 'sun', "Today's Tasks", s.today.length);
}

function renderToday(s) {
  $('#todayDate').textContent = `${formatDate(todayStr(), { weekday: 'long', month: 'long', day: 'numeric' })} · ${s.todayDone}/${s.today.length} done`;
  const list = [...s.today].sort((a, b) => (a.status === 'completed') - (b.status === 'completed') || compareByDue(a, b));
  $('#todayList').innerHTML = list.length
    ? `<ul class="task-list">${list.slice(0, 6).map((t) => taskItemHTML(t, { compact: true })).join('')}</ul>`
    : emptyStateHTML({
        icon: 'sun',
        title: 'Nothing due today',
        text: 'Plan your day by adding a task with today’s date.',
        action: `<button class="btn btn-primary btn-sm" onclick="openTaskModal({defaults:{due_date:todayStr()},onSaved:loadDashboard})"><i data-lucide="plus"></i>Add a task for today</button>`,
      });
}

function renderProgress(s) {
  renderRing($('#completionRing'), s.percent, 'complete');
  $('#progressMeta').innerHTML = `
    <div><strong>${s.completed}</strong><small>Done</small></div>
    <div><strong>${s.inProgress}</strong><small>In progress</small></div>
    <div><strong>${s.pending}</strong><small>Pending</small></div>`;
}

function renderWeekly() {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const key = toDateStr(d);
    days.push({
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      title: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      value: dashTasks.filter((t) => t.completed_at && toDateStr(new Date(t.completed_at)) === key).length,
      highlight: i === 0,
    });
  }
  renderBarChart($('#weeklyChart'), days, { unit: 'completed' });
}

function renderPriority() {
  const open = dashTasks.filter((t) => t.status !== 'completed');
  if (!open.length) {
    $('#priorityChart').innerHTML = emptyStateHTML({ icon: 'flag', title: 'No open tasks', text: 'Open tasks will be grouped by priority here.' });
    return;
  }
  renderDonut(
    $('#priorityChart'),
    ['high', 'medium', 'low'].map((p) => ({ label: PRIORITY[p].label, value: open.filter((t) => t.priority === p).length, color: PRIORITY_COLORS[p] })),
    'open'
  );
}

function renderRecent() {
  const recent = dashTasks.slice(0, 5); // already newest-first
  $('#recentList').innerHTML = recent.length
    ? `<ul class="task-list">${recent.map((t) => taskItemHTML(t, { compact: true })).join('')}</ul>`
    : emptyStateHTML({
        icon: 'inbox',
        title: 'No tasks yet',
        text: 'Tasks you create will show up here.',
        action: `<button class="btn btn-primary btn-sm" onclick="openTaskModal({onSaved:loadDashboard})"><i data-lucide="plus"></i>Create your first task</button>`,
      });
}

function renderDeadlines() {
  const today = todayStr();
  const upcoming = dashTasks
    .filter((t) => t.status !== 'completed' && t.due_date && t.due_date >= today && !isOverdue(t))
    .sort(compareByDue)
    .slice(0, 5);
  $('#deadlineList').innerHTML = upcoming.length
    ? `<ul class="deadline-list">${upcoming
        .map((t) => {
          const d = parseDate(t.due_date);
          return `<li class="deadline-item" data-id="${t.id}" tabindex="0">
            <span class="date-tile"><small>${d.toLocaleDateString(undefined, { month: 'short' })}</small><strong>${d.getDate()}</strong></span>
            <div class="deadline-info"><p>${escapeHtml(t.title)}</p>
              <span>${relativeDay(t.due_date)}${t.due_time ? ' · ' + formatTime(t.due_time) : ''}${t.category ? ' · ' + escapeHtml(t.category.name) : ''}</span></div>
            ${priorityBadge(t.priority)}
          </li>`;
        })
        .join('')}</ul>`
    : emptyStateHTML({ icon: 'calendar-check', title: 'No upcoming deadlines', text: 'Tasks with a future due date will appear here.' });
}

/** Overdue alert (in-app) and due-today reminder (browser notification). */
function runNotifications() {
  const prefs = notificationPrefs();
  const overdue = dashTasks.filter(isOverdue).length;
  if (prefs.overdue_alerts && overdue && !sessionStorage.getItem('tf-overdue-shown')) {
    sessionStorage.setItem('tf-overdue-shown', '1');
    toast(`You have ${overdue} overdue task${overdue === 1 ? '' : 's'}.`, 'warning', 6000);
  }
  if (prefs.due_today_reminder && 'Notification' in window && Notification.permission === 'granted') {
    const key = `tf-reminded-${todayStr()}`;
    const due = dashTasks.filter((t) => t.due_date === todayStr() && t.status !== 'completed');
    if (due.length && !localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      new Notification('TASKFLOW: due today', {
        body: due.slice(0, 4).map((t) => `• ${t.title}`).join('\n') + (due.length > 4 ? `\n+${due.length - 4} more` : ''),
      });
    }
  }
}

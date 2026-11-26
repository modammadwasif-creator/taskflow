/* =====================================================================
   TASKFLOW – Tasks page (tasks.html)
   Views, search, filters and sorting are executed as Supabase queries,
   so the list always reflects what is stored in the database.
   ===================================================================== */

const VIEWS = [
  { id: 'all', label: 'All Tasks', icon: 'list' },
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar-clock' },
  { id: 'pending', label: 'Pending', icon: 'circle' },
  { id: 'in_progress', label: 'In Progress', icon: 'loader' },
  { id: 'completed', label: 'Completed', icon: 'check-circle-2' },
  { id: 'overdue', label: 'Overdue', icon: 'alarm-clock' },
  { id: 'high', label: 'High Priority', icon: 'flame' },
];

const state = {
  view: 'all',
  search: '',
  category: '',
  priority: '',
  status: '',
  sort: 'newest',
};
let listTasks = [];
let requestId = 0; // ignores out-of-order responses while typing

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  state.view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'all';
  state.search = params.get('q') || '';

  const ready = await initProtectedPage('tasks', { title: 'My Tasks', subtitle: 'Create, organise and track everything you need to do' });
  if (!ready) return;

  state.sort = App.settings.default_sort || 'newest';
  setupControls();
  bindTaskList($('#taskList'), () => listTasks, refresh);
  window.onTasksChanged = refresh;
  window.setTaskSearch = (q) => {
    state.search = q;
    $('#searchInput').value = q;
    syncUrl();
    loadTasks();
  };

  revealContent();
  await refresh();
});

function setupControls() {
  // Category filter options
  $('#categoryFilter').innerHTML =
    '<option value="">All categories</option><option value="none">No category</option>' +
    App.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  $('#searchInput').value = state.search;
  $('#sortSelect').value = state.sort;

  let debounce;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.search = e.target.value.trim();
      syncUrl();
      loadTasks();
    }, 300);
  });
  [
    ['#categoryFilter', 'category'],
    ['#priorityFilter', 'priority'],
    ['#statusFilter', 'status'],
    ['#sortSelect', 'sort'],
  ].forEach(([sel, key]) =>
    $(sel).addEventListener('change', (e) => {
      state[key] = e.target.value;
      loadTasks();
    })
  );

  $('#clearFilters').addEventListener('click', () => {
    Object.assign(state, { search: '', category: '', priority: '', status: '' });
    $('#searchInput').value = '';
    $('#categoryFilter').value = '';
    $('#priorityFilter').value = '';
    $('#statusFilter').value = '';
    syncUrl();
    loadTasks();
  });

  $('#viewTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (!tab) return;
    state.view = tab.dataset.view;
    syncUrl();
    renderTabs();
    loadTasks();
  });
}

/** Keeps ?view= and ?q= in the address bar so views can be bookmarked. */
function syncUrl() {
  const p = new URLSearchParams();
  if (state.view !== 'all') p.set('view', state.view);
  if (state.search) p.set('q', state.search);
  history.replaceState(null, '', `tasks.html${p.toString() ? '?' + p : ''}`);
  // keep the sidebar's quick-view highlight in sync
  $$('#sidebar .nav-link').forEach((a) => {
    const href = a.getAttribute('href');
    const quick = href.includes('?view=');
    a.classList.toggle('active', quick ? href === `tasks.html?view=${state.view}` : href === 'tasks.html' && !['today', 'upcoming', 'overdue', 'high'].includes(state.view));
  });
}

/** Reloads the counts and the list (after any create/edit/delete). */
async function refresh() {
  await Promise.all([loadCounts(), loadTasks()]);
}

/** Counts for the view tabs, from a light query of the user's tasks. */
let counts = {};
async function loadCounts() {
  try {
    const rows = check(await supabaseClient.from('tasks').select('id, status, priority, due_date, due_time'));
    const today = todayStr();
    counts = {
      all: rows.length,
      today: rows.filter((t) => t.due_date === today).length,
      upcoming: rows.filter((t) => t.due_date > today && t.status !== 'completed').length,
      pending: rows.filter((t) => t.status === 'pending').length,
      in_progress: rows.filter((t) => t.status === 'in_progress').length,
      completed: rows.filter((t) => t.status === 'completed').length,
      overdue: rows.filter(isOverdue).length,
      high: rows.filter((t) => t.priority === 'high').length,
    };
  } catch (err) {
    counts = {};
  }
  renderTabs();
}

function renderTabs() {
  $('#viewTabs').innerHTML = VIEWS.map(
    (v) => `<button class="view-tab ${state.view === v.id ? 'active' : ''}" data-view="${v.id}" aria-pressed="${state.view === v.id}">
      <i data-lucide="${v.icon}"></i>${v.label}${counts[v.id] !== undefined ? `<span class="count">${counts[v.id]}</span>` : ''}</button>`
  ).join('');
  refreshIcons();
  const active = $('#viewTabs .active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Builds the Supabase query from the current view + filters + sort. */
function buildQuery() {
  const today = todayStr();
  let q = supabaseClient.from('tasks').select(TASK_SELECT);

  switch (state.view) {
    case 'today':
      q = q.eq('due_date', today);
      break;
    case 'upcoming':
      q = q.gt('due_date', today).neq('status', 'completed');
      break;
    case 'pending':
    case 'in_progress':
    case 'completed':
      q = q.eq('status', state.view);
      break;
    case 'overdue':
      q = q.lte('due_date', today).neq('status', 'completed'); // time check below
      break;
    case 'high':
      q = q.eq('priority', 'high');
      break;
  }

  if (state.search) {
    // escape LIKE wildcards so "50%" searches literally
    const term = state.search.replace(/[\\%_]/g, (c) => '\\' + c);
    q = q.ilike('title', `%${term}%`);
  }
  if (state.category === 'none') q = q.is('category_id', null);
  else if (state.category) q = q.eq('category_id', state.category);
  if (state.priority) q = q.eq('priority', state.priority);
  if (state.status) q = q.eq('status', state.status);

  if (state.sort === 'oldest') q = q.order('created_at', { ascending: true });
  else if (state.sort === 'due_date')
    q = q.order('due_date', { ascending: true, nullsFirst: false }).order('due_time', { ascending: true, nullsFirst: true });
  else q = q.order('created_at', { ascending: false });

  return q;
}

async function loadTasks() {
  const id = ++requestId;
  const list = $('#taskList');
  if (!listTasks.length) list.innerHTML = skeletonList(5);
  list.setAttribute('aria-busy', 'true');

  let rows;
  try {
    rows = check(await buildQuery());
  } catch (err) {
    if (id !== requestId) return;
    list.removeAttribute('aria-busy');
    list.innerHTML = emptyStateHTML({
      icon: 'cloud-off',
      title: 'Could not load tasks',
      text: err.message,
      action: '<button class="btn btn-primary btn-sm" onclick="loadTasks()">Try again</button>',
    });
    refreshIcons();
    return;
  }
  if (id !== requestId) return; // a newer request has started
  if (state.view === 'overdue') rows = rows.filter(isOverdue);
  listTasks = rows;
  list.removeAttribute('aria-busy');
  renderList();
}

function renderList() {
  const filtered = Boolean(state.search || state.category || state.priority || state.status);
  $('#clearFilters').hidden = !filtered;
  const viewLabel = VIEWS.find((v) => v.id === state.view).label;
  $('#resultsCount').textContent = `${listTasks.length} task${listTasks.length === 1 ? '' : 's'} · ${viewLabel}${
    state.search ? ` · matching “${state.search}”` : ''
  }`;

  if (!listTasks.length) {
    const empty = filtered
      ? { icon: 'search-x', title: 'No matching tasks', text: 'Try a different search term or clear the filters.' }
      : {
          all: { icon: 'inbox', title: 'No tasks yet', text: 'Create your first task and start managing your day smarter.' },
          today: { icon: 'sun', title: 'Nothing due today', text: 'Enjoy the free time, or plan something new.' },
          upcoming: { icon: 'calendar-clock', title: 'No upcoming tasks', text: 'Tasks with a future due date will appear here.' },
          pending: { icon: 'circle', title: 'No pending tasks', text: 'Everything has been started or finished.' },
          in_progress: { icon: 'loader', title: 'Nothing in progress', text: 'Set a task to “In Progress” when you start it.' },
          completed: { icon: 'check-circle-2', title: 'No completed tasks yet', text: 'Completed tasks will be collected here.' },
          overdue: { icon: 'party-popper', title: 'No overdue tasks', text: 'You’re all caught up. Nice!' },
          high: { icon: 'flame', title: 'No high-priority tasks', text: 'Mark urgent tasks as High priority to see them here.' },
        }[state.view];
    $('#taskList').innerHTML = emptyStateHTML({
      ...empty,
      action: filtered ? '' : '<button class="btn btn-primary btn-sm" id="emptyAdd"><i data-lucide="plus"></i>New task</button>',
    });
    const add = $('#emptyAdd');
    if (add) add.addEventListener('click', () => openTaskModal({ defaults: state.view === 'today' ? { due_date: todayStr() } : {}, onSaved: refresh }));
  } else {
    $('#taskList').innerHTML = `<ul class="task-list">${listTasks.map((t) => taskItemHTML(t)).join('')}</ul>`;
  }
  refreshIcons();
}
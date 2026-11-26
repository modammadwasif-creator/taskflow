/* =====================================================================
   TASKFLOW – Shared application code
   UI helpers (toasts, dialogs, modals, theme), the app shell (sidebar +
   top bar), date helpers, the task data layer, the task form/details
   modals and lightweight SVG/CSS charts. Loaded on every page.
   Depends on: supabase.js (auth.js is loaded after this file)
   ===================================================================== */

/** Data loaded once per page for the signed-in user. */
const App = {
  user: null,
  profile: null,
  settings: null,
  categories: [],
};

const STATUS = {
  pending: { label: 'Pending', icon: 'circle' },
  in_progress: { label: 'In Progress', icon: 'loader' },
  completed: { label: 'Completed', icon: 'check-circle-2' },
};
const PRIORITY = {
  low: { label: 'Low' },
  medium: { label: 'Medium' },
  high: { label: 'High' },
};
const DEFAULT_NOTIFICATION_PREFS = {
  due_today_reminder: true,
  overdue_alerts: true,
  completion_celebration: true,
};
const TASK_SELECT = '*, category:categories(id, name, color)';

/* =====================================================================
   Small DOM / string utilities
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escapes text before putting it into innerHTML (prevents XSS). */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Re-renders Lucide icons after HTML has been inserted. */
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function initials(name, fallback = '?') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback.charAt(0).toUpperCase();
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function displayName() {
  return (App.profile && App.profile.full_name) || (App.user && App.user.email.split('@')[0]) || 'there';
}

/** Puts a button into a spinner state while an async action runs. */
function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
}

/* =====================================================================
   Form feedback
   ===================================================================== */
/** Marks a field invalid and shows the message under it. Returns false. */
function fieldError(input, message) {
  const field = input.closest('.field') || input.parentElement;
  field.classList.add('has-error');
  let el = field.querySelector('.field-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'field-error';
    field.appendChild(el);
  }
  el.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  return false;
}

function clearFormErrors(root) {
  $$('.has-error', root).forEach((f) => f.classList.remove('has-error'));
  $$('.field-error', root).forEach((e) => e.remove());
  $$('[aria-invalid]', root).forEach((i) => i.removeAttribute('aria-invalid'));
}

function showFormMessage(formId, message, type = 'error') {
  const box = $(`#${formId} .form-message`);
  if (!box) return toast(message, type);
  box.className = `form-message ${type}`;
  box.textContent = message;
  box.hidden = false;
}

function hideFormMessage(formId) {
  const box = $(`#${formId} .form-message`);
  if (box) box.hidden = true;
}

/* =====================================================================
   Toast notifications
   ===================================================================== */
function toast(message, type = 'success', duration = 3800) {
  let wrap = $('#toastContainer');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toastContainer';
    document.body.appendChild(wrap);
  }
  wrap.setAttribute('aria-live', 'polite');
  const icon = { success: 'check-circle-2', error: 'alert-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss"><i data-lucide="x"></i></button>`;
  wrap.appendChild(el);
  // keep at most 3 toasts on screen
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  refreshIcons();
  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, duration);
}

/** A message to show on the next page load (e.g. after a redirect). */
function setFlash(message, type = 'success') {
  sessionStorage.setItem('tf-flash', JSON.stringify({ message, type }));
}

function showFlash() {
  const raw = sessionStorage.getItem('tf-flash');
  if (!raw) return;
  sessionStorage.removeItem('tf-flash');
  try {
    const { message, type } = JSON.parse(raw);
    toast(message, type);
  } catch (_) {
    /* ignore malformed flash */
  }
}

/* =====================================================================
   Modals & confirmation dialogs
   ===================================================================== */
/**
 * Opens a modal. Returns { el, close }.
 * @param {{title:string, body:string, footer?:string, size?:'sm'|'md'|'lg', onClose?:Function}} opts
 */
function openModal({ title, body, footer = '', size = 'md', onClose }) {
  const lastFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-header">
        <h2 id="modalTitle">${title}</h2>
        <button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('open'));

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => {
      overlay.remove();
      if (!$('.modal-overlay')) document.body.classList.remove('modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }, 180);
    if (onClose) onClose();
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  $$('[data-close]', overlay).forEach((b) => b.addEventListener('click', close));
  const focusable = $('input, select, textarea, button:not([data-close])', $('.modal-body', overlay)) || $('[data-close]', overlay);
  setTimeout(() => focusable && focusable.focus(), 50);
  return { el: overlay, close };
}

/** Promise-based confirmation dialog. Resolves true when confirmed. */
function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title: escapeHtml(title),
      size: 'sm',
      body: `<div class="confirm-body">
          <div class="confirm-icon ${danger ? 'danger' : ''}"><i data-lucide="${danger ? 'trash-2' : 'help-circle'}"></i></div>
          <p>${escapeHtml(message)}</p></div>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>`,
      onClose: () => !answered && resolve(false),
    });
    const ok = $('[data-confirm]', modal.el);
    ok.addEventListener('click', () => {
      answered = true;
      resolve(true);
      modal.close();
    });
    setTimeout(() => ok.focus(), 60);
  });
}

/* =====================================================================
   Theme (light / dark)
   ===================================================================== */
function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('tf-theme', t);
  } catch (_) {
    /* storage unavailable – theme still applied for this page */
  }
  $$('[data-theme-icon]').forEach((el) => {
    el.innerHTML = `<i data-lucide="${t === 'dark' ? 'sun' : 'moon'}"></i>`;
  });
  refreshIcons();
}

/** Saves the theme to user_settings so it follows the user across devices. */
async function saveTheme(theme) {
  applyTheme(theme);
  if (!App.user) return;
  const { error } = await supabaseClient.from('user_settings').update({ theme }).eq('user_id', App.user.id);
  if (error) toast('Could not save theme preference.', 'error');
  else if (App.settings) App.settings.theme = theme;
}

function toggleTheme() {
  return saveTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

/* =====================================================================
   Dates
   ===================================================================== */
/** YYYY-MM-DD in the user's local time zone. */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const todayStr = () => toDateStr(new Date());

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Monday 00:00 of the week containing d (local time). */
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Parses 'YYYY-MM-DD' as a local date (not UTC). */
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(str, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!str) return '';
  return parseDate(str.slice(0, 10)).toLocaleDateString(undefined, opts);
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "Today", "Tomorrow", "Yesterday" or a short date. */
function relativeDay(str) {
  if (!str) return 'No due date';
  const diff = Math.round((parseDate(str) - parseDate(todayStr())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const sameYear = str.slice(0, 4) === todayStr().slice(0, 4);
  return formatDate(str, sameYear ? { month: 'short', day: 'numeric' } : undefined);
}

/** Overdue = not completed and its due date (and time, if set) has passed. */
function isOverdue(task) {
  if (task.status === 'completed' || !task.due_date) return false;
  const today = todayStr();
  if (task.due_date < today) return true;
  if (task.due_date === today && task.due_time) {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return task.due_time.slice(0, 5) < hhmm;
  }
  return false;
}

/** Compares tasks by due date+time, undated last. */
function compareByDue(a, b) {
  const ka = a.due_date ? `${a.due_date} ${a.due_time || '99'}` : '9999';
  const kb = b.due_date ? `${b.due_date} ${b.due_time || '99'}` : '9999';
  return ka.localeCompare(kb);
}

/* =====================================================================
   Data layer – every call goes to Supabase; RLS limits it to the user
   ===================================================================== */
/** Throws a readable Error when a Supabase call fails. */
function check({ data, error }) {
  if (error) {
    console.error(error);
    const msg = /failed to fetch/i.test(error.message)
      ? 'Cannot reach the server. Check your internet connection.'
      : error.message;
    throw new Error(msg);
  }
  return data;
}

async function fetchCategories() {
  App.categories = check(await supabaseClient.from('categories').select('*').order('created_at').order('name'));
  return App.categories;
}

/** Loads all of the user's tasks (RLS guarantees only their own). */
async function fetchAllTasks() {
  return check(await supabaseClient.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false }));
}

/** Loads tasks whose due date is within [from, to] (inclusive). */
async function fetchTasksInRange(from, to) {
  return check(
    await supabaseClient
      .from('tasks')
      .select(TASK_SELECT)
      .gte('due_date', from)
      .lte('due_date', to)
      .order('due_date')
      .order('due_time', { ascending: true, nullsFirst: true })
  );
}

async function createTask(values) {
  return check(
    await supabaseClient
      .from('tasks')
      .insert({ ...values, user_id: App.user.id })
      .select(TASK_SELECT)
      .single()
  );
}

async function updateTask(id, values) {
  return check(await supabaseClient.from('tasks').update(values).eq('id', id).select(TASK_SELECT).single());
}

async function deleteTask(id) {
  check(await supabaseClient.from('tasks').delete().eq('id', id));
}

/** Notification preferences merged over defaults. */
function notificationPrefs() {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...((App.settings && App.settings.notification_preferences) || {}) };
}

/* =====================================================================
   Task actions shared by every page
   ===================================================================== */
/** Confirms, deletes and reports. Resolves true if deleted. */
async function confirmAndDeleteTask(task) {
  const ok = await confirmDialog({
    title: 'Delete task?',
    message: `"${task.title}" will be permanently deleted. This cannot be undone.`,
    confirmText: 'Delete task',
    danger: true,
  });
  if (!ok) return false;
  try {
    await deleteTask(task.id);
    toast('Task deleted.', 'success');
    return true;
  } catch (err) {
    toast(`Could not delete task: ${err.message}`, 'error');
    return false;
  }
}

/** Toggles a task between completed and pending. Returns the updated task or null. */
async function toggleTaskComplete(task) {
  const status = task.status === 'completed' ? 'pending' : 'completed';
  try {
    const updated = await updateTask(task.id, { status });
    if (status === 'completed') {
      toast(notificationPrefs().completion_celebration ? '🎉 Nice work! Task completed.' : 'Task completed.', 'success');
    } else {
      toast('Task moved back to pending.', 'info');
    }
    return updated;
  } catch (err) {
    toast(`Could not update task: ${err.message}`, 'error');
    return null;
  }
}

/* =====================================================================
   Task rendering
   ===================================================================== */
function categoryChip(cat) {
  if (!cat) return '';
  return `<span class="chip" style="--chip:${escapeHtml(cat.color)}"><span class="dot"></span>${escapeHtml(cat.name)}</span>`;
}

function priorityBadge(p) {
  return `<span class="badge priority-${p}"><i data-lucide="flag"></i>${PRIORITY[p].label}</span>`;
}

function statusBadge(s) {
  return `<span class="badge status-${s}">${STATUS[s].label}</span>`;
}

function dueLabel(task) {
  if (!task.due_date) return '<span class="due muted"><i data-lucide="calendar-x"></i>No due date</span>';
  const overdue = isOverdue(task);
  const time = task.due_time ? ` · ${formatTime(task.due_time)}` : '';
  return `<span class="due ${overdue ? 'overdue' : ''}"><i data-lucide="${overdue ? 'alarm-clock' : 'calendar'}"></i>${
    overdue ? 'Overdue · ' : ''
  }${relativeDay(task.due_date)}${time}</span>`;
}

/** One task row. `compact` hides the action buttons (dashboard widgets). */
function taskItemHTML(task, { compact = false } = {}) {
  const done = task.status === 'completed';
  return `
  <li class="task-item ${done ? 'is-done' : ''} ${isOverdue(task) ? 'is-overdue' : ''}" data-id="${task.id}">
    <button class="task-check" data-action="toggle" aria-label="${done ? 'Mark as pending' : 'Mark as completed'}">
      <i data-lucide="check"></i>
    </button>
    <div class="task-main" data-action="view" tabindex="0" role="button" aria-label="Open task ${escapeHtml(task.title)}">
      <p class="task-title">${escapeHtml(task.title)}</p>
      <div class="task-meta">
        ${dueLabel(task)}
        ${categoryChip(task.category)}
        ${compact ? '' : priorityBadge(task.priority)}
      </div>
    </div>
    ${compact ? priorityBadge(task.priority) : statusBadge(task.status)}
    ${
      compact
        ? ''
        : `<div class="task-actions">
        <button class="icon-btn" data-action="edit" aria-label="Edit task"><i data-lucide="pencil"></i></button>
        <button class="icon-btn danger" data-action="delete" aria-label="Delete task"><i data-lucide="trash-2"></i></button>
      </div>`
    }
  </li>`;
}

/**
 * Handles clicks on rendered task rows via event delegation.
 * @param {HTMLElement} container
 * @param {() => object[]} getTasks returns the tasks currently displayed
 * @param {() => void} onChange called after any change to reload data
 */
function bindTaskList(container, getTasks, onChange) {
  const run = async (e) => {
    const actionEl = e.target.closest('[data-action]');
    const row = e.target.closest('.task-item');
    if (!actionEl || !row || !container.contains(row)) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const task = getTasks().find((t) => t.id === row.dataset.id);
    if (!task) return;
    const action = actionEl.dataset.action;
    if (action === 'toggle') {
      row.classList.add('is-busy');
      if (await toggleTaskComplete(task)) onChange();
      else row.classList.remove('is-busy');
    } else if (action === 'edit') {
      openTaskModal({ task, onSaved: onChange });
    } else if (action === 'delete') {
      if (await confirmAndDeleteTask(task)) onChange();
    } else if (action === 'view') {
      openTaskDetails(task, onChange);
    }
  };
  container.addEventListener('click', run);
  container.addEventListener('keydown', (e) => {
    if (e.target.matches('.task-main')) run(e);
  });
}

function emptyStateHTML({ icon = 'inbox', title, text = '', action = '' }) {
  return `<div class="empty-state">
      <div class="empty-icon"><i data-lucide="${icon}"></i></div>
      <h3>${escapeHtml(title)}</h3>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
      ${action}
    </div>`;
}

function skeletonList(n = 4) {
  return `<ul class="task-list">${'<li class="skeleton skeleton-row"></li>'.repeat(n)}</ul>`;
}

/* =====================================================================
   Task create / edit modal
   ===================================================================== */
/**
 * @param {{task?:object, defaults?:object, onSaved?:Function}} opts
 *   task      – existing task to edit (omit to create)
 *   defaults  – prefilled values for a new task, e.g. { due_date }
 */
function openTaskModal({ task = null, defaults = {}, onSaved } = {}) {
  const t = task || { priority: 'medium', status: 'pending', ...defaults };
  const catOptions = App.categories
    .map((c) => `<option value="${c.id}" ${t.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  const radio = (name, value, label, checked) =>
    `<label class="seg-option seg-${value}"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

  const modal = openModal({
    title: task ? 'Edit task' : 'New task',
    size: 'md',
    body: `
    <form id="taskForm" novalidate>
      <div class="form-message" hidden></div>
      <div class="field">
        <label for="tfTitle">Title <span class="req">*</span></label>
        <input id="tfTitle" name="title" maxlength="150" placeholder="e.g. Prepare quarterly report" value="${escapeHtml(t.title || '')}" autocomplete="off">
      </div>
      <div class="field">
        <label for="tfDesc">Description</label>
        <textarea id="tfDesc" name="description" rows="3" maxlength="2000" placeholder="Add details, links or notes…">${escapeHtml(t.description || '')}</textarea>
        <p class="field-hint"><span id="tfDescCount">${(t.description || '').length}</span>/2000</p>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="tfCategory">Category</label>
          <select id="tfCategory" name="category_id"><option value="">No category</option>${catOptions}</select>
        </div>
        <div class="field">
          <label for="tfStatus">Status</label>
          <select id="tfStatus" name="status">
            ${Object.entries(STATUS).map(([v, s]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <span class="label">Priority</span>
        <div class="segmented" role="radiogroup" aria-label="Priority">
          ${Object.entries(PRIORITY).map(([v, p]) => radio('priority', v, p.label, t.priority === v)).join('')}
        </div>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="tfDate">Due date</label>
          <input type="date" id="tfDate" name="due_date" value="${t.due_date || ''}">
        </div>
        <div class="field">
          <label for="tfTime">Due time <span class="muted">(optional)</span></label>
          <input type="time" id="tfTime" name="due_time" value="${t.due_time ? t.due_time.slice(0, 5) : ''}">
        </div>
      </div>
      ${task ? `<p class="field-hint">Created ${formatDateTime(task.created_at)}${task.completed_at ? ` · Completed ${formatDateTime(task.completed_at)}` : ''}</p>` : ''}
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button>
             <button class="btn btn-primary" type="submit" form="taskForm"><i data-lucide="${task ? 'save' : 'plus'}"></i>${task ? 'Save changes' : 'Create task'}</button>`,
  });

  const form = $('#taskForm', modal.el);
  const desc = form.description;
  desc.addEventListener('input', () => ($('#tfDescCount', modal.el).textContent = desc.value.length));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    hideFormMessage('taskForm');
    const values = {
      title: form.title.value.trim(),
      description: form.description.value.trim() || null,
      category_id: form.category_id.value || null,
      status: form.status.value,
      priority: form.priority.value,
      due_date: form.due_date.value || null,
      due_time: form.due_time.value || null,
    };
    let ok = true;
    if (!values.title) ok = fieldError(form.title, 'Title is required.');
    else if (values.title.length > 150) ok = fieldError(form.title, 'Keep the title under 150 characters.');
    if (values.description && values.description.length > 2000) ok = fieldError(form.description, 'Description is too long.');
    if (values.due_time && !values.due_date) ok = fieldError(form.due_date, 'Pick a date for this time.');
    if (values.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(values.due_date)) ok = fieldError(form.due_date, 'Enter a valid date.');
    if (!ok) return;

    const btn = $('button[type="submit"]', modal.el);
    setLoading(btn, true);
    try {
      const saved = task ? await updateTask(task.id, values) : await createTask(values);
      toast(task ? 'Task updated.' : 'Task created.', 'success');
      modal.close();
      if (onSaved) onSaved(saved);
    } catch (err) {
      setLoading(btn, false);
      showFormMessage('taskForm', `Could not save task: ${err.message}`, 'error');
    }
  });
  return modal;
}

/** Read-only details view with quick actions. */
function openTaskDetails(task, onChange) {
  const done = task.status === 'completed';
  const row = (icon, label, value) =>
    `<div class="detail-row"><span class="detail-label"><i data-lucide="${icon}"></i>${label}</span><span>${value}</span></div>`;
  const modal = openModal({
    title: 'Task details',
    size: 'md',
    body: `
      <div class="task-detail">
        <h3 class="detail-title ${done ? 'is-done' : ''}">${escapeHtml(task.title)}</h3>
        <p class="detail-desc">${task.description ? escapeHtml(task.description).replace(/\n/g, '<br>') : '<span class="muted">No description.</span>'}</p>
        <div class="detail-grid">
          ${row('activity', 'Status', statusBadge(task.status))}
          ${row('flag', 'Priority', priorityBadge(task.priority))}
          ${row('tag', 'Category', categoryChip(task.category) || '<span class="muted">None</span>')}
          ${row('calendar', 'Due', task.due_date ? `${formatDate(task.due_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${task.due_time ? ' · ' + formatTime(task.due_time) : ''}${isOverdue(task) ? ' <span class="badge overdue-badge">Overdue</span>' : ''}` : '<span class="muted">No due date</span>')}
          ${row('clock', 'Created', formatDateTime(task.created_at))}
          ${row('refresh-cw', 'Updated', formatDateTime(task.updated_at))}
          ${task.completed_at ? row('check-circle-2', 'Completed', formatDateTime(task.completed_at)) : ''}
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost danger-text" data-act="delete"><i data-lucide="trash-2"></i>Delete</button>
      <span class="spacer"></span>
      <button class="btn btn-secondary" data-act="edit"><i data-lucide="pencil"></i>Edit</button>
      <button class="btn btn-primary" data-act="toggle"><i data-lucide="${done ? 'rotate-ccw' : 'check'}"></i>${done ? 'Mark pending' : 'Mark complete'}</button>`,
  });
  $('[data-act="edit"]', modal.el).addEventListener('click', () => {
    modal.close();
    openTaskModal({ task, onSaved: onChange });
  });
  $('[data-act="delete"]', modal.el).addEventListener('click', async () => {
    if (await confirmAndDeleteTask(task)) {
      modal.close();
      onChange();
    }
  });
  $('[data-act="toggle"]', modal.el).addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true);
    if (await toggleTaskComplete(task)) {
      modal.close();
      onChange();
    } else setLoading(e.currentTarget, false);
  });
}

/* =====================================================================
   Charts (no library – plain HTML/SVG so they theme with CSS)
   ===================================================================== */
/**
 * Vertical bar chart.
 * @param {HTMLElement} el
 * @param {{label:string, value:number, title?:string}[]} data
 * @param {{series?:string}} opts
 */
function renderBarChart(el, data, { unit = 'tasks' } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  el.innerHTML = `<div class="bar-chart" role="img" aria-label="${escapeHtml(
    data.map((d) => `${d.title || d.label}: ${d.value}`).join(', ')
  )}">
    ${data
      .map(
        (d) => `
      <div class="bar-col ${d.highlight ? 'is-current' : ''}">
        <div class="bar-track"><div class="bar" style="--h:${(d.value / max) * 100}%" title="${escapeHtml(d.title || d.label)}: ${d.value} ${unit}">
          <span class="bar-value">${d.value || ''}</span></div></div>
        <span class="bar-label">${escapeHtml(d.label)}</span>
      </div>`
      )
      .join('')}
  </div>`;
}

/**
 * Donut chart with legend.
 * @param {{label:string, value:number, color:string}[]} segments
 */
function renderDonut(el, segments, centerLabel = 'total') {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 40;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total
    ? segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const len = (s.value / total) * C;
          const arc = `<circle r="${r}" cx="50" cy="50" fill="none" stroke="${s.color}" stroke-width="14"
            stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"><title>${escapeHtml(s.label)}: ${s.value}</title></circle>`;
          offset += len;
          return arc;
        })
        .join('')
    : '';
  el.innerHTML = `
    <div class="donut-wrap">
      <svg viewBox="0 0 100 100" class="donut" role="img" aria-label="${escapeHtml(segments.map((s) => `${s.label}: ${s.value}`).join(', '))}">
        <circle r="${r}" cx="50" cy="50" fill="none" class="donut-track" stroke-width="14"></circle>
        <g transform="rotate(-90 50 50)">${arcs}</g>
        <text x="50" y="49" text-anchor="middle" class="donut-total">${total}</text>
        <text x="50" y="61" text-anchor="middle" class="donut-caption">${escapeHtml(centerLabel)}</text>
      </svg>
      <ul class="legend">
        ${segments
          .map(
            (s) => `<li><span class="dot" style="background:${s.color}"></span><span class="legend-label">${escapeHtml(s.label)}</span>
            <span class="legend-value">${s.value}<small>${total ? Math.round((s.value / total) * 100) : 0}%</small></span></li>`
          )
          .join('')}
      </ul>
    </div>`;
}

/** Circular progress ring. */
function renderRing(el, percent, caption = 'complete') {
  const r = 42;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  el.innerHTML = `
    <svg viewBox="0 0 100 100" class="ring" role="img" aria-label="${p}% ${escapeHtml(caption)}">
      <defs><linearGradient id="ringGrad" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="var(--purple)"/><stop offset="100%" stop-color="var(--blue)"/></linearGradient></defs>
      <circle r="${r}" cx="50" cy="50" class="ring-track" fill="none" stroke-width="10"/>
      <circle r="${r}" cx="50" cy="50" fill="none" stroke="url(#ringGrad)" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${(p / 100) * C} ${C}" transform="rotate(-90 50 50)" class="ring-bar"/>
      <text x="50" y="52" text-anchor="middle" class="ring-value">${p}%</text>
      <text x="50" y="66" text-anchor="middle" class="ring-caption">${escapeHtml(caption)}</text>
    </svg>`;
}

const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

/* =====================================================================
   App shell – sidebar, top bar, mobile navigation
   ===================================================================== */
const NAV = [
  { page: 'dashboard', href: 'index.html', icon: 'layout-dashboard', label: 'Dashboard' },
  { page: 'tasks', href: 'tasks.html', icon: 'list-checks', label: 'My Tasks' },
  { page: 'calendar', href: 'calendar.html', icon: 'calendar-days', label: 'Calendar' },
  { page: 'analytics', href: 'analytics.html', icon: 'bar-chart-3', label: 'Analytics' },
  { page: 'settings', href: 'settings.html', icon: 'settings', label: 'Settings' },
];
const QUICK_VIEWS = [
  { view: 'today', icon: 'sun', label: 'Today' },
  { view: 'upcoming', icon: 'calendar-clock', label: 'Upcoming' },
  { view: 'overdue', icon: 'alarm-clock', label: 'Overdue' },
  { view: 'high', icon: 'flame', label: 'High Priority' },
];

function avatarHTML(cls = '') {
  const url = App.profile && App.profile.avatar_url;
  if (url && /^https:\/\//.test(url)) {
    return `<img class="avatar ${cls}" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar ${cls}">${escapeHtml(initials(displayName(), App.user ? App.user.email : '?'))}</span>`;
}

function renderShell(page, { title, subtitle = '' }) {
  const view = new URLSearchParams(window.location.search).get('view');
  $('#sidebar').innerHTML = `
    <div class="sidebar-brand">
      <a href="index.html" class="brand"><span class="brand-mark"><i data-lucide="check-check"></i></span><span>TASKFLOW</span></a>
      <button class="icon-btn sidebar-close" id="sidebarClose" aria-label="Close menu"><i data-lucide="x"></i></button>
    </div>
    <button class="btn btn-primary btn-block" id="sidebarNewTask"><i data-lucide="plus"></i>New Task</button>
    <nav class="nav" aria-label="Main">
      <p class="nav-heading">Menu</p>
      ${NAV.map(
        (n) => `<a href="${n.href}" class="nav-link ${n.page === page && !(page === 'tasks' && view && QUICK_VIEWS.some((q) => q.view === view)) ? 'active' : ''}"
          ${n.page === page ? 'aria-current="page"' : ''}><i data-lucide="${n.icon}"></i><span>${n.label}</span></a>`
      ).join('')}
      <p class="nav-heading">Quick views</p>
      ${QUICK_VIEWS.map(
        (q) => `<a href="tasks.html?view=${q.view}" class="nav-link ${page === 'tasks' && view === q.view ? 'active' : ''}">
          <i data-lucide="${q.icon}"></i><span>${q.label}</span></a>`
      ).join('')}
    </nav>
    <div class="sidebar-footer">
      <a href="settings.html" class="user-card">${avatarHTML()}<span class="user-meta"><strong>${escapeHtml(displayName())}</strong><small>${escapeHtml(App.user.email)}</small></span></a>
      <button class="icon-btn" id="sidebarLogout" aria-label="Log out" title="Log out"><i data-lucide="log-out"></i></button>
    </div>`;

  $('#topbar').innerHTML = `
    <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false"><i data-lucide="menu"></i></button>
    <div class="topbar-title"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>
    <form class="topbar-search" id="globalSearch" role="search">
      <i data-lucide="search"></i>
      <input type="search" name="q" placeholder="Search tasks…" aria-label="Search tasks" autocomplete="off">
    </form>
    <button class="icon-btn" id="themeToggle" aria-label="Toggle dark mode" title="Toggle theme"><span data-theme-icon></span></button>
    <button class="btn btn-primary topbar-new" id="topNewTask"><i data-lucide="plus"></i><span>New Task</span></button>`;

  // Navigation drawer (mobile/tablet)
  const app = $('#app');
  const menuBtn = $('#menuBtn');
  const setOpen = (open) => {
    app.classList.toggle('sidebar-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setOpen(true));
  $('#sidebarClose').addEventListener('click', () => setOpen(false));
  $('#sidebarOverlay').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));

  $('#sidebarLogout').addEventListener('click', () => logout());
  $('#themeToggle').addEventListener('click', toggleTheme);

  // "New Task" buttons: pages can override via window.onQuickAdd
  const quickAdd = () => {
    setOpen(false);
    openTaskModal({ onSaved: () => window.onTasksChanged && window.onTasksChanged() });
  };
  $('#topNewTask').addEventListener('click', quickAdd);
  $('#sidebarNewTask').addEventListener('click', quickAdd);

  // Global search jumps to the Tasks page (or filters in place there)
  $('#globalSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (page === 'tasks' && window.setTaskSearch) window.setTaskSearch(q);
    else window.location.href = `tasks.html${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  });

  applyTheme(document.documentElement.dataset.theme);
  refreshIcons();
}

/** Full-page notice shown when supabase.js still has placeholders. */
function renderConfigRequired() {
  // Keys are filled in, but the Supabase library failed to load from the CDN
  if (isSupabaseConfigured && !window.supabase) {
    document.body.innerHTML = `
    <div class="setup-screen">
      <div class="setup-card">
        <span class="brand-mark lg"><i data-lucide="wifi-off"></i></span>
        <h1>Could not load Supabase</h1>
        <p>Your keys are set, but the Supabase library could not be downloaded from cdn.jsdelivr.net. Check your internet connection, or turn off any ad/script blocker for this site, then reload.</p>
        <button class="btn btn-primary" onclick="location.reload()">Reload</button>
      </div>
    </div>`;
    refreshIcons();
    return;
  }
  document.body.innerHTML = `
    <div class="setup-screen">
      <div class="setup-card">
        <span class="brand-mark lg"><i data-lucide="database"></i></span>
        <h1>Connect TASKFLOW to Supabase</h1>
        <p>The app is not connected to a database yet. Add your Supabase Project URL and anon/publishable key to <code>supabase.js</code>, then run <code>supabase-setup.sql</code> in the Supabase SQL Editor.</p>
        <p class="muted">Full steps are in <code>README.md</code>.</p>
      </div>
    </div>`;
  refreshIcons();
}

/**
 * Boots a protected page: checks the session, loads profile, settings and
 * categories, then renders the shell. Resolves with App or null.
 */
async function initProtectedPage(page, shell) {
  if (!supabaseClient) {
    renderConfigRequired();
    return null;
  }
  const user = await requireAuth();
  if (!user) return null;
  App.user = user;

  // Sign out in another tab → leave this one too
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.replace(appUrl('login.html'));
  });

  try {
    const [profileRes, settingsRes] = await Promise.all([
      supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
      fetchCategories(),
    ]);
    App.profile = check(profileRes);
    App.settings = check(settingsRes);

    // Self-heal if the sign-up trigger did not create these rows
    if (!App.profile) {
      App.profile = check(
        await supabaseClient
          .from('profiles')
          .insert({ id: user.id, full_name: (user.user_metadata && user.user_metadata.full_name) || null })
          .select()
          .single()
      );
    }
    if (!App.settings) {
      App.settings = check(await supabaseClient.from('user_settings').insert({ user_id: user.id }).select().single());
    }
  } catch (err) {
    const loader = $('#pageLoader');
    if (loader) {
      loader.innerHTML = `<div class="load-error"><i data-lucide="cloud-off"></i><h3>Could not load your workspace</h3>
        <p>${escapeHtml(err.message)}</p><p class="muted">Did you run supabase-setup.sql?</p>
        <button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
      refreshIcons();
    }
    return null;
  }

  applyTheme(App.settings.theme);
  renderShell(page, typeof shell === 'function' ? shell() : shell);
  showFlash();
  return App;
}

/** Hides the page loader and reveals the page content. */
function revealContent() {
  const loader = $('#pageLoader');
  if (loader) loader.remove();
  const content = $('#content');
  if (content) {
    content.hidden = false;
    content.classList.add('fade-in');
  }
  refreshIcons();
}
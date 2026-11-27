/* =====================================================================
   TASKFLOW – Admin: user management (admin.html)
   ---------------------------------------------------------------------
   Security model: this page only DISPLAYS data. Every admin request is
   a database function (see supabase-admin.sql) that checks, inside
   Postgres, that the signed-in caller is listed in admin_users. Non-admins
   get "Not authorized" and receive no data, whatever this file does.
   No service_role / secret key is used anywhere in the browser.
   ===================================================================== */

const PAGE_SIZE = 20;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const admin = { search: '', page: 0, total: 0, rows: [], reqId: 0 };

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await initProtectedPage('admin', { title: 'User Management', subtitle: 'Administrator area' });
  if (!ready) return;

  revealContent();
  if (!App.isAdmin) return showDenied();

  $('#adminApp').hidden = false;
  bindAdminControls();
  await Promise.all([loadStats(), loadUsers()]);
});

/** Shown to anyone who is not an admin (or loses admin rights mid-session). */
function showDenied() {
  $('#adminApp').hidden = true;
  $('#adminDenied').hidden = false;
  refreshIcons();
}

/** True if a Supabase error means "you are not an admin". */
const isAuthError = (err) => /not authorized|permission denied|42501/i.test(err.message || err.code || '');

function bindAdminControls() {
  let debounce;
  $('#userSearch').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      admin.search = e.target.value.trim();
      admin.page = 0;
      loadUsers();
    }, 300);
  });
  $('#refreshUsers').addEventListener('click', () => Promise.all([loadStats(), loadUsers()]));
  $('#prevPage').addEventListener('click', () => {
    if (admin.page > 0) {
      admin.page--;
      loadUsers();
    }
  });
  $('#nextPage').addEventListener('click', () => {
    if ((admin.page + 1) * PAGE_SIZE < admin.total) {
      admin.page++;
      loadUsers();
    }
  });

  // Row actions: copy ID or open the user's profile
  $('#usersTable').addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      e.stopPropagation();
      return copyText(copy.dataset.copy);
    }
    const row = e.target.closest('[data-user]');
    if (row) openUserProfile(row.dataset.user);
  });
  $('#usersTable').addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-user]');
    if (row && e.key === 'Enter' && e.target === row) openUserProfile(row.dataset.user);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('User ID copied.', 'success');
  } catch (_) {
    toast('Could not copy. Select the ID and copy it manually.', 'error');
  }
}

/* ---------------------------------------------------------------------
   Statistics
   --------------------------------------------------------------------- */
async function loadStats() {
  $('#adminStats').innerHTML = '<div class="card skeleton" style="height:110px"></div>'.repeat(6);
  const { data, error } = await supabaseClient.rpc('admin_user_stats', { tz: TZ });
  if (error) {
    if (isAuthError(error)) return showDenied();
    $('#adminStats').innerHTML = '';
    return toast(`Could not load statistics: ${error.message}`, 'error');
  }
  const s = data;
  const card = (tone, icon, label, value, sub) => `
    <div class="card stat-card ${tone}">
      <div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon"><i data-lucide="${icon}"></i></span></div>
      <span class="stat-value">${value}</span><span class="kpi-sub">${sub}</span>
    </div>`;
  $('#adminStats').innerHTML =
    card('tone-purple', 'users', 'Total Users', s.total_users, `${s.admins} admin${s.admins === 1 ? '' : 's'}`) +
    card('tone-blue', 'user-plus', 'New Today', s.new_today, 'registrations') +
    card('tone-green', 'calendar-plus', 'New (7 days)', s.new_7d, `${s.new_30d} in last 30 days`) +
    card('tone-amber', 'activity', 'Active (7 days)', s.active_7d, 'signed in this week') +
    card('tone-red', 'mail-warning', 'Unverified', s.unconfirmed, 'email not confirmed') +
    card('tone-purple', 'list-checks', 'Total Tasks', s.total_tasks, `${s.completed_tasks} completed`);

  renderBarChart(
    $('#signupChart'),
    (s.signups_14d || []).map((d, i, arr) => ({
      label: String(parseDate(d.day).getDate()),
      title: formatDate(d.day, { weekday: 'short', month: 'short', day: 'numeric' }),
      value: d.count,
      highlight: i === arr.length - 1,
    })),
    { unit: 'sign-ups' }
  );

  const verified = s.total_users - s.unconfirmed;
  renderDonut(
    $('#statusChart'),
    [
      { label: 'Active this week', value: s.active_7d, color: '#10b981' },
      { label: 'Verified, not active', value: Math.max(verified - s.active_7d, 0), color: '#3b82f6' },
      { label: 'Email not verified', value: s.unconfirmed, color: '#f59e0b' },
    ],
    'users'
  );
  refreshIcons();
}

/* ---------------------------------------------------------------------
   User list
   --------------------------------------------------------------------- */
async function loadUsers() {
  const id = ++admin.reqId;
  if (!admin.rows.length) $('#usersTable').innerHTML = skeletonList(5);
  const { data, error } = await supabaseClient.rpc('admin_list_users', {
    search_term: admin.search || null,
    page_size: PAGE_SIZE,
    page_offset: admin.page * PAGE_SIZE,
  });
  if (id !== admin.reqId) return; // a newer search has started
  if (error) {
    if (isAuthError(error)) return showDenied();
    $('#usersTable').innerHTML = emptyStateHTML({ icon: 'cloud-off', title: 'Could not load users', text: error.message });
    return refreshIcons();
  }
  admin.rows = data || [];
  admin.total = admin.rows.length ? Number(admin.rows[0].total_count) : 0;
  renderUsers();
}

/** Account status shown as a badge. */
function accountStatus(u) {
  if (u.banned_until && new Date(u.banned_until) > new Date()) return { cls: 'status-banned', label: 'Suspended' };
  if (!u.email_confirmed_at) return { cls: 'status-unverified', label: 'Unverified' };
  if (u.last_sign_in_at && Date.now() - new Date(u.last_sign_in_at) < 7 * 86400000) return { cls: 'status-active', label: 'Active' };
  return { cls: 'status-inactive', label: 'Inactive' };
}

function userAvatar(u, cls = '') {
  if (u.avatar_url && /^https:\/\//.test(u.avatar_url)) {
    return `<img class="avatar ${cls}" src="${escapeHtml(u.avatar_url)}" alt="" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar ${cls}">${escapeHtml(initials(u.full_name, u.email || '?'))}</span>`;
}

function renderUsers() {
  const from = admin.total ? admin.page * PAGE_SIZE + 1 : 0;
  const to = admin.page * PAGE_SIZE + admin.rows.length;
  $('#usersSummary').textContent = admin.search
    ? `${admin.total} user${admin.total === 1 ? '' : 's'} matching “${admin.search}”`
    : `${admin.total} registered user${admin.total === 1 ? '' : 's'}`;

  $('#pager').hidden = admin.total <= PAGE_SIZE;
  $('#pagerInfo').textContent = `Showing ${from}–${to} of ${admin.total}`;
  $('#prevPage').disabled = admin.page === 0;
  $('#nextPage').disabled = to >= admin.total;

  if (!admin.rows.length) {
    $('#usersTable').innerHTML = emptyStateHTML({
      icon: admin.search ? 'search-x' : 'users',
      title: admin.search ? 'No matching users' : 'No users yet',
      text: admin.search ? 'Try a different name, email or ID.' : 'Registered accounts will appear here.',
    });
    return refreshIcons();
  }

  $('#usersTable').innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>User</th><th>User ID</th><th>Joined</th><th>Last sign-in</th><th>Status</th><th>Tasks</th><th><span class="sr-only">Open</span></th></tr></thead>
        <tbody>
          ${admin.rows
            .map((u) => {
              const st = accountStatus(u);
              return `<tr data-user="${u.id}" tabindex="0" aria-label="Open profile of ${escapeHtml(u.full_name || u.email)}">
                <td data-label="User"><div class="user-cell">${userAvatar(u)}<div>
                  <strong>${escapeHtml(u.full_name || 'No name')}${u.is_admin ? ' <span class="badge admin-badge">Admin</span>' : ''}</strong>
                  <small>${escapeHtml(u.email)}</small></div></div></td>
                <td data-label="User ID"><span class="id-cell"><code title="${u.id}">${u.id.slice(0, 8)}…</code>
                  <button class="icon-btn sm" data-copy="${u.id}" aria-label="Copy user ID"><i data-lucide="copy"></i></button></span></td>
                <td data-label="Joined">${formatDate(u.created_at.slice(0, 10))}</td>
                <td data-label="Last sign-in">${timeAgo(u.last_sign_in_at)}</td>
                <td data-label="Status"><span class="badge ${st.cls}">${st.label}</span></td>
                <td data-label="Tasks">${u.task_count} <span class="muted">· ${u.completed_count} done</span></td>
                <td class="row-open"><i data-lucide="chevron-right"></i></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
  refreshIcons();
}

/* ---------------------------------------------------------------------
   Individual user profile
   --------------------------------------------------------------------- */
async function openUserProfile(userId) {
  const modal = openModal({ title: 'User profile', size: 'md', body: '<div class="page-loader" style="min-height:220px"><div class="spinner"></div></div>' });
  const { data: u, error } = await supabaseClient.rpc('admin_get_user', { target_id: userId, tz: TZ });
  const body = $('.modal-body', modal.el);
  if (!body) return; // closed while loading
  if (error || !u) {
    if (error && isAuthError(error)) {
      modal.close();
      return showDenied();
    }
    body.innerHTML = emptyStateHTML({ icon: 'user-x', title: 'Could not load this user', text: error ? error.message : 'The account no longer exists.' });
    return refreshIcons();
  }
  const st = accountStatus(u);
  const t = u.tasks || {};
  const row = (icon, label, value) =>
    `<div class="detail-row"><span class="detail-label"><i data-lucide="${icon}"></i>${label}</span><span>${value}</span></div>`;
  const stat = (label, value, tone = '') => `<div class="${tone}"><strong>${value || 0}</strong><small>${label}</small></div>`;

  body.innerHTML = `
    <div class="profile-head">
      ${userAvatar(u, 'xl')}
      <div>
        <h3>${escapeHtml(u.full_name || 'No name')} ${u.is_admin ? '<span class="badge admin-badge">Admin</span>' : ''}</h3>
        <p>${escapeHtml(u.email)}</p>
        <p><span class="badge ${st.cls}">${st.label}</span></p>
      </div>
    </div>
    <div class="detail-grid">
      ${row('fingerprint', 'User ID', `<span class="id-cell"><code class="wrap">${u.id}</code><button class="icon-btn sm" data-copy-id aria-label="Copy user ID"><i data-lucide="copy"></i></button></span>`)}
      ${row('calendar-plus', 'Joined', formatDateTime(u.created_at))}
      ${row('log-in', 'Last sign-in', u.last_sign_in_at ? `${formatDateTime(u.last_sign_in_at)} <span class="muted">(${timeAgo(u.last_sign_in_at)})</span>` : 'Never')}
      ${row('mail-check', 'Email verified', u.email_confirmed_at ? formatDateTime(u.email_confirmed_at) : '<span class="badge status-unverified">Not verified</span>')}
      ${u.banned_until && new Date(u.banned_until) > new Date() ? row('ban', 'Suspended until', formatDateTime(u.banned_until)) : ''}
      ${row('user-cog', 'Profile updated', u.profile_updated_at ? formatDateTime(u.profile_updated_at) : '—')}
      ${row('palette', 'Theme', u.theme ? u.theme[0].toUpperCase() + u.theme.slice(1) : '—')}
      ${row('tags', 'Categories', u.category_count)}
      ${row('activity', 'Last task activity', t.last_activity ? timeAgo(t.last_activity) : 'No tasks yet')}
    </div>
    <h4 class="section-label">Task statistics</h4>
    <div class="progress-meta six">
      ${stat('Total', t.total)}${stat('Completed', t.completed)}${stat('Pending', t.pending)}
      ${stat('In progress', t.in_progress)}${stat('Overdue', t.overdue)}${stat('Upcoming', t.upcoming)}
    </div>
    <p class="admin-privacy"><i data-lucide="lock"></i>Task titles and descriptions are private to this user.</p>`;
  $('[data-copy-id]', body).addEventListener('click', () => copyText(u.id));
  refreshIcons();
}

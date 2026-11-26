/* =====================================================================
   TASKFLOW – Settings (settings.html)
   Profile, email/password (Supabase Auth), preferences (user_settings)
   and category management (categories).
   ===================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await initProtectedPage('settings', { title: 'Settings', subtitle: 'Manage your profile, account and preferences' });
  if (!ready) return;

  renderProfile();
  bindProfileForm();
  bindEmailForm();
  bindPasswordForm();
  bindPreferences();
  bindCategories();
  bindSectionNav();
  $('#logoutBtn').addEventListener('click', () => logout());

  revealContent();
  await renderCategories();
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
});

/* ---------------------------------------------------------------------
   Profile
   --------------------------------------------------------------------- */
function renderProfile() {
  $('#profileAvatar').innerHTML = avatarHTML('xl');
  $('#profileName').textContent = displayName();
  $('#profileEmail').textContent = App.user.email;
  $('#profileSince').textContent = `Member since ${formatDate(App.user.created_at || App.profile.created_at, { month: 'long', year: 'numeric' })}`;
  $('#fullName').value = App.profile.full_name || '';
  $('#avatarUrl').value = App.profile.avatar_url || '';
  $('#newEmail').value = App.user.email;
}

/** Updates name/avatar in the sidebar without reloading. */
function refreshUserCard() {
  const card = $('#sidebar .user-card');
  if (card) {
    card.innerHTML = `${avatarHTML()}<span class="user-meta"><strong>${escapeHtml(displayName())}</strong><small>${escapeHtml(App.user.email)}</small></span>`;
  }
}

function bindProfileForm() {
  const form = $('#profileForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    hideFormMessage('profileForm');
    const full_name = form.fullName.value.trim().replace(/\s+/g, ' ');
    const avatar_url = form.avatarUrl.value.trim() || null;
    let ok = true;
    if (full_name.length < 2 || full_name.length > 60) ok = fieldError(form.fullName, 'Enter your name (2–60 characters).');
    if (avatar_url && !/^https:\/\/\S+$/i.test(avatar_url)) ok = fieldError(form.avatarUrl, 'Use a full https:// image link.');
    if (!ok) return;

    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    try {
      App.profile = check(await supabaseClient.from('profiles').update({ full_name, avatar_url }).eq('id', App.user.id).select().single());
      // keep auth metadata in sync too (used as a fallback name)
      await supabaseClient.auth.updateUser({ data: { full_name } });
      renderProfile();
      refreshUserCard();
      toast('Profile saved.', 'success');
    } catch (err) {
      showFormMessage('profileForm', `Could not save profile: ${err.message}`, 'error');
    }
    setLoading(btn, false);
  });
}

/* ---------------------------------------------------------------------
   Account: email & password
   --------------------------------------------------------------------- */
function bindEmailForm() {
  const form = $('#emailForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    hideFormMessage('emailForm');
    const email = form.email.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return fieldError(form.email, 'Enter a valid email address.');
    if (email === App.user.email.toLowerCase()) return fieldError(form.email, 'This is already your email.');

    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    const { error } = await supabaseClient.auth.updateUser({ email }, { emailRedirectTo: appUrl('settings.html') });
    setLoading(btn, false);
    if (error) return showFormMessage('emailForm', friendlyAuthError(error), 'error');
    showFormMessage(
      'emailForm',
      `Almost done: we sent a confirmation link to ${email}. Your email changes after you confirm it (Supabase may also ask you to confirm from your current address).`,
      'success'
    );
  });
}

function bindPasswordForm() {
  const form = $('#passwordForm');
  bindStrengthMeter(form.password, $('#pwStrength'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    hideFormMessage('passwordForm');
    const current = form.current.value;
    const pw = form.password.value;
    let ok = true;
    if (!current) ok = fieldError(form.current, 'Enter your current password.');
    const pwErr = validatePassword(pw);
    if (pwErr) ok = fieldError(form.password, pwErr);
    else if (pw === current) ok = fieldError(form.password, 'Choose a different password from your current one.');
    if (pw !== form.confirm.value) ok = fieldError(form.confirm, 'Passwords do not match.');
    if (!ok) return;

    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    // Re-authenticate first so a stolen open session can't change the password
    const { error: authErr } = await supabaseClient.auth.signInWithPassword({ email: App.user.email, password: current });
    if (authErr) {
      setLoading(btn, false);
      return fieldError(form.current, /invalid login/i.test(authErr.message) ? 'Current password is incorrect.' : friendlyAuthError(authErr));
    }
    const { error } = await supabaseClient.auth.updateUser({ password: pw });
    setLoading(btn, false);
    if (error) return showFormMessage('passwordForm', friendlyAuthError(error), 'error');
    form.reset();
    $('#pwStrength').dataset.score = -1;
    $('#pwStrength .strength-label').textContent = '';
    toast('Password changed successfully.', 'success');
  });
}

/* ---------------------------------------------------------------------
   Preferences (user_settings)
   --------------------------------------------------------------------- */
async function saveSettings(values, successMsg) {
  try {
    App.settings = check(await supabaseClient.from('user_settings').update(values).eq('user_id', App.user.id).select().single());
    if (successMsg) toast(successMsg, 'success');
    return true;
  } catch (err) {
    toast(`Could not save setting: ${err.message}`, 'error');
    return false;
  }
}

function bindPreferences() {
  // Theme
  const syncThemeRadios = () => {
    const current = document.documentElement.dataset.theme;
    $$('input[name="theme"]').forEach((r) => (r.checked = r.value === current));
  };
  syncThemeRadios();
  $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => saveTheme(r.value)));
  // the top-bar toggle changes the theme too → keep radios in sync
  new MutationObserver(syncThemeRadios).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Default sort
  const sort = $('#defaultSort');
  sort.value = App.settings.default_sort;
  sort.addEventListener('change', async () => {
    const previous = App.settings.default_sort;
    if (!(await saveSettings({ default_sort: sort.value }, 'Default sorting saved.'))) sort.value = previous;
  });

  // Notification preferences (stored as JSON)
  const prefs = notificationPrefs();
  $$('[data-pref]').forEach((input) => {
    input.checked = Boolean(prefs[input.dataset.pref]);
    input.addEventListener('change', async () => {
      const key = input.dataset.pref;
      if (key === 'due_today_reminder' && input.checked) {
        if (!('Notification' in window)) {
          toast('This browser does not support notifications.', 'warning');
        } else if (Notification.permission !== 'granted') {
          const result = await Notification.requestPermission();
          if (result !== 'granted') toast('Notifications are blocked in your browser. Allow them in site settings to get reminders.', 'warning', 6000);
        }
      }
      const next = { ...notificationPrefs(), [key]: input.checked };
      if (!(await saveSettings({ notification_preferences: next }, 'Notification preferences saved.'))) input.checked = !input.checked;
    });
  });
}

/* ---------------------------------------------------------------------
   Categories
   --------------------------------------------------------------------- */
let categoryCounts = {};

async function renderCategories() {
  const list = $('#categoryList');
  try {
    const [, rows] = await Promise.all([fetchCategories(), supabaseClient.from('tasks').select('category_id').then(check)]);
    categoryCounts = rows.reduce((acc, r) => ((acc[r.category_id] = (acc[r.category_id] || 0) + 1), acc), {});
  } catch (err) {
    list.innerHTML = `<li class="muted">Could not load categories: ${escapeHtml(err.message)}</li>`;
    return;
  }
  list.innerHTML = App.categories.length
    ? App.categories
        .map(
          (c) => `
      <li class="category-row" data-id="${c.id}">
        <input type="color" class="color-input" value="${escapeHtml(c.color)}" data-cat-color aria-label="Colour for ${escapeHtml(c.name)}" style="width:34px;height:34px">
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="count">${categoryCounts[c.id] || 0} task${categoryCounts[c.id] === 1 ? '' : 's'}</span>
        <button class="icon-btn" data-cat-edit aria-label="Rename ${escapeHtml(c.name)}"><i data-lucide="pencil"></i></button>
        <button class="icon-btn danger" data-cat-delete aria-label="Delete ${escapeHtml(c.name)}"><i data-lucide="trash-2"></i></button>
      </li>`
        )
        .join('')
    : `<li>${emptyStateHTML({ icon: 'tags', title: 'No categories', text: 'Add a category below to organise your tasks.' })}</li>`;
  refreshIcons();
}

/** Readable message for duplicate names (unique constraint 23505). */
function categoryError(err, name) {
  return /duplicate|unique/i.test(err.message) ? `You already have a category called "${name}".` : err.message;
}

const nameTaken = (name, exceptId) => App.categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

function bindCategories() {
  const form = $('#categoryForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const name = form.name.value.trim().replace(/\s+/g, ' ');
    if (!name) return fieldError(form.name, 'Enter a category name.');
    if (name.length > 40) return fieldError(form.name, 'Keep it under 40 characters.');
    if (nameTaken(name)) return fieldError(form.name, 'You already have a category with this name.');
    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    try {
      check(await supabaseClient.from('categories').insert({ user_id: App.user.id, name, color: form.color.value }));
      form.name.value = '';
      toast(`Category "${name}" created.`, 'success');
      await renderCategories();
    } catch (err) {
      fieldError(form.name, categoryError(err, name));
    }
    setLoading(btn, false);
  });

  const list = $('#categoryList');

  // Recolour (fires when the colour picker closes)
  list.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-cat-color]')) return;
    const id = e.target.closest('[data-id]').dataset.id;
    try {
      check(await supabaseClient.from('categories').update({ color: e.target.value }).eq('id', id));
      toast('Category colour updated.', 'success');
      await fetchCategories();
    } catch (err) {
      toast(`Could not update colour: ${err.message}`, 'error');
      renderCategories();
    }
  });

  list.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const cat = App.categories.find((c) => c.id === row.dataset.id);
    if (!cat) return;

    if (e.target.closest('[data-cat-edit]')) {
      const modal = openModal({
        title: 'Rename category',
        size: 'sm',
        body: `<form id="renameForm" novalidate><div class="field"><label for="renameInput">Name</label>
               <input id="renameInput" name="name" maxlength="40" value="${escapeHtml(cat.name)}" autocomplete="off"></div></form>`,
        footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="renameForm">Save</button>`,
      });
      const f = $('#renameForm', modal.el);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        clearFormErrors(f);
        const name = f.name.value.trim().replace(/\s+/g, ' ');
        if (!name) return fieldError(f.name, 'Enter a name.');
        if (nameTaken(name, cat.id)) return fieldError(f.name, 'You already have a category with this name.');
        const btn = $('button[type="submit"]', modal.el);
        setLoading(btn, true);
        try {
          check(await supabaseClient.from('categories').update({ name }).eq('id', cat.id));
          modal.close();
          toast('Category renamed.', 'success');
          renderCategories();
        } catch (err) {
          setLoading(btn, false);
          fieldError(f.name, categoryError(err, name));
        }
      });
    }

    if (e.target.closest('[data-cat-delete]')) {
      const n = categoryCounts[cat.id] || 0;
      const ok = await confirmDialog({
        title: `Delete "${cat.name}"?`,
        message: n
          ? `${n} task${n === 1 ? '' : 's'} in this category will be kept but left without a category.`
          : 'This category has no tasks. It will be removed permanently.',
        confirmText: 'Delete category',
        danger: true,
      });
      if (!ok) return;
      try {
        check(await supabaseClient.from('categories').delete().eq('id', cat.id));
        toast('Category deleted.', 'success');
        renderCategories();
      } catch (err) {
        toast(`Could not delete category: ${err.message}`, 'error');
      }
    }
  });
}

/* ---------------------------------------------------------------------
   Section navigation highlight
   --------------------------------------------------------------------- */
function bindSectionNav() {
  const links = $$('.settings-nav a');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
        }
      });
    },
    { rootMargin: '-30% 0px -60% 0px' }
  );
  $$('.settings-sections > .card').forEach((s) => observer.observe(s));
}
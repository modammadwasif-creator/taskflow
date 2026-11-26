/* =====================================================================
   TASKFLOW – Authentication
   Session helpers used by every page, plus the handlers for the
   login / register / forgot-password / reset-password forms.
   Depends on: supabase.js, app.js
   ===================================================================== */

/** Build an absolute URL to a page of this app (works in sub-folders too). */
function appUrl(page) {
  return new URL(page, window.location.href).href.split('#')[0];
}

/** Returns the current session, or null. */
async function getSession() {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.warn('Session error:', error.message);
    return null;
  }
  return data.session;
}

/**
 * Protects a page: resolves with the logged-in user, or sends the
 * visitor to login.html (remembering where they wanted to go).
 */
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const here = window.location.pathname.split('/').pop() + window.location.search;
    sessionStorage.setItem('tf-after-login', here || 'index.html');
    window.location.replace(appUrl('login.html'));
    return null;
  }
  return session.user;
}

/** On login/register pages: logged-in users go straight to the dashboard. */
async function redirectIfAuthenticated() {
  const session = await getSession();
  if (session) {
    window.location.replace(appUrl(takeAfterLoginTarget()));
    return true;
  }
  return false;
}

/** Where to go after login (only same-app .html pages are accepted). */
function takeAfterLoginTarget() {
  const target = sessionStorage.getItem('tf-after-login') || 'index.html';
  sessionStorage.removeItem('tf-after-login');
  return /^[a-z]+\.html(\?[\w=&%-]*)?$/i.test(target) ? target : 'index.html';
}

/** Signs out after confirmation and returns to the login page. */
async function logout(skipConfirm = false) {
  if (!skipConfirm) {
    const ok = await confirmDialog({
      title: 'Log out?',
      message: 'You will need to sign in again to access your tasks.',
      confirmText: 'Log out',
    });
    if (!ok) return;
  }
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    toast(friendlyAuthError(error), 'error');
    return;
  }
  localStorage.removeItem('tf-theme');
  window.location.replace(appUrl('login.html'));
}

/** Turns Supabase auth errors into messages people understand. */
function friendlyAuthError(error) {
  const msg = (error && error.message) || String(error || '');
  const map = [
    [/invalid login credentials/i, 'Incorrect email or password.'],
    [/email not confirmed/i, 'Please verify your email first. Check your inbox for the confirmation link.'],
    [/user already registered|already been registered/i, 'An account with this email already exists. Try logging in.'],
    [/password should be at least/i, 'Password is too short.'],
    [/rate limit|too many requests|security purposes/i, 'Too many attempts. Please wait a minute and try again.'],
    [/failed to fetch|network/i, 'Cannot reach the server. Check your internet connection.'],
    [/same.*password|different from the old/i, 'New password must be different from your current one.'],
    [/expired|invalid.*(token|link)/i, 'This link is invalid or has expired. Please request a new one.'],
  ];
  const hit = map.find(([re]) => re.test(msg));
  return hit ? hit[1] : msg || 'Something went wrong. Please try again.';
}

/* ---------------------------------------------------------------------
   Validation helpers
   --------------------------------------------------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns an error message, or '' if the password is acceptable. */
function validatePassword(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
  return '';
}

/** 0–4 score used by the strength meter. */
function passwordScore(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

/** Wires a .strength meter to a password input. */
function bindStrengthMeter(input, meter) {
  if (!input || !meter) return;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  input.addEventListener('input', () => {
    const score = input.value ? passwordScore(input.value) : -1;
    meter.dataset.score = score;
    meter.querySelector('.strength-label').textContent = score < 0 ? '' : labels[score];
  });
}

/** Show/hide password buttons: <button data-toggle-password="inputId"> */
function bindPasswordToggles(root = document) {
  root.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
      refreshIcons();
    });
  });
}

/* ---------------------------------------------------------------------
   Auth pages (login.html & register.html)
   --------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page !== 'login' && page !== 'register') return;

  applyTheme(document.documentElement.dataset.theme);
  bindPasswordToggles();
  document.getElementById('authTheme').addEventListener('click', () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
  );

  if (!supabaseClient) {
    const notice = document.getElementById('configNotice');
    if (isSupabaseConfigured && !window.supabase) {
      notice.querySelector('div').innerHTML =
        '<strong>Could not load Supabase.</strong> Check your internet connection or disable ad/script blockers for this site, then reload.';
    }
    notice.hidden = false;
    document.querySelectorAll('form button[type="submit"]').forEach((b) => (b.disabled = true));
    return;
  }

  if (page === 'login') initLoginPage();
  else initRegisterPage();
});

/** Switches between the login / forgot / reset panels on login.html. */
function showAuthView(name) {
  document.querySelectorAll('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== name));
  const first = document.querySelector(`[data-view="${name}"] input`);
  if (first) first.focus();
}

async function initLoginPage() {
  const params = new URLSearchParams(window.location.search);
  const isRecovery = params.get('mode') === 'reset' || /type=recovery/.test(window.location.hash);

  // Password-reset link: Supabase signs the user in temporarily, then we
  // ask for the new password instead of redirecting to the dashboard.
  if (isRecovery) {
    showAuthView('reset');
    const session = await getSession();
    if (!session) {
      // the session may arrive a moment later via the URL hash
      supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') hideFormMessage('resetForm');
      });
      setTimeout(async () => {
        if (!(await getSession())) {
          showFormMessage('resetForm', 'This reset link is invalid or has expired. Request a new one below.', 'error');
        }
      }, 1500);
    }
  } else {
    if (params.get('verified') !== null) setFlash('Email verified. Welcome to TASKFLOW!');
    if (await redirectIfAuthenticated()) return;
    showAuthView('login');
  }

  document.querySelectorAll('[data-show-view]').forEach((link) =>
    link.addEventListener('click', (e) => {
      e.preventDefault();
      clearFormErrors(document);
      showAuthView(link.dataset.showView);
    })
  );

  // ---- Login ----
  const loginForm = document.getElementById('loginForm');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(loginForm);
    hideFormMessage('loginForm');
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    let ok = true;
    if (!EMAIL_RE.test(email)) ok = fieldError(loginForm.email, 'Enter a valid email address.');
    if (!password) ok = fieldError(loginForm.password, 'Enter your password.');
    if (!ok) return;

    const btn = loginForm.querySelector('button[type="submit"]');
    setLoading(btn, true);
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    setLoading(btn, false);
    if (error) {
      showFormMessage('loginForm', friendlyAuthError(error), 'error');
      document.getElementById('resendWrap').hidden = !/not confirmed/i.test(error.message);
      return;
    }
    window.location.replace(appUrl(takeAfterLoginTarget()));
  });

  // Resend verification email
  document.getElementById('resendBtn').addEventListener('click', async (e) => {
    const email = loginForm.email.value.trim();
    setLoading(e.currentTarget, true);
    const { error } = await supabaseClient.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: appUrl('login.html?verified') },
    });
    setLoading(e.currentTarget, false);
    if (error) toast(friendlyAuthError(error), 'error');
    else toast('Verification email sent. Check your inbox.', 'success');
  });

  // ---- Forgot password ----
  const forgotForm = document.getElementById('forgotForm');
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(forgotForm);
    const email = forgotForm.email.value.trim();
    if (!EMAIL_RE.test(email)) return fieldError(forgotForm.email, 'Enter a valid email address.');
    const btn = forgotForm.querySelector('button[type="submit"]');
    setLoading(btn, true);
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: appUrl('login.html?mode=reset'),
    });
    setLoading(btn, false);
    if (error) return showFormMessage('forgotForm', friendlyAuthError(error), 'error');
    // Same message whether or not the account exists (no account enumeration)
    showFormMessage('forgotForm', `If an account exists for ${email}, a reset link is on its way. Check your inbox.`, 'success');
    forgotForm.reset();
  });

  // ---- Reset password (after clicking the email link) ----
  const resetForm = document.getElementById('resetForm');
  bindStrengthMeter(resetForm.password, document.getElementById('resetStrength'));
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(resetForm);
    const pw = resetForm.password.value;
    const pwErr = validatePassword(pw);
    let ok = true;
    if (pwErr) ok = fieldError(resetForm.password, pwErr);
    if (pw !== resetForm.confirm.value) ok = fieldError(resetForm.confirm, 'Passwords do not match.');
    if (!ok) return;
    const btn = resetForm.querySelector('button[type="submit"]');
    setLoading(btn, true);
    const { error } = await supabaseClient.auth.updateUser({ password: pw });
    setLoading(btn, false);
    if (error) return showFormMessage('resetForm', friendlyAuthError(error), 'error');
    setFlash('Password updated. You are now signed in.');
    window.location.replace(appUrl('index.html'));
  });
}

async function initRegisterPage() {
  if (await redirectIfAuthenticated()) return;

  const form = document.getElementById('registerForm');
  bindStrengthMeter(form.password, document.getElementById('registerStrength'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    hideFormMessage('registerForm');
    const fullName = form.fullName.value.trim().replace(/\s+/g, ' ');
    const email = form.email.value.trim();
    const pw = form.password.value;
    let ok = true;
    if (fullName.length < 2 || fullName.length > 60) ok = fieldError(form.fullName, 'Enter your name (2–60 characters).');
    if (!EMAIL_RE.test(email)) ok = fieldError(form.email, 'Enter a valid email address.');
    const pwErr = validatePassword(pw);
    if (pwErr) ok = fieldError(form.password, pwErr);
    if (pw !== form.confirm.value) ok = fieldError(form.confirm, 'Passwords do not match.');
    if (!form.terms.checked) ok = fieldError(form.terms, 'Please accept to continue.');
    if (!ok) return;

    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password: pw,
      options: {
        data: { full_name: fullName }, // read by the handle_new_user() trigger
        emailRedirectTo: appUrl('login.html?verified'),
      },
    });
    setLoading(btn, false);
    if (error) return showFormMessage('registerForm', friendlyAuthError(error), 'error');

    // Supabase returns a user with no identities when the email is taken
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return showFormMessage('registerForm', 'An account with this email already exists. Try logging in.', 'error');
    }
    if (data.session) {
      // Email confirmation is turned off in Supabase → already signed in
      setFlash(`Welcome to TASKFLOW, ${fullName.split(' ')[0]}!`);
      window.location.replace(appUrl(takeAfterLoginTarget()));
      return;
    }
    document.getElementById('registerPanel').hidden = true;
    document.getElementById('verifyPanel').hidden = false;
    document.getElementById('verifyEmail').textContent = email;
  });
}
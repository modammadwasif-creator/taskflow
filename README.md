# TASKFLOW: Manage Your Day Smarter.

TASKFLOW is a task-management web app built with **HTML, CSS and vanilla JavaScript**. It uses **Supabase** for authentication, the PostgreSQL database and Row Level Security (RLS). It needs no build tools, frameworks or paid services.

---

## ⚠️ What you need to do (one-time setup)

The app is complete, but **it is not connected to a database yet**. It needs your own free Supabase project. Until you finish steps 1–4, the login page shows a "Supabase is not configured" notice and the dashboard shows a setup screen.

### 1. Create a Supabase project
1. Go to <https://supabase.com> and sign up (free).
2. Click **New project**, pick a name (e.g. `taskflow`), set a database password and choose a region near you.
3. Wait about 2 minutes for the project to be ready.

### 2. Create the database (tables, triggers, RLS)
1. In your project open **SQL Editor → New query**.
2. Open `supabase-setup.sql` from this folder, copy **everything**, paste it and click **Run**.
3. You should see "Success". This creates:
   - `profiles`, `tasks`, `categories` and `user_settings` tables, with foreign keys, check constraints and unique constraints
   - indexes for the queries the app runs
   - triggers that keep `updated_at` current, set `completed_at` automatically, and on sign-up create the user's profile, settings and the **7 default categories** (Personal, Work, Study, Shopping, Health, Meetings, Other)
   - **RLS policies** on every table, so each user can only SELECT/INSERT/UPDATE/DELETE their own rows

The script is safe to run again.

### 3. Add your keys to `supabase.js`
1. In Supabase go to **Project Settings → API**. (Newer dashboards call this **API Keys**.)
2. Copy the **Project URL** and the **anon / public** key. The new **publishable** key works too.
3. Open `supabase.js` and replace the placeholders:

```js
const SUPABASE_URL = 'https://abcdefghijklm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

> 🔒 **Never** put the `service_role` / secret key in this file. The anon key is meant to be public. RLS is what protects your data.

### 4. Configure authentication URLs
In **Authentication → URL Configuration**:
- **Site URL**: where the app runs, e.g. `http://localhost:5500` or `https://yourname.github.io/TASKFLOW`
- **Redirect URLs**: add your site's pages so email links can return to them, e.g.
  - `http://localhost:5500/**`
  - `https://yourname.github.io/TASKFLOW/**`

**Email verification**: in **Authentication → Providers → Email**, "Confirm email" is ON by default. New users must click the link in their email before they can log in. If you turn it off, users are signed in immediately after registering. The app supports both.

> Supabase's built-in email service is limited to a few emails per hour and is meant for testing. For real use, add your own SMTP server under **Authentication → Emails → SMTP Settings** (many providers have free tiers).

### 5. Run the app
The pages must be served over `http://`. Opening the files directly (`file://`) breaks the auth redirects. Pick any one option:
- **VS Code**: install the "Live Server" extension → right-click `index.html` → *Open with Live Server*
- **Python**: `python -m http.server 5500` inside the folder, then open <http://localhost:5500>
- **Node**: `npx serve .`

Then open `register.html`, create an account and start adding tasks.

### 6. Deploy (optional, free)
Upload the folder to **Netlify** (drag-and-drop), **Vercel**, **Cloudflare Pages** or **GitHub Pages**. Add the live URL to the Supabase Site URL and Redirect URLs (step 4).

---

## Features

| Area | What's included |
|---|---|
| **Auth** | Register, login, logout, forgot password, reset password via email link, email verification (with resend), persistent sessions, protected pages, redirect to login when signed out, redirect to dashboard when signed in, return to the requested page after login, sign-out syncs across tabs |
| **Dashboard** | Personal greeting, today's overview, 5 stat cards (total, completed, pending, overdue, today), recent tasks, upcoming deadlines, completion ring, 7-day productivity chart, priority donut, Quick Add |
| **Tasks** | Create / view details / edit / delete (with confirmation) / mark complete; title, description, category, priority, status, due date, optional due time; created/updated/completed timestamps |
| **Views & filters** | All, Today, Upcoming, Pending, In Progress, Completed, Overdue, High Priority (with live counts); search by title; filter by category, priority, status; sort by newest, oldest, due date. All of these run as Supabase queries. |
| **Categories** | 7 defaults per user; create, rename, recolour and delete custom categories. Deleting a category keeps its tasks and leaves them uncategorised. |
| **Calendar** | Month, week and day views; tasks on their due dates; previous/next/today navigation (← → keys work too); click a date to see its tasks; add a task directly on a date |
| **Analytics** | Total completed, completion rate, this week vs last week, this month, streak, daily (14 days), weekly (8 weeks) and monthly (6 months) charts, priority and category breakdowns |
| **Settings** | Edit full name and avatar URL, change email (Supabase confirmation), change password (asks for the current one first), light/dark theme, default sort, notification preferences, manage categories, log out |
| **UI/UX** | DM Sans, purple-blue gradient accents, light and dark mode (saved to your account), loading spinners and skeletons, empty states, toasts, confirmation dialogs, keyboard support, responsive from phones to desktops |

### Notification preferences (what they actually do)
- **Due-today reminder**: when you open the dashboard, a browser notification lists the tasks due today, once per day. Your browser asks for permission when you turn it on.
- **Overdue alerts**: an in-app alert on the dashboard when you have overdue tasks.
- **Completion celebrations**: a 🎉 message when you complete a task.

TASKFLOW is a static site with no server of its own, so it does **not** send reminder emails.

---

## Project structure

```
TASKFLOW/
├── index.html          Dashboard
├── login.html          Login + forgot password + set new password
├── register.html       Registration + "check your email" screen
├── tasks.html          All tasks, views, search, filters, sorting
├── calendar.html       Month / week / day calendar
├── analytics.html      Productivity analytics
├── settings.html       Profile, account, preferences, categories
├── style.css           Theme tokens, components and page styles
├── responsive.css      Tablet and phone layouts
├── supabase.js         ← your Supabase URL + anon key go here
├── auth.js             Session helpers + login/register/reset logic
├── app.js              Shared UI: shell, toasts, dialogs, task modal, charts, data helpers
├── dashboard.js        Dashboard page
├── tasks.js            Tasks page
├── calendar.js         Calendar page
├── analytics.js        Analytics page
├── settings.js         Settings page
├── supabase-setup.sql  Database setup script (run once in Supabase)
└── README.md
```

`app.js` is the one file added beyond the requested list. It holds the code that every page shares (sidebar, task form, dialogs, charts) so none of it is duplicated.

Script order on every page: Lucide → Supabase JS (CDN) → `supabase.js` → `app.js` → `auth.js` → page script.

---

## Database overview

```
auth.users ─┬─< profiles        (1:1, id = auth user id)
            ├─< user_settings   (1:1, unique user_id)
            ├─< categories      (unique per user: name)
            └─< tasks >── categories  (category must belong to the same user;
                                         ON DELETE SET NULL)
```

- `tasks.priority` ∈ `low | medium | high`, `tasks.status` ∈ `pending | in_progress | completed`
- `tasks.completed_at` is set and cleared by a trigger whenever the status changes
- A composite foreign key `(category_id, user_id)` stops a task from pointing at another user's category, even through the API
- The `anon` role has no table access. Signed-in users only reach their own rows through RLS.

---

## Testing checklist

These flows were tested in an automated headless browser (Chromium). The browser ran against a **mock** Supabase client, because the build environment had no internet access. The SQL script was tested separately on a real PostgreSQL 16 database. Each item below was checked:

- ✅ Registration (validation, weak password, duplicate email) → dashboard
- ✅ Login, wrong password, logout (with confirmation)
- ✅ Forgot password request; reset form
- ✅ Create task (validation: title required, time needs a date), edit, view details, complete / un-complete, delete (with cancel)
- ✅ Search, category/priority/status filters, combined filters, all 8 views, 3 sort orders
- ✅ Calendar month/week/day, navigation, click date, add task on a date
- ✅ Analytics KPIs and charts computed from data
- ✅ Profile update, theme, default sort, notification toggles, category create/rename/delete/duplicate check, password change with current-password check
- ✅ Data persists across reloads; theme follows the account after re-login
- ✅ A second user sees none of the first user's tasks
- ✅ Task titles containing HTML are shown as text (XSS-safe)
- ✅ No horizontal scrolling on iPhone 13 and tablet layouts; mobile drawer and bottom-sheet modals work
- ✅ No JavaScript console errors
- ✅ **SQL on PostgreSQL 16**: script runs cleanly twice, default categories are seeded, cross-user insert/update/delete is blocked by RLS, anonymous access is denied, using another user's category is rejected, deleting a category keeps its tasks

**Please repeat a quick smoke test after connecting your own Supabase project.** Register, check the email link, add a task and refresh. The real email delivery and redirect URLs depend on your project settings.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Supabase is not configured" | Fill in both values in `supabase.js` |
| "Could not load your workspace… Did you run supabase-setup.sql?" | Run the SQL script (step 2) |
| "Please verify your email first" | Click the link in the sign-up email, or use "Resend verification" on the login page |
| Email link opens the wrong site / localhost | Fix the Site URL and Redirect URLs (step 4) |
| No emails arrive | Check spam; the built-in mailer is rate-limited, so configure SMTP |
| Login works but the page loops back to login | Serve over `http://` (step 5), not `file://` |
| "Too many attempts" | Supabase rate limit; wait a minute |
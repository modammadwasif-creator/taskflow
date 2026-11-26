/* =====================================================================
   TASKFLOW – Supabase configuration
   ---------------------------------------------------------------------
   ACTION REQUIRED: replace the two placeholder values below with your
   project's values from  Supabase Dashboard → Project Settings → API.

   • SUPABASE_URL       → "Project URL"   (https://xxxx.supabase.co)
   • SUPABASE_ANON_KEY  → "anon / public" key (or the new "publishable" key)

   NEVER put the service_role / secret key here. This file is sent to
   every visitor's browser; your data is protected by Row Level Security.
   ===================================================================== */

const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

/** True once real credentials have been filled in above. */
const isSupabaseConfigured =
  /^https:\/\/.+/.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('YOUR_');

/**
 * Shared Supabase client used by every page.
 * (The CDN library exposes itself as `window.supabase`, so our client
 * is named `supabaseClient` to avoid clashing with it.)
 */
const supabaseClient =
  isSupabaseConfigured && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,     // keep users logged in across refreshes
          autoRefreshToken: true,   // refresh the JWT before it expires
          detectSessionInUrl: true, // handle email-verification & reset links
        },
      })
    : null;
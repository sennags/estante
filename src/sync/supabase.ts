import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * The account client, or null when the variables are missing: then the app
 * runs as before, with everything only in this browser.
 */
export const supabase = url && key
  ? createClient(url, key, {
      // Links from e-mails come back as ?code=..., which leaves the #/ routes alone.
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null;

/**
 * VITE_GOOGLE_LOGIN=true once the Google provider is set up in Supabase
 * (Authentication → Providers): in .env.local to test, then on Cloudflare Pages.
 */
export const GOOGLE_LOGIN = !!supabase && import.meta.env.VITE_GOOGLE_LOGIN === 'true';

/** Where links from e-mails and Google send the author back to. */
export const appUrl = () => window.location.origin + window.location.pathname;

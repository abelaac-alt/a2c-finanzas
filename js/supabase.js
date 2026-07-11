import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.A2C_CONFIG || {};

export const configured =
  /^https:\/\/.+\.supabase\.co$/.test(cfg.SUPABASE_URL || '') &&
  !String(cfg.SUPABASE_ANON_KEY || '').startsWith('TU_');

export const sb = configured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

// ─────────────────────────────────────────────────────────────────────────
//  SubTracker configuration
//  Fill in the two Supabase values to enable sign-in and cloud sync.
//  Leave them as-is and the app runs fully offline on this device only.
//  Where to find them: Supabase dashboard → Project Settings → API
// ─────────────────────────────────────────────────────────────────────────
window.SUBTRACKER_CONFIG = {
  SUPABASE_URL:      'YOUR_SUPABASE_URL',       // e.g. https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',  // the long "anon public" key
  APP_VERSION:       '1.0.0',
  CURRENCY:          '$',
};

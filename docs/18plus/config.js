// SubTracker configuration. The publishable key is safe to ship in the app:
// Row Level Security in Supabase keeps each person's data private.
window.SUBTRACKER_CONFIG = {
  SUPABASE_URL: 'https://ehlkboyekvuhcortgyyr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_oiBfdjJMacjFmGHOqfNkuw_bKYtV_Pg',
  APP_URL: 'https://effectiveworksolutions.github.io/Subscription-Manager/',
  EDITION: '18plus',
  EDITION_URL: 'https://effectiveworksolutions.github.io/Subscription-Manager/18plus/',
  APP_VERSION: '1.3.0',
  CURRENCY: '$',
  // "Find subscriptions from email" — leave blank to hide a provider.
  // Google Cloud → APIs & Services → Credentials → OAuth client (Web application):
  GOOGLE_CLIENT_ID: '735656622119-ij0f6lnil82u8rlr1k5p9dsfojvg1s0p.apps.googleusercontent.com',
  // Microsoft Entra → App registrations → "SubTracker" → Application (client) ID (SPA redirect = this app's URL):
  MS_CLIENT_ID: 'a63d88c6-0b10-4686-9a64-39297480fc60',
};
